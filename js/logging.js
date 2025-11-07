// js/logging.js
// Captura global de errores y rechazos de promesas para observabilidad básica
(function(){
  function serializeError(err){
    if (!err) return {};
    return {
      message: err.message || String(err),
      stack: err.stack || null,
      name: err.name || null
    };
  }

  function logClientError(eventType, payload){
    try {
      const entry = {
        eventType,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        payload
      };
      // Consola
      console.error('[ClientLog]', entry);
      // Persistencia local (últimos 50)
      const key = 'tlc_client_logs';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push(entry);
      while (existing.length > 50) existing.shift();
      localStorage.setItem(key, JSON.stringify(existing));
      // Se puede extender para enviar a Supabase (client_logs) si existe una API segura
    } catch(e) { /* noop */ }
  }

  window.addEventListener('error', (event) => {
    logClientError('error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: serializeError(event.error)
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logClientError('unhandledrejection', {
      reason: serializeError(event.reason)
    });
  });
})();