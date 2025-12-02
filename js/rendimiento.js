/**
 * AUTH GUARD: Verificar autenticación y autorización
 * Paso 1: Verificar sesión activa en Supabase Auth
 * Paso 2: Validar que el usuario sea un colaborador activo en tabla collaborators
 * Paso 3: Si todo es válido, cargar panel. Si no, redirigir a login.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Verificar que Supabase esté disponible
  if (!window.supabaseConfig || !supabaseConfig.client) {
    console.error('Supabase Config no inicializado. Redirigiendo a login.');
    window.location.href = 'login-colaborador.html';
    return;
  }

  // Paso 1: Obtener sesión activa
  let session = null;
  try {
    // Intentar refrescar sesión si es necesario
    if (supabaseConfig.ensureFreshSession) {
      try { await supabaseConfig.ensureFreshSession(); } catch (e) { /* no-op */ }
    }
    const { data } = await supabaseConfig.client.auth.getSession();
    session = data?.session;
  } catch (e) {
    console.error('Error obteniendo sesión:', e);
  }

  if (!session) {
    console.warn('No hay sesión activa. Redirigiendo a login.');
    try { localStorage.removeItem('userRole'); localStorage.removeItem('collaboratorId'); localStorage.removeItem('tlc_active_job'); localStorage.removeItem('tlc_offline_updates'); } catch(_){}
    window.location.href = 'login-colaborador.html';
    return;
  }

  const userId = session.user?.id;
  console.log('Sesión activa. Usuario ID:', userId);

  // Paso 2: Validar que sea colaborador activo en la BD
  const validation = await supabaseConfig.validateActiveCollaborator(userId);
  
  if (!validation.isValid) {
    console.error('Validación fallida:', validation.error);
    
    // Mostrar alerta al usuario
    const msg = validation.error === 'Collaborator is not active' 
      ? 'Tu cuenta ha sido desactivada. Contacta al administrador.'
      : validation.error === 'Invalid role for this panel'
      ? 'No tienes permisos de colaborador. Acceso denegado.'
      : 'No estás registrado como colaborador. Acceso denegado.';
    
    alert(msg);
    
    // Limpiar sesión y redirigir
    try {
      await supabaseConfig.client.auth.signOut();
    } catch (_) {}
    try { localStorage.removeItem('userRole'); localStorage.removeItem('collaboratorId'); localStorage.removeItem('tlc_active_job'); localStorage.removeItem('tlc_offline_updates'); } catch(_){}
    window.location.href = 'login-colaborador.html';
    return;
  }

  // Paso 3: Validación exitosa. Cargar panel
  console.log('✅ Validación de colaborador exitosa:', validation.collaborator.email);
  
  // Guardar en localStorage para referencia
  try {
    localStorage.setItem('userRole', 'colaborador');
    localStorage.setItem('collaboratorId', userId);
  } catch (_) {}

  // Cargar métricas y funcionalidades
  await loadMetrics(session.user.id);
  setupAutoRefresh(session.user.id);
});

async function loadMetrics(collabId) {
  const all = await supabaseConfig.getOrders();
  const mine = (all || []).filter(o => o.assigned_to === collabId);
  const assigned = mine.filter(o => !['completada','cancelada'].includes(String(o.status || '').toLowerCase()));
  const completed = mine.filter(o => String(o.status || '').toLowerCase() === 'completada');
  const assignedEl = document.getElementById('metricAssigned');
  if (assignedEl) assignedEl.textContent = String(assigned.length);
  const completedEl = document.getElementById('metricCompleted');
  if (completedEl) completedEl.textContent = String(completed.length);
  const avgEl = document.getElementById('metricAvgTime');
  if (avgEl) avgEl.textContent = formatAvgTime(completed);
  renderCharts(mine);
  renderWeekly(completed);
  renderServiceDistribution(mine);
  renderVehicleDistribution(mine);
  await renderUnifiedTable(collabId, completed);
}

function formatAvgTime(completed) {
  if (!completed || completed.length === 0) return '0h';
  let sum = 0;
  let count = 0;
  for (const o of completed) {
    const start = o.accepted_at ? Date.parse(o.accepted_at) : null;
    const end = o.completed_at ? Date.parse(o.completed_at) : null;
    if (start && end && end > start) {
      sum += (end - start);
      count += 1;
    }
  }
  if (count === 0) return '0h';
  const hours = Math.round(sum / count / 1000 / 60 / 60);
  return `${hours}h`;
}

