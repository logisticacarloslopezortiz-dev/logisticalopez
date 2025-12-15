document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('ordersGrid');
  const overlay = document.getElementById('loadingOverlay');
  const showingEl = document.getElementById('collabShowing');
  const totalEl = document.getElementById('collabTotal');
  const modal = document.getElementById('orderModal');
  const closeModalBtn = document.getElementById('closeOrderModal');
  const modalOrderId = document.getElementById('modalOrderId');
  const modalService = document.getElementById('modalService');
  const modalStatus = document.getElementById('modalStatus');
  const modalClient = document.getElementById('modalClient');
  const modalVehicle = document.getElementById('modalVehicle');
  const modalPickup = document.getElementById('modalPickup');
  const modalDelivery = document.getElementById('modalDelivery');
  const markCompletedBtn = document.getElementById('markCompletedBtn');
  const markCancelledBtn = document.getElementById('markCancelledBtn');

  let orders = [];
  let currentOrder = null;
  let __iconsTimer = null;
  let __authSub = null;

  async function ensureAuthOrRedirect() {
    try {
      if (!window.supabaseConfig || !supabaseConfig.client) {
        window.location.href = 'login-colaborador.html';
        return false;
      }
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      if (!session) {
        window.location.href = 'login-colaborador.html';
        return false;
      }
      return true;
    } catch (_) {
      window.location.href = 'login-colaborador.html';
      return false;
    }
  }

  function openModal(order) {
    currentOrder = order;
    modalOrderId.textContent = `#${order.short_id || order.id}`;
    modalService.textContent = order?.service?.name || '';
    modalStatus.textContent = String(order.status || '').trim();
    modalClient.textContent = `${order.name || ''} • ${order.phone || ''}`;
    modalVehicle.textContent = order?.vehicle?.name || '';
    modalPickup.textContent = order.pickup || '';
    modalDelivery.textContent = order.delivery || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeModal() {
    currentOrder = null;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async function fetchOrdersForCollaborator() {
    try { await supabaseConfig.ensureFreshSession?.(); } catch (_) {}
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    try {
      const ok = await ensureAuthOrRedirect();
      if (!ok) return;
      const { data: { session } } = await supabaseConfig.client.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) {
        window.location.href = 'login-colaborador.html';
        return;
      }
      let list = [];
      try {
        list = await supabaseConfig.getOrdersForCollaborator(uid);
      } catch (_) {
        const { data } = await supabaseConfig.client
          .from('orders')
          .select('id,short_id,name,phone,status,pickup,delivery,service:services(name),vehicle:vehicles(name)')
          .eq('assigned_to', uid);
        list = data || [];
      }
      orders = Array.isArray(list) ? list : [];
      renderOrders();
    } catch (e) {
      notifications?.error?.('No se pudieron cargar las solicitudes.');
    } finally {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex');
    }
  }

  function renderOrders() {
    const total = orders.length;
    if (totalEl) totalEl.textContent = String(total);
    if (showingEl) showingEl.textContent = String(total);
    if (!grid) return;
    if (orders.length === 0) {
      grid.innerHTML = '<div class="col-span-full bg-white rounded-xl border p-6 text-center text-gray-600">No hay solicitudes asignadas por ahora.</div>';
      try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          if (__iconsTimer) clearTimeout(__iconsTimer);
          __iconsTimer = setTimeout(() => window.lucide.createIcons(), 100);
        }
      } catch (_) {}
      return;
    }
    grid.innerHTML = orders.map(o => {
      const id = o.short_id || o.id;
      const service = o?.service?.name || '';
      const status = String(o.status || '').trim();
      const s = status.toLowerCase();
      const badge = s === 'pendiente'
        ? 'bg-yellow-100 text-yellow-700'
        : s === 'aceptada'
          ? 'bg-blue-100 text-blue-700'
          : s === 'en curso'
            ? 'bg-indigo-100 text-indigo-700'
            : s === 'cancelada'
              ? 'bg-red-100 text-red-700'
              : 'bg-green-100 text-green-700';
      return `
        <div class="group bg-white rounded-2xl shadow hover:shadow-lg border border-gray-200 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white font-bold">#${id}</span>
            <span class="px-2 py-1 rounded ${badge} text-xs">${status}</span>
          </div>
          <div class="p-4 space-y-2">
            <p class="text-sm font-semibold text-gray-900">${service}</p>
            <p class="text-xs text-gray-600">${o.pickup || ''}</p>
            <p class="text-xs text-gray-600">${o.delivery || ''}</p>
          </div>
          <div class="px-4 py-3 border-t flex items-center justify-end gap-2">
            <button class="btn-open px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm" data-id="${o.id}">Detalles</button>
            <button class="btn-complete px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm" data-id="${o.id}">Completar</button>
          </div>
        </div>
      `;
    }).join('');
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        if (__iconsTimer) clearTimeout(__iconsTimer);
        __iconsTimer = setTimeout(() => window.lucide.createIcons(), 100);
      }
    } catch (_) {}
    grid.querySelectorAll('.btn-open').forEach(b => {
      b.addEventListener('click', () => {
        const id = Number(b.getAttribute('data-id'));
        const o = orders.find(x => Number(x.id) === id);
        if (o) openModal(o);
      });
    });
    grid.querySelectorAll('.btn-complete').forEach(b => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-id'));
        const o = orders.find(x => Number(x.id) === id);
        if (!o) return;
        try {
          const q = supabaseConfig.client.from('orders').update({ status: 'Completada', completed_at: new Date().toISOString(), completed_by: (await supabaseConfig.client.auth.getUser()).data?.user?.id || null }).eq('id', o.id).select('id').maybeSingle();
          await q;
          notifications?.success?.('Solicitud completada.');
          await fetchOrdersForCollaborator();
        } catch (_) {
          notifications?.error?.('No se pudo completar la solicitud.');
        }
      });
    });
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (markCompletedBtn) markCompletedBtn.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      const q = supabaseConfig.client.from('orders').update({ status: 'Completada', completed_at: new Date().toISOString(), completed_by: (await supabaseConfig.client.auth.getUser()).data?.user?.id || null }).eq('id', currentOrder.id).select('id').maybeSingle();
      await q;
      notifications?.success?.('Solicitud completada.');
      closeModal();
      await fetchOrdersForCollaborator();
    } catch (_) {
      notifications?.error?.('No se pudo completar la solicitud.');
    }
  });
  if (markCancelledBtn) markCancelledBtn.addEventListener('click', async () => {
    if (!currentOrder) return;
    try {
      const q = supabaseConfig.client.from('orders').update({ status: 'Cancelada' }).eq('id', currentOrder.id).select('id').maybeSingle();
      await q;
      notifications?.success?.('Solicitud cancelada.');
      closeModal();
      await fetchOrdersForCollaborator();
    } catch (_) {
      notifications?.error?.('No se pudo cancelar la solicitud.');
    }
  });

  const init = async () => {
    const ok = await ensureAuthOrRedirect();
    if (!ok) return;
    try {
      __authSub = supabaseConfig.client.auth.onAuthStateChange(async (event) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          await fetchOrdersForCollaborator();
        }
        if (event === 'SIGNED_OUT') {
          orders = [];
          if (grid) grid.innerHTML = '';
          window.location.href = 'login-colaborador.html';
        }
      });
    } catch (_) {}
    await fetchOrdersForCollaborator();
  };
  document.addEventListener('session-ready', init, { once: true });
  init();
});
