// super-admin.js — Panel del Creador LLO v2
'use strict';
const SA_ID = '93b6577f-69ee-4cbd-9f4c-54dabf75920f';
const SHEET_ID = '1oVFJLmOaSQ-hz0DdqnHh_tCW5ON__jPM6GBqJQjIwGs';
const FEATURES_DEFAULT = [
  { key:'enable_whatsapp',     label:'WhatsApp automático',    desc:'Envío de mensajes WA al cliente' },
  { key:'enable_invoice',      label:'Facturación automática', desc:'Generación de facturas PDF' },
  { key:'enable_rating',       label:'Sistema de calificación',desc:'Link de rating al completar orden' },
  { key:'enable_gps',          label:'Rastreo GPS',            desc:'Ubicación en tiempo real' },
  { key:'enable_pwa',          label:'PWA / App instalable',   desc:'Botón de instalación en login' },
  { key:'enable_notifications',label:'Notificaciones Push',    desc:'OneSignal push notifications' },
];
let _charts = {};
const fmt$ = n => '$' + (Number(n)||0).toLocaleString('es-DO',{minimumFractionDigits:2});
const fmtDate = d => d ? new Date(d).toLocaleDateString('es-DO',{day:'2-digit',month:'short',year:'numeric'}) : '—';

function destroyChart(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }
function mkChart(id, type, data, extra = {}) {
  destroyChart(id);
  const ctx = document.getElementById(id); if (!ctx) return;
  const noAxes = type === 'pie' || type === 'doughnut';
  _charts[id] = new Chart(ctx, { type, data, options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
    scales: noAxes ? undefined : {
      x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
    }, ...extra
  }});
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function saInit() {
  try {
    await supabaseConfig.ensureSupabaseReady?.();
    const { data: { session } } = await supabaseConfig.client.auth.getSession();
    if (!session || session.user.id !== SA_ID) {
      window.location.href = 'login.html?redirect=super-admin.html'; return;
    }
    const emailEl = document.getElementById('sa-email-display');
    if (emailEl) emailEl.textContent = session.user.email;
    document.getElementById('sa-loading').style.display = 'none';
    document.getElementById('sa-app').style.display = '';
    if (window.lucide) lucide.createIcons();
    saUpdateTime();
    saLoadDashboard();
  } catch(e) { window.location.href = 'login.html?redirect=super-admin.html'; }
}
async function saLogout() { await supabaseConfig.client.auth.signOut(); window.location.href = 'login.html'; }
function saUpdateTime() { const el = document.getElementById('sa-last-update'); if (el) el.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-DO'); }
function saRefresh() {
  const active = document.querySelector('.sa-tab-content.active');
  if (!active) return;
  const id = active.id.replace('tab-', '');
  ({ dashboard:saLoadDashboard, analytics:saLoadAnalytics, behavior:saLoadBehavior,
     users:saLoadUsers, orders:saLoadOrders, fees:saLoadFees,
     features:saLoadFeatures, audit:saLoadAudit })[id]?.();
  saUpdateTime();
}
function saNav(name, el) {
  document.querySelectorAll('.sa-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#sa-sidebar nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  if (el) el.classList.add('active');
  const T = { dashboard:'Dashboard', analytics:'Analíticas', behavior:'Comportamiento',
    users:'Usuarios', orders:'Órdenes', fees:'Cobros 5%', features:'Features', audit:'Auditoría' };
  const S = { dashboard:'Vista ejecutiva del sistema', analytics:'Gráficos y métricas',
    behavior:'Análisis de comportamiento', users:'Gestión de usuarios',
    orders:'Todas las órdenes', fees:'Sistema de cobros 5%',
    features:'Control de funcionalidades', audit:'Logs de actividad' };
  document.getElementById('sa-page-title').textContent = T[name] || name;
  document.getElementById('sa-page-sub').textContent = S[name] || '';
  ({ dashboard:saLoadDashboard, analytics:saLoadAnalytics, behavior:saLoadBehavior,
     users:saLoadUsers, orders:saLoadOrders, fees:saLoadFees,
     features:saLoadFeatures, audit:saLoadAudit })[name]?.();
  if (window.lucide) lucide.createIcons();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function saLoadDashboard() {
  try {
    const [r1, r2, r3] = await Promise.all([
      supabaseConfig.client.from('orders').select('id,status,monto_cobrado,created_at,name,service:services(name)'),
      supabaseConfig.client.from('collaborators').select('id,name,status'),
      supabaseConfig.client.from('fee_payments').select('amount,status').catch(() => ({ data: [] }))
    ]);
    const orders = r1.data || [];
    const collabs = r2.data || [];
    const fees = r3.data || [];
    const total = orders.length;
    const completed = orders.filter(o => o.status === 'completed').length;
    const billed = orders.reduce((s, o) => s + Number(o.monto_cobrado || 0), 0);
    const fee = billed * 0.05;
    const active = collabs.filter(c => c.status === 'activo').length;
    const feePending = fees.filter(f => f.status === 'pending_review').reduce((s, f) => s + Number(f.amount || 0), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('st-total', total);
    set('st-total-sub', completed + ' completadas');
    set('st-completed', completed);
    set('st-rate', total ? Math.round(completed / total * 100) + '% tasa de éxito' : '—');
    set('st-billed', fmt$(billed));
    set('st-fee', fmt$(fee));
    set('st-fee-pending', fmt$(feePending) + ' pendiente');
    set('st-collabs', collabs.length);
    set('st-collabs-active', active + ' activos');

    // Recent orders
    const recent = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
    const ro = document.getElementById('sa-recent-orders');
    if (ro) ro.innerHTML = recent.map(o => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 1.25rem;border-bottom:1px solid var(--border)">
        <div><div style="font-size:.82rem;color:#fff;font-weight:600">${o.name || '—'}</div>
        <div style="font-size:.7rem;color:var(--muted)">${o.service?.name || '—'} · ${fmtDate(o.created_at)}</div></div>
        <span class="badge ${o.status==='completed'?'badge-green':o.status==='cancelled'?'badge-red':o.status==='pending'?'badge-yellow':'badge-blue'}">${o.status}</span>
      </div>`).join('');

    // Top services
    const svcCount = {};
    orders.forEach(o => { const k = o.service?.name || 'Sin servicio'; svcCount[k] = (svcCount[k] || 0) + 1; });
    const sorted = Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxV = sorted[0]?.[1] || 1;
    const ts = document.getElementById('sa-top-services');
    if (ts) ts.innerHTML = sorted.map(([k, v]) => `
      <div style="margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.25rem">
          <span style="color:var(--text)">${k}</span><span style="color:var(--muted)">${v}</span></div>
        <div style="height:4px;background:var(--border);border-radius:2px">
          <div style="height:4px;background:var(--accent);border-radius:2px;width:${Math.round(v/maxV*100)}%;transition:width .5s"></div></div>
      </div>`).join('');

    // Chart: orders by month
    const months = {};
    orders.forEach(o => { const m = o.created_at?.slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; });
    const mKeys = Object.keys(months).sort().slice(-6);
    mkChart('chart-orders-month', 'bar', {
      labels: mKeys.map(m => new Date(m + '-01').toLocaleString('es-DO', { month: 'short' })),
      datasets: [{ label: 'Órdenes', data: mKeys.map(k => months[k]), backgroundColor: 'rgba(79,110,247,.7)', borderRadius: 4 }]
    });

    // Chart: status pie
    const sc = { pending: 0, accepted: 0, in_progress: 0, completed: 0, cancelled: 0 };
    orders.forEach(o => { if (sc[o.status] !== undefined) sc[o.status]++; });
    mkChart('chart-status-pie', 'doughnut', {
      labels: ['Pendiente', 'Aceptada', 'En curso', 'Completada', 'Cancelada'],
      datasets: [{ data: Object.values(sc), backgroundColor: ['#f59e0b','#4f6ef7','#06b6d4','#10b981','#ef4444'], borderWidth: 0 }]
    });
  } catch(e) { console.error('Dashboard error:', e); }
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function saLoadAnalytics() {
  try {
    const { data: orders } = await supabaseConfig.client.from('orders')
      .select('monto_cobrado,completed_at,created_at,status,assigned_to,collaborator:collaborators!assigned_to(name)');
    const rev = {};
    (orders || []).filter(o => o.status === 'completed' && o.monto_cobrado).forEach(o => {
      const m = (o.completed_at || o.created_at)?.slice(0, 7); if (m) rev[m] = (rev[m] || 0) + Number(o.monto_cobrado);
    });
    const rKeys = Object.keys(rev).sort().slice(-6);
    const labels = rKeys.map(m => new Date(m + '-01').toLocaleString('es-DO', { month: 'short' }));
    mkChart('chart-revenue', 'bar', { labels, datasets: [{ label: 'Ingresos', data: rKeys.map(k => rev[k]), backgroundColor: 'rgba(16,185,129,.7)', borderRadius: 4 }] });
    mkChart('chart-fee-monthly', 'bar', { labels, datasets: [{ label: '5% Plataforma', data: rKeys.map(k => rev[k] * 0.05), backgroundColor: 'rgba(245,158,11,.7)', borderRadius: 4 }] });
    const cp = {};
    (orders || []).filter(o => o.status === 'completed' && o.assigned_to).forEach(o => {
      const n = o.collaborator?.name || o.assigned_to; cp[n] = (cp[n] || 0) + 1;
    });
    const cpS = Object.entries(cp).sort((a, b) => b[1] - a[1]).slice(0, 8);
    mkChart('chart-collab-perf', 'bar', {
      labels: cpS.map(([k]) => k),
      datasets: [{ label: 'Completadas', data: cpS.map(([, v]) => v), backgroundColor: 'rgba(124,58,237,.7)', borderRadius: 4 }]
    }, { indexAxis: 'y' });
  } catch(e) { console.error('Analytics error:', e); }
}

// ── Behavior ──────────────────────────────────────────────────────────────────
async function saLoadBehavior() {
  try {
    const { data: orders } = await supabaseConfig.client.from('orders').select('created_at,status,assigned_to,monto_cobrado');
    const total = orders?.length || 0;
    const completed = (orders || []).filter(o => o.status === 'completed').length;
    const cancelled = (orders || []).filter(o => o.status === 'cancelled').length;
    const avgVal = (orders || []).filter(o => o.monto_cobrado).reduce((s, o, _, a) => s + Number(o.monto_cobrado) / a.length, 0);
    const billed = (orders || []).reduce((s, o) => s + Number(o.monto_cobrado || 0), 0);
    const assigned = (orders || []).filter(o => o.assigned_to).length;
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const row = (label, val, color = '#fff') => `<div style="display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border)"><span>${label}</span><span style="color:${color};font-weight:700">${val}</span></div>`;
    set('beh-clients', row('Total solicitudes', total) + row('Tasa de completado', (total ? Math.round(completed/total*100) : 0) + '%', '#34d399') + row('Tasa de cancelación', (total ? Math.round(cancelled/total*100) : 0) + '%', '#f87171') + row('Valor promedio', fmt$(avgVal), '#fcd34d'));
    set('beh-collabs', row('Órdenes asignadas', assigned) + row('Completadas', completed, '#34d399') + row('Tasa de éxito', (assigned ? Math.round(completed/assigned*100) : 0) + '%', '#818cf8'));
    set('beh-admin', row('Total facturado', fmt$(billed), '#fcd34d') + row('5% plataforma', fmt$(billed * 0.05), '#a78bfa') + row('Órdenes activas', (orders || []).filter(o => !['completed','cancelled'].includes(o.status)).length, '#22d3ee'));
    // Charts
    const days = [0,0,0,0,0,0,0];
    (orders || []).forEach(o => { if (o.created_at) days[new Date(o.created_at).getDay()]++; });
    mkChart('chart-freq-day', 'bar', { labels: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'], datasets: [{ label: 'Solicitudes', data: days, backgroundColor: 'rgba(79,110,247,.7)', borderRadius: 4 }] });
    const hours = Array(24).fill(0);
    (orders || []).forEach(o => { if (o.created_at) hours[new Date(o.created_at).getHours()]++; });
    mkChart('chart-freq-hour', 'line', { labels: Array.from({length:24}, (_, i) => i + 'h'), datasets: [{ label: 'Solicitudes', data: hours, borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,.15)', fill: true, tension: .4, pointRadius: 3 }] });
  } catch(e) { console.error('Behavior error:', e); }
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function saLoadUsers() {
  const tbody = document.getElementById('sa-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr>';
  try {
    const search = (document.getElementById('sa-user-search')?.value || '').toLowerCase();
    const role = document.getElementById('sa-user-role-filter')?.value || 'all';
    let q = supabaseConfig.client.from('collaborators').select('*').order('created_at', { ascending: false });
    if (role !== 'all') q = q.eq('role', role);
    const { data: collabs } = await q;
    const { data: orders } = await supabaseConfig.client.from('orders').select('assigned_to,status');
    const oc = {};
    (orders || []).forEach(o => { if (o.assigned_to) { if (!oc[o.assigned_to]) oc[o.assigned_to] = { total: 0, completed: 0 }; oc[o.assigned_to].total++; if (o.status === 'completed') oc[o.assigned_to].completed++; } });
    const filtered = (collabs || []).filter(c => !search || c.name?.toLowerCase().includes(search) || c.email?.toLowerCase().includes(search));
    tbody.innerHTML = filtered.map(c => {
      const s = oc[c.id] || { total: 0, completed: 0 };
      return `<tr>
        <td><div style="font-weight:600;color:#fff">${c.name||'—'}</div><div style="font-size:.72rem;color:var(--muted)">${c.email||''}</div></td>
        <td><span class="badge badge-purple">${c.role||'colaborador'}</span></td>
        <td><span class="badge ${c.status==='activo'?'badge-green':'badge-red'}">${c.status||'inactivo'}</span></td>
        <td style="color:var(--text)">${s.total} <span style="color:var(--muted);font-size:.72rem">(${s.completed} ✓)</span></td>
        <td style="color:var(--muted);font-size:.78rem">${fmtDate(c.updated_at)}</td>
        <td><button onclick="saToggleUser('${c.id}','${c.status}')" class="sa-btn ${c.status==='activo'?'sa-btn-danger':'sa-btn-success'}" style="font-size:.72rem;padding:.3rem .7rem">${c.status==='activo'?'Desactivar':'Activar'}</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Sin usuarios</td></tr>';
  } catch(e) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#f87171">Error: ${e.message}</td></tr>`; }
}
async function saToggleUser(id, cur) {
  const ns = cur === 'activo' ? 'inactivo' : 'activo';
  if (!confirm(`¿${ns === 'activo' ? 'Activar' : 'Desactivar'} este usuario?`)) return;
  await supabaseConfig.client.from('collaborators').update({ status: ns }).eq('id', id);
  saLogAudit('toggle_user', `${id} → ${ns}`);
  saLoadUsers();
}

// ── Orders ────────────────────────────────────────────────────────────────────
async function saLoadOrders() {
  const tbody = document.getElementById('sa-orders-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr>';
  try {
    const search = (document.getElementById('sa-order-search')?.value || '').toLowerCase();
    const status = document.getElementById('sa-order-status-filter')?.value || 'all';
    let q = supabaseConfig.client.from('orders').select('id,short_id,name,phone,status,monto_cobrado,created_at,service:services(name)').order('created_at', { ascending: false }).limit(100);
    if (status !== 'all') q = q.eq('status', status);
    const { data: orders } = await q;
    const filtered = (orders || []).filter(o => !search || o.name?.toLowerCase().includes(search) || String(o.id).includes(search) || o.short_id?.toLowerCase().includes(search));
    tbody.innerHTML = filtered.map(o => `<tr>
      <td style="font-family:monospace;color:var(--muted);font-size:.78rem">#${o.short_id||o.id}</td>
      <td><div style="color:#fff;font-weight:600">${o.name||'—'}</div><div style="font-size:.72rem;color:var(--muted)">${o.phone||''}</div></td>
      <td style="color:var(--text)">${o.service?.name||'—'}</td>
      <td><span class="badge ${o.status==='completed'?'badge-green':o.status==='cancelled'?'badge-red':o.status==='pending'?'badge-yellow':'badge-blue'}">${o.status}</span></td>
      <td style="color:#fcd34d;font-weight:600">${o.monto_cobrado ? fmt$(o.monto_cobrado) : '—'}</td>
      <td style="color:var(--muted);font-size:.78rem">${fmtDate(o.created_at)}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Sin órdenes</td></tr>';
  } catch(e) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#f87171">Error: ${e.message}</td></tr>`; }
}

// ── Fees ──────────────────────────────────────────────────────────────────────
async function saLoadFees() {
  const tbody = document.getElementById('sa-fees-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr>';
  try {
    const filter = document.getElementById('sa-fee-filter')?.value || 'all';
    let q = supabaseConfig.client.from('fee_payments').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data: fees, error: fErr } = await q;
    if (fErr) throw fErr;
    const pending = (fees || []).filter(f => f.status === 'pending_review');
    const approved = (fees || []).filter(f => f.status === 'approved');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('fee-pending-count', pending.length);
    set('fee-total-collected', fmt$(approved.reduce((s, f) => s + Number(f.amount || 0), 0)));
    const { data: orders } = await supabaseConfig.client.from('orders').select('monto_cobrado,completed_at').eq('status', 'completed').not('monto_cobrado', 'is', null);
    const now = new Date(); const m = now.getMonth(); const y = now.getFullYear();
    const mFee = (orders || []).filter(o => { const d = new Date(o.completed_at || ''); return d.getMonth() === m && d.getFullYear() === y; }).reduce((s, o) => s + Number(o.monto_cobrado || 0) * 0.05, 0);
    set('fee-month', fmt$(mFee));
    tbody.innerHTML = (fees || []).map(f => `<tr>
      <td style="color:var(--text)">${f.period || f.created_at?.slice(0,7) || '—'}</td>
      <td style="color:#fcd34d;font-weight:700">${fmt$(f.amount || 0)}</td>
      <td>${f.voucher_url ? `<a href="${f.voucher_url}" target="_blank" style="color:var(--accent);font-size:.78rem;text-decoration:none">Ver comprobante ↗</a>` : '<span style="color:var(--muted);font-size:.78rem">Sin voucher</span>'}</td>
      <td style="color:var(--muted);font-size:.78rem;max-width:160px;overflow:hidden;text-overflow:ellipsis">${f.note || '—'}</td>
      <td><span class="badge ${f.status==='approved'?'badge-green':f.status==='rejected'?'badge-red':'badge-yellow'}">${f.status || 'pending'}</span></td>
      <td><div style="display:flex;gap:.4rem">${f.status === 'pending_review' ? `
        <button onclick="saApproveFee('${f.id}')" class="sa-btn sa-btn-success" style="font-size:.72rem;padding:.3rem .7rem">✅ Aprobar</button>
        <button onclick="saRejectFee('${f.id}')" class="sa-btn sa-btn-danger" style="font-size:.72rem;padding:.3rem .7rem">❌ Rechazar</button>` : '—'}</div></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Sin registros</td></tr>';
  } catch(e) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Tabla fee_payments no encontrada. Ejecuta el schema SQL.</td></tr>'; }
}
async function saApproveFee(id) { await supabaseConfig.client.from('fee_payments').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', id); saLogAudit('approve_fee', `Pago ${id} aprobado`); saLoadFees(); }
async function saRejectFee(id) { const r = prompt('Motivo del rechazo:'); if (r === null) return; await supabaseConfig.client.from('fee_payments').update({ status: 'rejected', note: r, reviewed_at: new Date().toISOString() }).eq('id', id); saLogAudit('reject_fee', `Pago ${id} rechazado`); saLoadFees(); }

// ── Features ──────────────────────────────────────────────────────────────────
async function saLoadFeatures() {
  const container = document.getElementById('sa-features-list');
  if (!container) return;
  try {
    const { data: s } = await supabaseConfig.client.from('business').select('id,feature_flags').limit(1).maybeSingle();
    const flags = s?.feature_flags || {};
    container.innerHTML = FEATURES_DEFAULT.map(f => {
      const on = flags[f.key] !== false;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.85rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:.625rem">
        <div><div style="font-size:.85rem;font-weight:600;color:#fff">${f.label}</div><div style="font-size:.72rem;color:var(--muted);margin-top:.15rem">${f.desc}</div></div>
        <button onclick="saToggleFeature('${f.key}',${!on})" class="sa-btn ${on ? 'sa-btn-danger' : 'sa-btn-success'}" style="font-size:.75rem;padding:.35rem .85rem;flex-shrink:0;margin-left:1rem">${on ? 'Desactivar' : 'Activar'}</button>
      </div>`;
    }).join('');
  } catch(e) { if (container) container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Error cargando features</p>'; }
}
async function saToggleFeature(key, val) {
  try {
    const { data: s } = await supabaseConfig.client.from('business').select('id,feature_flags').limit(1).maybeSingle();
    const flags = { ...(s?.feature_flags || {}), [key]: val };
    if (s?.id) await supabaseConfig.client.from('business').update({ feature_flags: flags }).eq('id', s.id);
    saLogAudit('toggle_feature', `${key} → ${val}`);
    saLoadFeatures();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── Audit ─────────────────────────────────────────────────────────────────────
async function saLoadAudit() {
  const tbody = document.getElementById('sa-audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr>';
  try {
    const { data: logs } = await supabaseConfig.client.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    tbody.innerHTML = (logs || []).map(l => `<tr>
      <td style="color:var(--muted);font-size:.75rem;white-space:nowrap">${new Date(l.created_at).toLocaleString('es-DO')}</td>
      <td style="color:var(--text);font-size:.78rem">${l.user_email || l.user_id || '—'}</td>
      <td><span class="badge badge-blue" style="font-size:.68rem">${l.action || '—'}</span></td>
      <td style="color:var(--muted);font-size:.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.detail || '—'}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Sin logs</td></tr>';
  } catch(e) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Tabla audit_logs no encontrada. Ejecuta el schema SQL.</td></tr>'; }
}

// ── Audit log helper ──────────────────────────────────────────────────────────
function saLogAudit(action, detail) {
  try { supabaseConfig.client.from('audit_logs').insert({ action, detail, user_id: SA_ID, user_email: 'luisalfredocabrerareyes@gmail.com', created_at: new Date().toISOString() }).then(() => {}); } catch(_) {}
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', saInit);
