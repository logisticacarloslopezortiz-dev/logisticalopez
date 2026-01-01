document.addEventListener('DOMContentLoaded', () => {
  if (!window.supabaseConfig?.client) return;
  const ids = {
    total: document.getElementById('gmTotal'),
    month: document.getElementById('gmMonth'),
    today: document.getElementById('gmToday')
  };
  const fmt = (n) => `RD$ ${Number(n||0).toLocaleString('es-DO',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  async function load() {
    try {
      try { await supabaseConfig.ensureFreshSession?.(); } catch(_) {}
      const COMPLETED = ['Completada','completada','Entregada','entregada','Finalizada','finalizada','Completado','completado'];
      const now = new Date();
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const resp = await (supabaseConfig.withAuthRetry?.(() => supabaseConfig.client
        .from('orders')
        .select('id, status, completed_at, monto_cobrado')
        .in('status', COMPLETED)
        .not('monto_cobrado','is',null)
      ) || supabaseConfig.client
        .from('orders')
        .select('id, status, completed_at, monto_cobrado')
        .in('status', COMPLETED)
        .not('monto_cobrado','is',null));
      const rows = Array.isArray(resp.data) ? resp.data : [];
      const total = rows.reduce((s,r)=>s+((typeof r.monto_cobrado==='string')?parseFloat(r.monto_cobrado):(r.monto_cobrado||0)),0);
      const month = rows.filter(r=>r.completed_at && new Date(r.completed_at)>=startMonth)
        .reduce((s,r)=>s+((typeof r.monto_cobrado==='string')?parseFloat(r.monto_cobrado):(r.monto_cobrado||0)),0);
      const today = rows.filter(r=>{const d=r.completed_at?new Date(r.completed_at):null; if(!d) return false; const t=new Date();return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth()&&d.getDate()===t.getDate();})
        .reduce((s,r)=>s+((typeof r.monto_cobrado==='string')?parseFloat(r.monto_cobrado):(r.monto_cobrado||0)),0);
      if (ids.total) ids.total.textContent = fmt(total);
      if (ids.month) ids.month.textContent = fmt(month);
      if (ids.today) ids.today.textContent = fmt(today);
    } catch(_) {}
  }
  load();
  try {
    const ch = supabaseConfig.client
      .channel('gm-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => { try { await load(); } catch(_) {} })
      .subscribe();
    window.__gm_channel = ch;
  } catch(_) {}
});
