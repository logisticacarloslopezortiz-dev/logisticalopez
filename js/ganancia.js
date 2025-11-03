document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  loadGanancias();
});

async function loadGanancias() {
  const totalEl = document.getElementById('totalGanancia');
  const tbody = document.getElementById('ordersTableBody');
  if (!supabaseConfig || !supabaseConfig.client) {
    totalEl.textContent = 'Error de conexión';
    return;
  }

  // Intentar sesionar fresco; si falla, continuar
  try { await supabaseConfig.ensureFreshSession?.(); } catch (_) {}

  const statuses = ['Completada', 'Completado'];
  let client = supabaseConfig.client;

  // Intentar consulta y fallback a cliente público si hay RLS
  async function fetchCompleted() {
    try {
      const { data, error, status } = await client
        .from('orders')
        .select('id, short_id, name, status, monto_cobrado, completed_at')
        .in('status', statuses)
        .not('monto_cobrado', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const code = err?.code || '';
      if (code === 'PGRST303' || /rls|not authorized|permission/i.test(msg)) {
        try {
          const publicClient = supabaseConfig.getPublicClient?.();
          if (publicClient) {
            client = publicClient;
            const resp = await publicClient
              .from('orders')
              .select('id, short_id, name, status, monto_cobrado, completed_at')
              .in('status', statuses)
              .not('monto_cobrado', 'is', null)
              .order('completed_at', { ascending: false })
              .limit(50);
            if (resp.error) throw resp.error;
            return resp.data || [];
          }
        } catch (e2) {
          console.warn('Fallback anon falló:', e2);
        }
      }
      throw err;
    }
  }

  try {
    const rows = await fetchCompleted();
    // Sumar montos como número; aceptar string o number
    const total = rows.reduce((sum, r) => {
      const val = (typeof r.monto_cobrado === 'string') ? parseFloat(r.monto_cobrado) : (r.monto_cobrado || 0);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    totalEl.textContent = `RD$ ${total.toFixed(2)}`;

    // Renderizar tabla
    tbody.innerHTML = rows.map(r => {
      const code = r.short_id || r.id;
      const statusText = (r.status === 'Completada') ? 'Completado' : r.status;
      const monto = (typeof r.monto_cobrado === 'string') ? parseFloat(r.monto_cobrado) : (r.monto_cobrado || 0);
      const fecha = r.completed_at ? new Date(r.completed_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
      return `
        <tr class="border-t">
          <td class="px-4 py-2 text-sm text-gray-800">${code}</td>
          <td class="px-4 py-2 text-sm text-gray-600">${r.name || '-'}</td>
          <td class="px-4 py-2 text-sm">
            <span class="inline-flex items-center px-2 py-1 rounded text-white bg-green-600">${statusText}</span>
          </td>
          <td class="px-4 py-2 text-sm text-right font-semibold">RD$ ${isNaN(monto) ? '0.00' : monto.toFixed(2)}</td>
          <td class="px-4 py-2 text-sm text-gray-600">${fecha}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando ganancias:', err);
    totalEl.textContent = 'Error al cargar';
    tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-3 text-red-600">${err?.message || 'No se pudieron cargar las órdenes.'}</td></tr>`;
  }
}