let weeklyChart = null;
let servicesChart = null;
let vehiclesChart = null;
// Paginación para tabla de rendimiento
const rendPageState = { data: [], currentPage: 1, pageSize: 15, totalPages: 1 };

function formatCurrency(n) {
  try { return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(n || 0); } catch { return `$${Number(n||0).toFixed(0)}`; }
}

function renderCharts() {
  /* Se dejaron sólo los gráficos requeridos en otras funciones */
}

function renderWeekly(orders) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('chartWeekly');
  if (!ctx) return;
  const week = getWeekCounts(orders);
  if (weeklyChart) { try { weeklyChart.destroy(); } catch(_) {} }
  weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], datasets: [{ label: 'Completadas (semana actual)', data: week, backgroundColor: '#117D8B', borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function getWeekCounts(orders) {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay() || 7; // 1..7
  start.setDate(start.getDate() - (day - 1));
  start.setHours(0,0,0,0);
  const counts = [0,0,0,0,0,0,0];
  for (const o of (orders || [])) {
    const st = String(o.status || '').toLowerCase();
    if (st !== 'completada') continue;
    const d = o.completed_at ? new Date(o.completed_at) : (o.date ? new Date(o.date) : null);
    if (!d) continue;
    if (d >= start) {
      const idx = (d.getDay() || 7) - 1; // 0..6
      counts[idx] += 1;
    }
  }
  return counts;
}

function renderServiceDistribution(orders) {
  const ctx = document.getElementById('chartServices');
  if (!ctx || typeof Chart === 'undefined') return;
  const map = {};
  for (const o of (orders || [])) {
    let s = 'Otros';
    if (o.service && typeof o.service === 'object' && o.service.name) s = o.service.name;
    else if (typeof o.service === 'string') s = o.service;
    map[s] = (map[s] || 0) + 1;
  }
  const labels = Object.keys(map);
  const values = labels.map(l => map[l]);
  if (servicesChart) { try { servicesChart.destroy(); } catch(_) {} }
  servicesChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#117D8B','#3B82F6','#0C375D','#7DD3FC','#A7F3D0'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderVehicleDistribution(orders) {
  const ctx = document.getElementById('chartVehicles');
  if (!ctx || typeof Chart === 'undefined') return;
  const map = {};
  for (const o of (orders || [])) {
    let v = 'Otros';
    if (o.vehicle && typeof o.vehicle === 'object' && o.vehicle.name) v = o.vehicle.name;
    else if (typeof o.vehicle === 'string') v = o.vehicle;
    else if (o.vehicle_id) v = `ID ${o.vehicle_id}`;
    map[v] = (map[v] || 0) + 1;
  }
  const labels = Object.keys(map);
  const values = labels.map(l => map[l]);
  if (vehiclesChart) { try { vehiclesChart.destroy(); } catch(_) {} }
  vehiclesChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#facc15','#3B82F6','#0C375D','#7DD3FC','#A7F3D0'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function countThisMonth(orders) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let c = 0;
  for (const o of (orders || [])) {
    const d = o.completed_at ? new Date(o.completed_at) : (o.date ? new Date(o.date) : null);
    if (!d) continue;
    if (d.getFullYear() === year && d.getMonth() === month) c += 1;
  }
  return c;
}

function renderRecentTable(completed) {
  const body = document.getElementById('recentTable');
  if (!body) return;
  const rows = (completed || []).slice(-10).reverse().map(o => {
    const id = o.short_id ? String(o.short_id) : (o.id ? `#${o.id}` : '—');
    const cliente = o.name || 'Cliente';
    const serv = (o.service && o.service.name) ? o.service.name : (o.service || '—');
    const fecha = o.completed_at ? new Date(o.completed_at).toLocaleString('es-DO') : (o.date || '—');
    const status = o.status || 'Completada';
    return `<tr class="bg-white"><td class="px-4 py-2">${id}</td><td class="px-4 py-2">${cliente}</td><td class="px-4 py-2">${serv}</td><td class="px-4 py-2">${fecha}</td><td class="px-4 py-2">${status}</td></tr>`;
  }).join('');
  body.innerHTML = rows || '<tr><td class="px-4 py-3 text-gray-500" colspan="5">Sin registros recientes.</td></tr>';
}

async function renderMyEarnings(collabId, completed) {
  const pctEl = document.getElementById('myCommissionPct');
  const monthEl = document.getElementById('myMonthEarnings');
  const totalEl = document.getElementById('myTotalEarnings');
  if (!pctEl || !monthEl || !totalEl) return;

  let pct = 0;
  try {
    const { data, error } = await supabaseConfig.client.from('collaborators').select('commission_percent').eq('id', collabId).maybeSingle();
    if (!error && data && typeof data.commission_percent !== 'undefined') {
      pct = typeof data.commission_percent === 'number' ? data.commission_percent : (parseFloat(data.commission_percent) || 0);
    }
  } catch (_) {}
  pct = Math.max(0, Math.min(100, pct));
  pctEl.textContent = `${pct}%`;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthSum = 0;
  let totalSum = 0;
  for (const o of (completed || [])) {
    const amount = parseFloat(o.monto_cobrado) || 0;
    const colShare = amount * (pct / 100);
    totalSum += colShare;
    const d = o.completed_at ? new Date(o.completed_at) : (o.date ? new Date(o.date) : null);
    if (d && d >= monthStart) monthSum += colShare;
  }
  monthEl.textContent = formatCurrency(monthSum);
  totalEl.textContent = formatCurrency(totalSum);
}

async function renderUnifiedTable(collabId, completed) {
  const body = document.getElementById('unifiedTable');
  if (!body) return;
  let pct = 0;
  try {
    const { data, error } = await supabaseConfig.client.from('collaborators').select('commission_percent').eq('id', collabId).maybeSingle();
    if (!error && data && typeof data.commission_percent !== 'undefined') {
      pct = typeof data.commission_percent === 'number' ? data.commission_percent : (parseFloat(data.commission_percent) || 0);
    }
  } catch (_) {}
  pct = Math.max(0, Math.min(100, pct));
  const pctEl = document.getElementById('myCommissionPct');
  const monthEl = document.getElementById('myMonthEarnings');
  const totalEl = document.getElementById('myTotalEarnings');
  if (pctEl) pctEl.textContent = `${pct}%`;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthSum = 0;
  let totalSum = 0;
  const rows = (completed || []).map(o => {
    const amount = parseFloat(o.monto_cobrado) || 0;
    const colShare = amount * (pct / 100);
    totalSum += colShare;
    const d = o.completed_at ? new Date(o.completed_at) : (o.date ? new Date(o.date) : null);
    if (d && d >= monthStart) monthSum += colShare;
    const serv = (o.service && o.service.name) ? o.service.name : (o.service || '—');
    const id = o.short_id ? `#${o.short_id}` : (o.id ? `#${o.id}` : '—');
    const dateStr = d ? d.toLocaleString('es-DO') : '—';
    const stars = o.rating && typeof o.rating === 'object' ? Number(o.rating.stars || o.rating['stars'] || 0) : Number(o.rating_stars || 0);
    const starsStr = stars > 0 ? '★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(stars, 5) : '—';
    const comment = o.customer_comment || (o.rating && o.rating.comment ? o.rating.comment : '');
    const btn = comment ? `<button class="px-2 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200" data-comment="${String(comment).replace(/"/g,'&quot;')}"><i data-lucide="cloud" class="w-4 h-4"></i></button>` : '—';
    return `<tr class="bg-white"><td class="px-4 py-2">${id}</td><td class="px-4 py-2">${o.name || 'Cliente'}</td><td class="px-4 py-2">${serv}</td><td class="px-4 py-2">${dateStr}</td><td class="px-4 py-2">${formatCurrency(colShare)}</td><td class="px-4 py-2">${starsStr}</td><td class="px-4 py-2">${btn}</td></tr>`;
  });
  if (monthEl) monthEl.textContent = formatCurrency(monthSum);
  if (totalEl) totalEl.textContent = formatCurrency(totalSum);
  rendPageState.data = rows.reverse();
  rendPageState.totalPages = Math.max(1, Math.ceil(rendPageState.data.length / rendPageState.pageSize));
  rendPageState.currentPage = Math.min(rendPageState.currentPage, rendPageState.totalPages);
  renderUnifiedTablePage();
  renderUnifiedPagination();
  body.querySelectorAll('button[data-comment]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById('customerCommentModal');
      const bodyEl = document.getElementById('customerCommentBody');
      if (bodyEl) bodyEl.textContent = btn.getAttribute('data-comment') || '';
      if (modal) modal.classList.remove('hidden');
    });
  });
  const closeBtn = document.getElementById('closeCustomerComment');
  if (closeBtn) closeBtn.onclick = () => {
    const modal = document.getElementById('customerCommentModal');
    if (modal) modal.classList.add('hidden');
  };
}

