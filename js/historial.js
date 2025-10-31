// js/historial.js

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar elementos del DOM
  const tableBody = document.getElementById('historyTableBody');
  const searchInput = document.getElementById('searchInput');
  const dateFilter = document.getElementById('dateFilter');
  const clearFiltersBtn = document.getElementById('clearFilters');
  const showingCountEl = document.getElementById('showingCount');
  const totalCountEl = document.getElementById('totalCount');

  let allHistoryOrders = [];
  let filteredOrders = [];

  // --- MODAL DE EVIDENCIA ---
  const evidenceModal = document.getElementById('evidenceModal');
  const closeEvidenceModalBtn = document.getElementById('closeEvidenceModal');
  const evidenceGallery = document.getElementById('evidenceGallery');

  // Función para abrir el modal de evidencia
  window.showEvidence = (orderId) => {
    const order = filteredOrders.find(o => o.id === orderId);
    if (!order || !order.evidence_photos || order.evidence_photos.length === 0) {
      alert('Esta solicitud no tiene fotos de evidencia.');
      return;
    }

    evidenceGallery.innerHTML = order.evidence_photos.map(photoUrl => `
      <a href="${photoUrl}" target="_blank" class="block group">
        <img src="${photoUrl}" alt="Evidencia" class="w-full h-48 object-cover rounded-lg shadow-md group-hover:opacity-80 transition-opacity">
      </a>
    `).join('');

    evidenceModal.classList.remove('hidden');
    evidenceModal.classList.add('flex');
  };

  // Función para cerrar el modal
  const closeEvidenceModal = () => {
    evidenceModal.classList.add('hidden');
    evidenceModal.classList.remove('flex');
  };

  closeEvidenceModalBtn.addEventListener('click', closeEvidenceModal);
  // Cerrar al hacer clic fuera
  evidenceModal.addEventListener('click', (e) => {
    if (e.target === evidenceModal) {
      closeEvidenceModal();
    }
  });


  // --- CARGA Y RENDERIZADO DE DATOS ---

  // Función para renderizar las filas de la tabla
  const renderTable = () => {
    if (!tableBody) return;

    if (filteredOrders.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-10 text-gray-500">
            No se encontraron solicitudes que coincidan con los filtros.
          </td>
        </tr>
      `;
    } else {
      tableBody.innerHTML = filteredOrders.map(order => {
        const completadoPorNombre = order.profiles ? order.profiles.full_name : 'No disponible';

        return `
          <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${order.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${order.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${order.service?.name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${new Date(order.completed_at).toLocaleDateString()}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${completadoPorNombre}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-700">${order.monto_cobrado ? `$${order.monto_cobrado.toLocaleString('es-DO')}` : 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              ${(order.evidence_photos && order.evidence_photos.length > 0) ?
                `<button onclick="showEvidence(${order.id})" class="text-blue-600 hover:underline">Ver (${order.evidence_photos.length})</button>` :
                'No hay'}
            </td>
          </tr>
        `;
      }).join('');
    }

    // Actualizar contadores
    showingCountEl.textContent = filteredOrders.length;
    totalCountEl.textContent = allHistoryOrders.length;
    if (window.lucide) lucide.createIcons();
  };

  // Función de filtrado
  const filterAndRender = () => {
    const searchTerm = searchInput.value.toLowerCase();
    const dateValue = dateFilter.value;

    filteredOrders = allHistoryOrders.filter(order => {
      const matchesSearch = !searchTerm ||
        String(order.id).includes(searchTerm) ||
        order.name.toLowerCase().includes(searchTerm) ||
        (order.service?.name || '').toLowerCase().includes(searchTerm);

      const matchesDate = !dateValue || order.completed_at.startsWith(dateValue);

      return matchesSearch && matchesDate;
    });

    renderTable();
  };

  // Carga inicial de datos
  const loadHistory = async () => {
    const { data, error } = await supabaseConfig.client
      .from('orders')
      .select(`
        *,
        service:services(name),
        profiles:completed_by(full_name)
      `)
      .in('status', ['Completado', 'Cancelado'])
      .order('completed_at', { ascending: false });

    if (error) {
      console.error('Error al cargar el historial:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-10 text-red-500">
            Error al cargar el historial. Inténtalo de nuevo más tarde.
          </td>
        </tr>
      `;
      return;
    }

    allHistoryOrders = data;
    filterAndRender();
  };

  // --- EVENT LISTENERS ---
  searchInput.addEventListener('input', filterAndRender);
  dateFilter.addEventListener('change', filterAndRender);
  clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = '';
    dateFilter.value = '';
    filterAndRender();
  });

  // Carga inicial
  await loadHistory();
});
