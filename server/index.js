require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

function isValidVapidPublicKey(k) {
  try {
    if (!k || typeof k !== 'string') return false;
    const base64 = k.replace(/-/g, '+').replace(/_/g, '/');
    const raw = Buffer.from(base64, 'base64');
    return raw.length === 65 && raw[0] === 4;
  } catch (_) { return false; }
}

if (isValidVapidPublicKey(VAPID_PUBLIC_KEY) && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('Advertencia: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY faltan o inválidas en .env; /api/push no funcionará hasta configurarlas');
}

// Endpoint para obtener la clave pública
app.get('/api/vapidPublicKey', (_req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.get('/vapid-public-key', (_req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY, vapidPublicKey: VAPID_PUBLIC_KEY });
});

// Endpoint para enviar push a una suscripción
// Body esperado: { subscription: {..}, payload: { title, body, icon, badge, data: { url } } }
app.post('/api/push', async (req, res) => {
  const { subscription, payload } = req.body || {};
  if (!subscription) {
    return res.status(400).json({ error: 'subscription requerida' });
  }
  try {
    // Construir opciones de notificación que el SW mostrará
    const notif = {
      title: payload?.title || 'TLC',
      body: payload?.body || '',
      icon: payload?.icon || '/img/android-chrome-192x192.png',
      badge: payload?.badge || '/img/favicon-32x32.png',
      data: payload?.data || {}
    };
    await webpush.sendNotification(subscription, JSON.stringify(notif));
    res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando push:', err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: 'push_failed', details: err.body || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Web Push escuchando en http://localhost:${PORT}`);
});

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeKeys(row) {
  let keys = null;
  if (row.keys && typeof row.keys === 'string') {
    try { keys = JSON.parse(row.keys); } catch { keys = null; }
  } else if (row.keys && typeof row.keys === 'object') {
    keys = row.keys;
  }
  if (!keys || !keys.p256dh || !keys.auth) {
    keys = { p256dh: row.p256dh, auth: row.auth };
  }
  return keys && keys.p256dh && keys.auth ? keys : null;
}

async function fetchSubscriptionsFor(supabase, userId, contactId) {
  const out = [];
  const seen = new Set();
  const targets = [];
  if (userId) targets.push({ column: 'user_id', id: userId });
  if (contactId) targets.push({ column: 'client_contact_id', id: contactId });
  for (const t of targets) {
    const r = await supabase.from('push_subscriptions').select('endpoint, keys, p256dh, auth').eq(t.column, t.id);
    const rows = r.data || [];
    for (const row of rows) {
      const keys = normalizeKeys(row);
      const endpoint = row.endpoint;
      if (endpoint && keys && !seen.has(endpoint)) {
        seen.add(endpoint);
        out.push({ endpoint, keys });
      }
    }
  }
  return out;
}

async function sendToSubscriptions(subs, payload, supabase) {
  const results = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      results.push({ success: true, endpoint: sub.endpoint });
    } catch (err) {
      const statusCode = err && err.statusCode ? err.statusCode : 0;
      const message = err && err.message ? err.message : String(err);
      if (supabase && (statusCode === 404 || statusCode === 410)) {
        try { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (_) {}
      }
      results.push({ success: false, endpoint: sub.endpoint, statusCode, error: message });
    }
  }
  return results;
}

app.post('/api/sendToOrder', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ error: 'server_not_configured' });
    const { orderId, title, body, icon, badge, data } = req.body || {};
    if (!orderId || !body) return res.status(400).json({ error: 'orderId_and_body_required' });
    const { data: ord, error } = await supabase.from('orders').select('client_id, client_contact_id, assigned_to').eq('id', orderId).maybeSingle();
    if (error) return res.status(500).json({ error: 'order_lookup_failed' });
    const subs = await fetchSubscriptionsFor(supabase, ord?.client_id || null, ord?.client_contact_id || null);
    if (subs.length === 0) return res.json({ success: false, sent: 0, total: 0, message: 'no_subscriptions' });
    const payload = { title: title || 'Actualización de TLC', body, icon: icon || '/img/android-chrome-192x192.png', badge: badge || '/img/favicon-32x32.png', data: { orderId, ...(data || {}) } };
    const results = await sendToSubscriptions(subs.map(s => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })), payload, supabase);
    const success = results.filter(r => r.success).length;
    return res.json({ success: success > 0, sent: success, total: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: 'send_to_order_failed', details: String(e && e.message ? e.message : e) });
  }
});

