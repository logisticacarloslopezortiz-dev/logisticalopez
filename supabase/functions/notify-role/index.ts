/// <reference path="../globals.d.ts" />
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsonResponse } from '../cors-config.ts';
const SITE_BASE = (Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com').trim();
const absolutize = (u: string) => {
  const s = String(u || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  const base = SITE_BASE.endsWith('/') ? SITE_BASE.slice(0, -1) : SITE_BASE;
  const path = s.startsWith('/') ? s : `/${s}`;
  return base + path;
}

const supabase: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim()
const FUNCTIONS_BASE = SUPABASE_URL ? SUPABASE_URL.replace('.supabase.co', '.functions.supabase.co') : ''

// -------------------------------
// Tipos
// -------------------------------
type NotifyRoleRequest = {
  role: 'administrador' | 'colaborador' | 'cliente' | 'admin' | 'worker';
  orderId: number | string;
  title?: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  targetIds?: string[];
};

// -------------------------------
// Logs
// -------------------------------
function logDebug(msg: string, data?: unknown) {
  console.log(`[notify-role] ${msg}`, data ? JSON.stringify(data) : '');
}

async function logDb(supabase: SupabaseClient, fn: string, level: 'info' | 'warning' | 'error', msg: string, payload?: unknown) {
  try {
    await supabase.from('function_logs').insert({
      fn_name: fn,
      level,
      message: msg,
      payload
    });
  } catch {}
}

function errorToString(err: unknown) {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// -------------------------------
// Encolar en notification_outbox
// -------------------------------
async function enqueueForUserIds(client: SupabaseClient, userIds: string[], payload: any, orderId: number | string, statusTag: string, role: string) {
  if (!userIds || userIds.length === 0) return { queued: 0 };
  const rows = userIds.map(uid => ({
    order_id: Number(orderId),
    new_status: statusTag,
    target_role: role,
    target_user_id: uid,
    payload
  }));
  const { error } = await client.from('notification_outbox').insert(rows);
  if (error) throw error;
  return { queued: rows.length };
}

// ===============================================================
//   SERVIDOR PRINCIPAL
// ===============================================================
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  // Backend-only: exige Authorization: Bearer <SERVICE_ROLE>
  const srvRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  if (!srvRole || authHeader !== `Bearer ${srvRole}`) {
    return jsonResponse({ success: false, error: 'unauthorized' }, 401);
  }

  // --------------------------------------------
  // Supabase
  // --------------------------------------------
    const SUPABASE_URL_ENV = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL_ENV || !SUPABASE_SERVICE_ROLE) {
      return jsonResponse({ success: false, error: 'Error de configuración del servidor' }, 500);
    }

  try {
    const body = (await req.json()) as NotifyRoleRequest;

    const {
      role,
      orderId,
      title = 'Actualización de TLC',
      body: messageBody,
      icon = '/img/android-chrome-192x192.png',
      data = {},
      targetIds = []
    } = body;

    if (!role || !orderId || !messageBody) {
      await logDb(supabase, 'notify-role', 'warning', 'Campos requeridos faltantes', { role, orderId });
      return jsonResponse({ success: false, error: 'role, orderId y body son requeridos' }, 400);
    }

    const normalizedRole =
      role === 'admin' ? 'administrador' :
      role === 'worker' ? 'colaborador' :
      role;

    // ===================================================================
    //  CASO 1: CLIENTE → Insertar notifications (triggers crean events)
    // ===================================================================
    if (normalizedRole === 'cliente') {
      const { data: order, error } = await supabase
        .from('orders')
        .select('client_id, client_contact_id')
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        await logDb(supabase, 'notify-role', 'error', 'Error obteniendo orden para cliente', { orderId, error });
        return jsonResponse({ success: false, error: 'No se pudo obtener información del cliente' }, 500);
      }

      const rowBase = { title, body: messageBody, data: { orderId } } as any;
      let inserted = 0;
      if (order?.client_id) {
        const { error: e1 } = await supabase.from('notifications').insert({ ...rowBase, user_id: order.client_id, contact_id: null });
        if (!e1) inserted++;
      } else if (order?.client_contact_id) {
        const { error: e2 } = await supabase.from('notifications').insert({ ...rowBase, user_id: null, contact_id: order.client_contact_id });
        if (!e2) inserted++;
      }
      return jsonResponse({ success: inserted > 0, inserted }, inserted > 0 ? 200 : 404);
    }

    // ===================================================================
    //  CASO 2: ADMIN / COLABORADOR
    // ===================================================================
    const { data: collabs, error: collabErr } = await supabase
      .from('collaborators')
      .select('id, role, active')
      .eq('role', normalizedRole)
      .eq('active', true);

    if (collabErr) {
      await logDb(supabase, 'notify-role', 'error', 'Error consultando colaboradores', { normalizedRole });
      return jsonResponse({ success: false, error: 'No se pudieron obtener colaboradores' }, 500);
    }

    let ids = (collabs ?? []).map(c => String(c.id));

    if (targetIds.length > 0) {
      ids = ids.filter(id => targetIds.includes(id));
    }

    if (ids.length === 0) {
      return jsonResponse({ success: false, message: 'No hay destinatarios' }, 200);
    }

    let inserted = 0;
    for (const uid of ids) {
      const { error: e } = await supabase.from('notifications').insert({ user_id: uid, contact_id: null, title, body: messageBody, data: { orderId } });
      if (!e) inserted++;
    }
    return jsonResponse({ success: inserted > 0, inserted, total_targets: ids.length }, 200);

  } catch (error) {
    const msg = errorToString(error);
    await logDb(supabase, 'notify-role', 'error', msg);
    return jsonResponse({ success: false, error: msg }, 500);
  }
});
