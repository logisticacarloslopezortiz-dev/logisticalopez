require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn('Advertencia: faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY en .env');
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Endpoint para obtener la clave pública
app.get('/api/vapidPublicKey', (_req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
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