app.post('/api/sendByRole', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ error: 'server_not_configured' });
    const { role, orderId, title, body, icon, badge, data } = req.body || {};
    if (!role || !orderId || !body) return res.status(400).json({ error: 'role_orderId_body_required' });
    const { data: ord } = await supabase.from('orders').select('client_id, client_contact_id, assigned_to').eq('id', orderId).maybeSingle();
    let targetUserIds = [];
    let contactId = null;
    if (role === 'cliente') {
      targetUserIds = ord?.client_id ? [ord.client_id] : [];
      contactId = ord?.client_contact_id || null;
    } else if (role === 'colaborador') {
      targetUserIds = ord?.assigned_to ? [ord.assigned_to] : [];
    } else if (role === 'administrador') {
      const { data: admins } = await supabase.from('collaborators').select('id').eq('role', 'administrador');
      targetUserIds = (admins || []).map(r => String(r.id));
    }
    let subs = [];
    const seen = new Set();
    for (const uid of targetUserIds) {
      const s = await fetchSubscriptionsFor(supabase, uid, null);
      for (const sub of s) { if (!seen.has(sub.endpoint)) { seen.add(sub.endpoint); subs.push(sub); } }
    }
    if (contactId) {
      const sc = await fetchSubscriptionsFor(supabase, null, contactId);
      for (const sub of sc) { if (!seen.has(sub.endpoint)) { seen.add(sub.endpoint); subs.push(sub); } }
    }
    if (subs.length === 0) return res.json({ success: false, sent: 0, total: 0, message: 'no_subscriptions' });
    const payload = { title: title || 'Actualización de TLC', body, icon: icon || '/img/android-chrome-192x192.png', badge: badge || '/img/favicon-32x32.png', data: { orderId, role, ...(data || {}) } };
    const results = await sendToSubscriptions(subs.map(s => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })), payload, supabase);
    const success = results.filter(r => r.success).length;
    return res.json({ success: success > 0, sent: success, total: results.length, results });
  } catch (e) {
    return res.status(500).json({ error: 'send_by_role_failed', details: String(e && e.message ? e.message : e) });
  }
});

async function processOutboxOnce() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { data: rows, error } = await supabase
    .from('notification_outbox')
    .select('id, order_id, new_status, target_role, target_user_id, target_contact_id, payload, attempts')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error || !rows || rows.length === 0) return;
  for (const row of rows) {
    try {
      let subs = [];
      const seen = new Set();
      if (row.target_user_id) {
        const su = await fetchSubscriptionsFor(supabase, row.target_user_id, null);
        for (const s of su) { if (!seen.has(s.endpoint)) { seen.add(s.endpoint); subs.push(s); } }
      }
      if (row.target_contact_id) {
        const sc = await fetchSubscriptionsFor(supabase, null, row.target_contact_id);
        for (const s of sc) { if (!seen.has(s.endpoint)) { seen.add(s.endpoint); subs.push(s); } }
      }
      if (row.target_role === 'administrador') {
        const { data: admins } = await supabase.from('collaborators').select('id').eq('role', 'administrador');
        const ids = (admins || []).map(a => String(a.id));
        for (const uid of ids) {
          const sa = await fetchSubscriptionsFor(supabase, uid, null);
          for (const s of sa) { if (!seen.has(s.endpoint)) { seen.add(s.endpoint); subs.push(s); } }
        }
      }
      if (subs.length === 0) {
        await supabase.from('notification_outbox').update({ processed_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: 'no_subscriptions' }).eq('id', row.id);
        continue;
      }
      const basePayload = row.payload || {};
      const payload = {
        title: basePayload.title || 'Actualización de TLC',
        body: basePayload.body || String(row.new_status || ''),
        icon: basePayload.icon || '/img/android-chrome-192x192.png',
        badge: basePayload.badge || '/img/favicon-32x32.png',
        data: { ...(basePayload.data || {}), orderId: row.order_id, role: row.target_role || null }
      };
      const results = await sendToSubscriptions(
        subs.map(s => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })),
        payload,
        supabase
      );
      const success = results.filter(r => r.success).length;
      const firstError = results.find(r => !r.success)?.error || null;
      await supabase.from('notification_outbox').update({ processed_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: success > 0 ? null : firstError }).eq('id', row.id);
    } catch (err) {
      await supabase.from('notification_outbox').update({ processed_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: String(err && err.message ? err.message : err) }).eq('id', row.id);
    }
  }
}

setInterval(() => { processOutboxOnce().catch(() => {}); }, 10000);
processOutboxOnce().catch(() => {});
