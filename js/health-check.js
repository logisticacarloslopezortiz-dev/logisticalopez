/**
 * health-check.js — Error boundaries y monitoreo para producción
 * Incluir en todas las páginas antes de cualquier otro script.
 */
(function() {
  'use strict';

  // ── Global error boundary ─────────────────────────────────────────────────
  window.addEventListener('error', function(e) {
    const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    if (!isProd) return;
    // Log silencioso en producción — no mostrar al usuario
    try {
      const payload = {
        type: 'js_error',
        message: e.message,
        filename: e.filename,
        line: e.lineno,
        col: e.colno,
        url: window.location.href,
        ua: navigator.userAgent.substring(0, 100),
        ts: new Date().toISOString()
      };
      // Guardar en localStorage para diagnóstico
      const logs = JSON.parse(localStorage.getItem('tlc_error_log') || '[]');
      logs.unshift(payload);
      localStorage.setItem('tlc_error_log', JSON.stringify(logs.slice(0, 20)));
    } catch(_) {}
  });

  window.addEventListener('unhandledrejection', function(e) {
    const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    if (!isProd) return;
    try {
      const logs = JSON.parse(localStorage.getItem('tlc_error_log') || '[]');
      logs.unshift({ type: 'promise_rejection', message: String(e.reason), url: window.location.href, ts: new Date().toISOString() });
      localStorage.setItem('tlc_error_log', JSON.stringify(logs.slice(0, 20)));
    } catch(_) {}
  });

  // ── Online/Offline indicator ──────────────────────────────────────────────
  function updateOnlineStatus() {
    const el = document.getElementById('offline-indicator');
    if (!el) return;
    if (navigator.onLine) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  document.addEventListener('DOMContentLoaded', updateOnlineStatus);

  // ── Performance mark ─────────────────────────────────────────────────────
  if (window.performance && window.performance.mark) {
    window.performance.mark('app-start');
  }

})();
