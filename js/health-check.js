// Health Check: valida Edge Functions y Google Sheets
(function(){
  async function runHealthCheck(){
    const results = { ensureOwner: null, createCollab: null, updateCollab: null, sheets: null };

    try {
      // Obtener sesión para invocar ensure-owner-profile usando supabase.functions.invoke
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      if (session?.access_token) {
        const { data, error } = await supabaseConfig.client.functions.invoke('ensure-owner-profile', {
          body: {},
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        results.ensureOwner = { ok: !error, data, error: error?.message };
      } else {
        results.ensureOwner = { ok: false, error: 'No session token' };
      }
    } catch (e){ results.ensureOwner = { ok: false, error: e?.message || String(e) }; }

    // Crear colaborador de prueba
    const testEmail = `test.collab.${Date.now()}@example.com`;
    const testPassword = 'Test1234!';
    try {
      const { data, error } = await supabaseConfig.client.functions.invoke('process-collaborator-requests', {
        body: {
          action: 'create_collaborator',
          collaboratorData: {
            email: testEmail,
            password: testPassword,
            name: 'Tester Auto',
            phone: '8090000000',
            matricula: `TST-${Date.now()}`
          }
        }
      });
      results.createCollab = { ok: !error && !!data?.success, data, error: error?.message };
      const newUserId = data?.collaborator_id || data?.user?.id || data?.user_id || null;

      // Actualizar colaborador (si se obtuvo user_id)
      if (newUserId) {
        const { data: updData, error: updError } = await supabaseConfig.client.functions.invoke('update-collaborator', {
          body: {
            user_id: newUserId,
            name: 'Tester Actualizado',
            phone: '8091112222'
          }
        });
        results.updateCollab = { ok: !updError, data: updData, error: updError?.message };
      } else {
        results.updateCollab = { ok: false, error: 'No user_id from create-collaborator' };
      }
    } catch(e){ results.createCollab = { ok: false, error: e?.message || String(e) } }

    // Probar Google Sheets
    try {
      if (typeof googleSheetsIntegration !== 'undefined'){
        const ok = await googleSheetsIntegration.testConnection();
        results.sheets = { ok };
      } else {
        results.sheets = { ok: false, error: 'googleSheetsIntegration not available' };
      }
    } catch(e){ results.sheets = { ok: false, error: e?.message || String(e) } }

    console.log('Health Check Results:', results);
    alert(`Health Check\nensure-owner: ${results.ensureOwner?.ok ? 'OK' : 'FAIL'}\ncreate-collaborator: ${results.createCollab?.ok ? 'OK' : 'FAIL'}\nupdate-collaborator: ${results.updateCollab?.ok ? 'OK' : 'FAIL'}\nGoogle Sheets: ${results.sheets?.ok ? 'OK' : 'FAIL'}`);
    return results;
  }

  // Exportar globalmente
  window.runHealthCheck = runHealthCheck;
})();