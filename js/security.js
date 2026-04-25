/**
 * security.js — Medidas de seguridad globales para producción
 * Incluye: rate limiting, bloqueo clic derecho, protección de consola
 */
(function() {
  'use strict';

  // ── 1. Rate Limiting de Login ─────────────────────────────────────────────
  const RATE_KEY = 'tlc_login_attempts';
  const MAX_ATTEMPTS = 3;
  const LOCKOUT_MS = 60 * 1000; // 1 minuto

  window.LoginRateLimit = {
    _data() {
      try { return JSON.parse(localStorage.getItem(RATE_KEY) || '{}'); } catch(_) { return {}; }
    },
    _save(d) { try { localStorage.setItem(RATE_KEY, JSON.stringify(d)); } catch(_) {} },

    check(email) {
      const d = this._data();
      const key = (email || 'global').toLowerCase();
      const entry = d[key] || { count: 0, lockedUntil: 0 };
      const now = Date.now();
      if (entry.lockedUntil > now) {
        const secs = Math.ceil((entry.lockedUntil - now) / 1000);
        return { allowed: false, secondsLeft: secs };
      }
      // Reset if lockout expired
      if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
        entry.count = 0;
        entry.lockedUntil = 0;
        d[key] = entry;
        this._save(d);
      }
      return { allowed: true, attemptsLeft: MAX_ATTEMPTS - entry.count };
    },

    recordFailure(email) {
      const d = this._data();
      const key = (email || 'global').toLowerCase();
      const entry = d[key] || { count: 0, lockedUntil: 0 };
      entry.count = (entry.count || 0) + 1;
      if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_MS;
        entry.count = 0;
      }
      d[key] = entry;
      this._save(d);
      return entry;
    },

    recordSuccess(email) {
      const d = this._data();
      const key = (email || 'global').toLowerCase();
      delete d[key];
      this._save(d);
    },

    // Muestra countdown en un elemento
    startCountdown(email, el, onUnlock) {
      const update = () => {
        const { allowed, secondsLeft } = this.check(email);
        if (allowed) { if (el) el.textContent = ''; if (onUnlock) onUnlock(); return; }
        if (el) el.textContent = `Demasiados intentos. Espera ${secondsLeft}s para intentar de nuevo.`;
        setTimeout(update, 1000);
      };
      update();
    }
  };

  // ── 2. Bloqueo clic derecho (solo en páginas de login e index) ────────────
  const protectedPages = ['login.html', 'login-colaborador.html', 'index.html', '/'];
  const path = window.location.pathname;
  const isProtected = protectedPages.some(p => path.endsWith(p) || path === p);

  if (isProtected) {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', e => {
      // Bloquear F12, Ctrl+Shift+I, Ctrl+U (ver fuente)
      if (e.key === 'F12') { e.preventDefault(); return false; }
      if (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key.toUpperCase())) { e.preventDefault(); return false; }
      if (e.ctrlKey && e.key.toUpperCase() === 'U') { e.preventDefault(); return false; }
    });
  }

  // ── 3. Un usuario por dispositivo ────────────────────────────────────────
  // Device ID persistente
  const DEV_KEY = 'tlc_device_id';
  if (!localStorage.getItem(DEV_KEY)) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    localStorage.setItem(DEV_KEY, Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join(''));
  }
  window.getDeviceId = () => localStorage.getItem(DEV_KEY);

  // ── 4. Protección básica de consola en producción ─────────────────────────
  const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  if (isProd) {
    const noop = () => {};
    // Solo silenciar logs, no errores (para no ocultar bugs reales)
    try { console.log = noop; console.debug = noop; console.info = noop; } catch(_) {}
  }

})();