function renderUnifiedTablePage() {
  const body = document.getElementById('unifiedTable');
  if (!body) return;
  const start = (rendPageState.currentPage - 1) * rendPageState.pageSize;
  const end = start + rendPageState.pageSize;
  const slice = rendPageState.data.slice(start, end);
  body.innerHTML = slice.join('') || '<tr><td class="px-4 py-3 text-gray-500" colspan="7">Sin datos disponibles.</td></tr>';
  if (window.lucide) lucide.createIcons();
  const showingEl = document.getElementById('rendShowingRange');
  const totalEl = document.getElementById('rendTotalCount');
  if (showingEl) showingEl.textContent = `${Math.min(start+1, Math.max(0, rendPageState.data.length))}–${Math.min(end, rendPageState.data.length)}`;
  if (totalEl) totalEl.textContent = String(rendPageState.data.length);
}

function renderUnifiedPagination() {
  const pagesEl = document.getElementById('rendPages');
  const prev = document.getElementById('rendPrev');
  const next = document.getElementById('rendNext');
  const first = document.getElementById('rendFirst');
  const last = document.getElementById('rendLast');
  if (!pagesEl || !prev || !next || !first || !last) return;
  const total = rendPageState.totalPages;
  const current = rendPageState.currentPage;
  prev.disabled = current <= 1;
  first.disabled = current <= 1;
  next.disabled = current >= total;
  last.disabled = current >= total;
  const windowSize = 5;
  let start = Math.max(1, current - Math.floor(windowSize/2));
  let end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  pagesEl.innerHTML = '';
  for (let p = start; p <= end; p++) {
    const btn = document.createElement('button');
    btn.textContent = String(p);
    btn.className = `px-3 py-2 rounded text-sm ${p===current? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`;
    btn.addEventListener('click', () => { rendPageState.currentPage = p; renderUnifiedTablePage(); renderUnifiedPagination(); });
    pagesEl.appendChild(btn);
  }
  prev.onclick = () => { if (rendPageState.currentPage>1) { rendPageState.currentPage--; renderUnifiedTablePage(); renderUnifiedPagination(); } };
  next.onclick = () => { if (rendPageState.currentPage<total) { rendPageState.currentPage++; renderUnifiedTablePage(); renderUnifiedPagination(); } };
  first.onclick = () => { rendPageState.currentPage = 1; renderUnifiedTablePage(); renderUnifiedPagination(); };
  last.onclick = () => { rendPageState.currentPage = total; renderUnifiedTablePage(); renderUnifiedPagination(); };
}

function setupAutoRefresh(collabId) {
  try {
    setInterval(() => loadMetrics(collabId), 30000);
  } catch (_) {}
}

function groupByMonth(orders) {
  const map = {};
  for (const o of (orders || [])) {
    const d = o.assigned_at || o.date || null;
    const dt = d ? new Date(d) : null;
    const key = dt ? `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}` : 'N/A';
    if (!map[key]) map[key] = { assigned: 0, completed: 0 };
    const st = String(o.status || '').toLowerCase();
    if (st === 'completada') map[key].completed += 1; else map[key].assigned += 1;
  }
  return map;
}

function completionTimeSeries(completed) {
  const series = [];
  for (const o of (completed || [])) {
    const start = o.accepted_at ? Date.parse(o.accepted_at) : null;
    const end = o.completed_at ? Date.parse(o.completed_at) : null;
    if (start && end && end > start) {
      const hours = Math.round((end - start) / 1000 / 60 / 60);
      const label = o.short_id ? String(o.short_id) : (o.id ? `#${o.id}` : 'Orden');
      series.push({ label, hours });
    }
  }
  return series.slice(-20);
}
