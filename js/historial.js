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
        const fechaCompletado = order.completed_at ? new Date(order.completed_at).toLocaleDateString('es-ES', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'No disponible';
        
        // Determinar clase de fila según el estado
        const rowClass = order.status === 'Cancelado' ? 'hover:bg-red-50 bg-red-50/30' : 'hover:bg-green-50';

        return `
          <tr class="${rowClass}">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${order.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${order.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${order.service?.name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${fechaCompletado}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${completadoPorNombre}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${order.status === 'Cancelado' ? 'text-red-600' : 'text-green-700'}">
              ${order.monto_cobrado ? `$${order.monto_cobrado.toLocaleString('es-DO')}` : 'N/A'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              ${(order.evidence_photos && order.evidence_photos.length > 0) ?
                `<button onclick="showEvidence(${order.id})" class="text-blue-600 hover:underline flex items-center gap-1">
                  <i data-lucide="image" class="w-4 h-4"></i> Ver (${order.evidence_photos.length})
                </button>` :
                '<span class="text-gray-400">No hay</span>'}
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
    try {
      console.log('[Historial] Iniciando carga de solicitudes finalizadas y canceladas...');
      
      // Primera consulta: Obtener órdenes con status = 'Completado'
      const { data: completedData, error: completedError } = await supabaseConfig.client
        .from('orders')
        .select(`
          *,
          service:services(name),
          profiles:completed_by(full_name)
        `)
        .eq('status', 'Completado')
        .order('completed_at', { ascending: false });
      
      if (completedError) {
        throw completedError;
      }
      
      console.log(`[Historial] Encontradas ${completedData?.length || 0} órdenes completadas`);
      
      // Segunda consulta: Obtener órdenes con status = 'Cancelado'
      const { data: canceledData, error: canceledError } = await supabaseConfig.client
        .from('orders')
        .select(`
          *,
          service:services(name),
          profiles:completed_by(full_name)
        `)
        .eq('status', 'Cancelado')
        .order('completed_at', { ascending: false });
      
      if (canceledError) {
        throw canceledError;
      }
      
      console.log(`[Historial] Encontradas ${canceledData?.length || 0} órdenes canceladas`);
      
      // Combinar resultados
      allHistoryOrders = [...(completedData || []), ...(canceledData || [])];
      
      // Ordenar por fecha de completado (más reciente primero)
      allHistoryOrders.sort((a, b) => {
        const dateA = a.completed_at ? new Date(a.completed_at) : new Date(0);
        const dateB = b.completed_at ? new Date(b.completed_at) : new Date(0);
        return dateB - dateA;
      });
      
      console.log(`[Historial] Total de órdenes cargadas: ${allHistoryOrders.length}`);
      
      // Verificar si hay órdenes con estado completado pero sin fecha de completado
      const ordersWithoutCompletedAt = allHistoryOrders.filter(
        order => order.status === 'Completado' && !order.completed_at
      );
      
      if (ordersWithoutCompletedAt.length > 0) {
        console.warn(`[Historial] Hay ${ordersWithoutCompletedAt.length} órdenes con estado Completado pero sin fecha de completado`);
      }
      
      filterAndRender();
    } catch (error) {
      console.error('[Historial] Error al cargar el historial:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-10 text-red-500">
            Error al cargar el historial. Inténtalo de nuevo más tarde.
          </td>
        </tr>
      `;
    }
  };

  // --- EVENT LISTENERS ---
  searchInput.addEventListener('input', filterAndRender);
  dateFilter.addEventListener('change', filterAndRender);
  clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = '';
    dateFilter.value = '';
    filterAndRender();
  });

  // Configurar suscripción en tiempo real para órdenes completadas
  const setupRealtimeSubscription = () => {
    const channel = supabaseConfig.client.channel('historial-updates');
    
    channel
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'orders',
          filter: 'status=in.(Completado,Cancelado)'
        }, 
        (payload) => {
          console.log('[Historial] Cambio en tiempo real detectado:', payload);
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            // Si es una nueva orden completada o una actualización a completado
            const existingIndex = allHistoryOrders.findIndex(o => o.id === payload.new.id);
            
            if (existingIndex === -1) {
              // Es una nueva orden completada, añadirla al principio
              console.log('[Historial] Nueva orden completada/cancelada detectada:', payload.new.id);
              // Cargar la orden completa con sus relaciones
              loadOrderDetails(payload.new.id);
            } else {
              // Actualizar la orden existente
              allHistoryOrders[existingIndex] = { 
                ...allHistoryOrders[existingIndex], 
                ...payload.new 
              };
              filterAndRender();
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('[Historial] Estado de suscripción en tiempo real:', status);
      });
  };

  // Función para cargar los detalles completos de una orden
  const loadOrderDetails = async (orderId) => {
    const { data, error } = await supabaseConfig.client
      .from('orders')
      .select(`
        *,
        service:services(name),
        profiles:completed_by(full_name)
      `)
      .eq('id', orderId)
      .single();

    if (error) {
      console.error(`Error al cargar detalles de la orden #${orderId}:`, error);
      return;
    }

    if (data) {
      // Añadir al principio del array para que aparezca primero
      allHistoryOrders.unshift(data);
      filterAndRender();
    }
  };

  // Carga inicial
  await loadHistory();
  
  // Configurar suscripción en tiempo real
  setupRealtimeSubscription();
});
