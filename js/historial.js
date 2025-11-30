// js/historial.js

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar elementos del DOM
  const tableBody = document.getElementById('historyTableBody');
  const showingCountEl = document.getElementById('showingCount');
  const totalCountEl = document.getElementById('totalCount');

  let allHistoryOrders = [];
  let filteredOrders = [];

  // --- MODAL DE EVIDENCIA ---
  const evidenceModal = document.getElementById('evidenceModal');
  const closeEvidenceModalBtn = document.getElementById('closeEvidenceModal');
  const evidenceGallery = document.getElementById('evidenceGallery');

  // --- MODAL DE PDF ---
  const pdfModal = document.getElementById('pdfModal');
  const closePdfModalBtn = document.getElementById('closePdfModal');
  const pdfOrderInfo = document.getElementById('pdfOrderInfo');
  const downloadPdfBtn = document.getElementById('downloadPdfBtn');

  // Función para mostrar el modal de PDF
  window.showPDFModal = (orderId) => {
    const order = filteredOrders.find(o => o.id === orderId);
    if (!order) {
      alert('Orden no encontrada');
      return;
    }

    // Mostrar información de la orden en el modal
    const completadoPorNombre = order.profiles?.full_name || order.completed_by_name || 'No disponible';
    const fechaCompletado = order.completed_at ? new Date(order.completed_at).toLocaleDateString('es-ES') : 'No disponible';
    
    // Actualizar el contenido del modal
    document.getElementById('selectedOrderDetails').innerHTML = `
      <div class="space-y-2">
        <p><strong>Orden #:</strong> ${order.id}</p>
        <p><strong>Cliente:</strong> ${order.name || 'N/A'}</p>
        <p><strong>Servicio:</strong> ${order.service?.name || order.service_name || 'N/A'}</p>
        <p><strong>Estado:</strong> ${order.status}</p>
        <p><strong>Completado por:</strong> ${completadoPorNombre}</p>
        <p><strong>Fecha:</strong> ${fechaCompletado}</p>
        <p><strong>Monto:</strong> ${order.monto_cobrado ? `$${order.monto_cobrado}` : 'N/A'}</p>
      </div>
    `;

    // Configurar el botón de descarga
    downloadPdfBtn.onclick = () => {
      generatePDF(order);
      closePdfModal();
    };

    // Configurar botón de cancelar
    document.getElementById('cancelPdfBtn').onclick = closePdfModal;

    // Mostrar el modal
    pdfModal.classList.remove('hidden');
    pdfModal.classList.add('flex');
    
    // Actualizar iconos de Lucide
    if (window.lucide) lucide.createIcons();
  };

  // Función para cerrar el modal de PDF
  const closePdfModal = () => {
    pdfModal.classList.add('hidden');
    pdfModal.classList.remove('flex');
  };

  closePdfModalBtn.addEventListener('click', closePdfModal);
  pdfModal.addEventListener('click', (e) => {
    if (e.target === pdfModal) {
      closePdfModal();
    }
  });

  // Función para abrir el modal de evidencia
  window.showEvidence = (orderId) => {
    const order = filteredOrders.find(o => o.id === orderId);
    if (!order || !order.evidence_photos || order.evidence_photos.length === 0) {
      alert('Esta solicitud no tiene fotos de evidencia.');
      return;
    }

    evidenceGallery.innerHTML = order.evidence_photos.map(item => {
      const url = typeof item === 'string' ? item : (item && item.url ? item.url : '');
      if (!url) return '';
      return `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="block group">
          <img src="${url}" alt="Evidencia" class="w-full h-48 object-cover rounded-lg shadow-md group-hover:opacity-80 transition-opacity">
        </a>
      `;
    }).join('');

    evidenceModal.classList.remove('hidden');
    evidenceModal.classList.add('flex');
    if (window.lucide) lucide.createIcons();
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


  // --- FUNCIONES PARA GENERAR PDF ---
  
  // Función para formatear fecha
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Función para generar y descargar PDF
  const generatePDF = async (order) => {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      const brandDark = { r: 30, g: 64, b: 90 };
      const brandTurq = { r: 30, g: 138, b: 149 };

      const toDataURL = async (url) => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (_) { return null; }
      };

      const drawHeader = async () => {
        doc.setFillColor(brandDark.r, brandDark.g, brandDark.b);
        doc.rect(0, 0, pageWidth, 28, 'F');
        doc.setFillColor(brandTurq.r, brandTurq.g, brandTurq.b);
        doc.rect(pageWidth - 60, 0, 60, 28, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Logística López Ortiz', margin, 18);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text('RNC: 133139413', margin, 25);
        const logo = await toDataURL('img/1vertical.png');
        if (logo) {
          try { doc.addImage(logo, 'PNG', pageWidth - 22, 6, 14, 14); } catch (_) {}
        }
        doc.setTextColor(0, 0, 0);
        y = 40;
      };

      const ensureSpace = async (needed = 12) => {
        if (y + needed > pageHeight - margin) {
          doc.addPage();
          await drawHeader();
        }
      };

      const textBlock = async (text, opts = {}) => {
        const { x = margin, width = contentWidth, lineHeight = 6, style = 'normal', size = 11 } = opts;
        const lines = doc.splitTextToSize(String(text || ''), width);
        const h = Math.max(lineHeight, lines.length * lineHeight);
        await ensureSpace(h + 2);
        doc.setFont(undefined, style);
        doc.setFontSize(size);
        doc.text(lines, x, y);
        y += h;
      };

      const labelValue = async (label, value, labelW = 38) => {
        const leftX = margin;
        const rightX = margin + labelW;
        const maxW = contentWidth - labelW;
        const vLines = doc.splitTextToSize(String(value || 'N/A'), maxW);
        const h = Math.max(8, vLines.length * 6);
        await ensureSpace(h + 2);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.text(String(label || ''), leftX, y);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(11);
        doc.text(vLines, rightX, y);
        y += h;
      };

      await drawHeader();

      doc.setFontSize(15);
      doc.setFont(undefined, 'bold');
      await textBlock('Reporte de Orden de Servicio', { x: pageWidth / 2, width: contentWidth, lineHeight: 6, style: 'bold', size: 15 });
      const titleYAdj = y;
      y = titleYAdj;
      doc.text(`Número de Orden: #${order.id}`, pageWidth / 2, y, { align: 'center' });
      y += 10;

      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      await textBlock('Datos del Cliente', { size: 13, style: 'bold' });
      doc.setFont(undefined, 'normal');
      await labelValue('Nombre:', order.name || 'N/A');
      await labelValue('Teléfono:', order.phone || 'N/A');
      await labelValue('Email:', order.email || 'N/A');
      await labelValue('Empresa:', order.empresa || 'N/A');
      await labelValue('RNC:', order.rnc || 'N/A');

      y += 6;
      doc.setFont(undefined, 'bold');
      await textBlock('Resumen del Servicio', { size: 13, style: 'bold' });
      doc.setFont(undefined, 'normal');
      await labelValue('Servicio:', order.service?.name || order.service_name || 'N/A');
      await labelValue('Vehículo:', order.vehicle?.name || order.vehicle_name || 'N/A');
      await labelValue('Fecha solicitud:', formatDate(order.created_at));
      await labelValue('Fecha servicio:', `${order.date || 'N/A'} ${order.time || ''}`);
      await labelValue('Estado:', order.status || 'N/A');
      await labelValue('Monto cobrado:', order.monto_cobrado ? `$${Number(order.monto_cobrado).toLocaleString('es-DO')}` : 'Por confirmar');

      if (order.pickup || order.delivery) {
        y += 6;
        doc.setFont(undefined, 'bold');
        await textBlock('Ruta', { size: 13, style: 'bold' });
        doc.setFont(undefined, 'normal');
        if (order.pickup) await labelValue('Recogida:', order.pickup);
        if (order.delivery) await labelValue('Entrega:', order.delivery);
      }

      if (order.service_questions && Object.keys(order.service_questions).length > 0) {
        y += 6;
        doc.setFont(undefined, 'bold');
        await textBlock('Detalles adicionales', { size: 13, style: 'bold' });
        doc.setFont(undefined, 'normal');
        try {
          const qs = typeof order.service_questions === 'string' ? JSON.parse(order.service_questions) : order.service_questions;
          for (const [k, v] of Object.entries(qs)) {
            await labelValue(`${k}:`, String(v || ''));
          }
        } catch (_) {}
      }

      if (order.evidence_photos && order.evidence_photos.length > 0) {
        y += 6;
        doc.setFont(undefined, 'bold');
        await textBlock(`Evidencia fotográfica: ${order.evidence_photos.length} foto(s) adjunta(s)`, { size: 12, style: 'bold' });
        doc.setFont(undefined, 'italic');
        await textBlock('(Las fotos están disponibles en el sistema)', { size: 9, style: 'italic' });
      }

      doc.addPage();
      await drawHeader();
      doc.setFont(undefined, 'bold');
      await textBlock('Información de finalización', { size: 14, style: 'bold' });
      doc.setFont(undefined, 'normal');
      const collaboratorName = order.profiles?.full_name || order.completed_by_name || 'No asignado';
      const completedDate = formatDate(order.completed_at);
      await labelValue('ID de Orden:', String(order.id));
      await labelValue('Completado por:', collaboratorName);
      await labelValue('Fecha de finalización:', completedDate);
      await labelValue('Método de pago:', order.metodo_pago || 'No especificado');
      await labelValue('Monto final:', order.monto_cobrado ? `$${Number(order.monto_cobrado).toLocaleString('es-DO')}` : 'No cobrado');

      if (order.assigned_at || order.accepted_at) {
        y += 6;
        doc.setFont(undefined, 'bold');
        await textBlock('Historial de asignaciones', { size: 13, style: 'bold' });
        doc.setFont(undefined, 'normal');
        if (order.assigned_at) await labelValue('Asignado el:', formatDate(order.assigned_at));
        if (order.accepted_at) await labelValue('Aceptado el:', formatDate(order.accepted_at));
      }

      const footer = () => {
        const footerY = pageHeight - 16;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, margin, footerY);
        doc.text('Sistema de Gestión - Logística López Ortiz', pageWidth - margin, footerY, { align: 'right' });
      };
      footer();

      const fileName = `orden_${order.id}_${order.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'cliente'}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    } catch (error) {
      alert('Error al generar el PDF. Intente nuevamente.');
    }
  };

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
        // ✅ CORRECCIÓN: Acceder al nombre del colaborador a través del objeto anidado 'profiles'.
        const completadoPorNombre = order.profiles?.full_name || order.completed_by_name || 'No disponible';
        const fechaCompletado = order.completed_at ? new Date(order.completed_at).toLocaleDateString('es-ES', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'No disponible';
        
        // Determinar clase de fila según el estado
        const rowClass = order.status === 'Cancelada' ? 'hover:bg-red-50 bg-red-50/30' : 'hover:bg-green-50';

        return `
          <tr class="${rowClass} cursor-pointer hover:shadow-md transition-all duration-200" 
              ondblclick="showPDFModal(${order.id})" 
              title="Doble clic para descargar PDF">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${order.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">${order.name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${order.service?.name || order.service_name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${fechaCompletado}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${completadoPorNombre}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${order.status === 'Cancelada' ? 'text-red-600' : 'text-green-700'}">
              ${order.monto_cobrado ? `$${typeof order.monto_cobrado === 'string' ? parseFloat(order.monto_cobrado).toLocaleString('es-DO') : order.monto_cobrado.toLocaleString('es-DO')}` : 'N/A'}
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
    // Los filtros fueron eliminados de la UI. Ahora simplemente renderiza todo el historial.
    filteredOrders = allHistoryOrders;
    renderTable();
  };

  // Carga inicial de datos
  const loadHistory = async () => {
    try {
      console.log('[Historial] Iniciando carga de solicitudes...');
      const client = supabaseConfig.client || supabaseConfig.getPublicClient();
      const publicClient = supabaseConfig.getPublicClient();

      // Obtener órdenes Completadas y Canceladas, con columnas necesarias
      const { data: orders, error: ordersError } = await client
        .from('orders')
        .select('id, name, phone, email, empresa, rnc, service_id, vehicle_id, status, created_at, date, time, pickup, delivery, completed_at, completed_by, assigned_at, accepted_at, metodo_pago, monto_cobrado, evidence_photos, service_questions')
        .or('status.eq.Completada,status.eq.Cancelada')
        .order('completed_at', { ascending: false });

      if (ordersError) {
        console.error('[Historial] Error al cargar órdenes:', ordersError);
        throw new Error(`Error al obtener órdenes: ${ordersError.message}`);
      }
       if (!orders || orders.length === 0) {
        console.log('[Historial] No se encontraron órdenes en el historial.');
        allHistoryOrders = [];
        filterAndRender();
        return;
      }

      console.log(`[Historial] Órdenes cargadas: ${orders.length}`);

      // Paso 2: Recolectar IDs de colaboradores y servicios
      const collaboratorIds = [...new Set(orders.map(o => o.completed_by).filter(id => id))];
      const serviceIds = [...new Set(orders.map(o => o.service_id).filter(id => id))];
      const vehicleIds = [...new Set(orders.map(o => o.vehicle_id).filter(id => id))];

      // Paso 3: Obtener datos de colaboradores y servicios en paralelo
      let collaborators = [];
      let services = [];

      if (collaboratorIds.length > 0) {
        const { data: collabData, error: collabError } = await publicClient
          .from('profiles')
          .select('id, full_name')
          .in('id', collaboratorIds);
        if (collabError) console.warn('[Historial] Error al cargar colaboradores:', collabError);
        else collaborators = collabData;
      }

      if (serviceIds.length > 0) {
        const { data: serviceData, error: serviceError } = await client
          .from('services')
          .select('id, name')
          .in('id', serviceIds);
        if (serviceError) console.warn('[Historial] Error al cargar servicios:', serviceError);
        else services = serviceData;
      }
      let vehicles = [];
      if (vehicleIds.length > 0) {
        const { data: vehicleData, error: vehicleError } = await client
          .from('vehicles')
          .select('id, name')
          .in('id', vehicleIds);
        if (vehicleError) console.warn('[Historial] Error al cargar vehículos:', vehicleError);
        else vehicles = vehicleData;
      }

      // Mapear para búsqueda rápida
      const collaboratorsMap = new Map(collaborators.map(c => [c.id, c.full_name]));
      const servicesMap = new Map(services.map(s => [s.id, s.name]));
      const vehiclesMap = new Map(vehicles.map(v => [v.id, v.name]));

      // Paso 4: Combinar los datos
      allHistoryOrders = orders.map(order => {
        return {
          ...order,
          // Asignar nombre de colaborador
          profiles: {
            full_name: collaboratorsMap.get(order.completed_by) || null
          },
          // Asignar nombre de servicio
          service: {
            name: servicesMap.get(order.service_id) || null
          },
          vehicle: {
            name: vehiclesMap.get(order.vehicle_id) || null
          }
        };
      });

      console.log(`[Historial] Datos combinados. Total: ${allHistoryOrders.length}`);
      filterAndRender();

    } catch (error) {
      console.error('[Historial] Error crítico al cargar el historial:', error);
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-10 text-red-600">
              <b>Error al cargar el historial:</b> ${error.message || 'Error desconocido'}.
              <br>Por favor, revise la consola para más detalles y contacte a soporte si el problema persiste.
            </td>
          </tr>
        `;
      }
    }
  };

  // Configurar suscripción en tiempo real para órdenes completadas
  const setupRealtimeSubscription = () => {
    const channel = supabaseConfig.client.channel('historial-updates');
    
    channel
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'orders',
          filter: 'status=in.(Completada,Cancelada)'
        }, 
        (payload) => {
          console.log('[Historial] Cambio en tiempo real detectado:', payload);
          
          // Solo procesar si el cambio es en estados completados o cancelados
          if (payload.new && ['Completada', 'Cancelada'].includes(payload.new.status)) {
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
        }
      )
      .subscribe((status) => {
        console.log('[Historial] Estado de suscripción en tiempo real:', status);
      });
  };

  // Función para cargar los detalles completos de una orden
  const loadOrderDetails = async (orderId) => {
    try {
      // Intentar primero con cliente público
      const publicClient = supabaseConfig.getPublicClient();
      let { data, error } = await publicClient
        .from('orders')
        .select(`
          *,
          service:services(name),
          profiles:completed_by(full_name)
        `)
        .eq('id', orderId)
        .single();

      // Si falla, intentar con cliente autenticado
      if (error && (error.status === 401 || error.code === 'PGRST303')) {
        const authResult = await supabaseConfig.client
          .from('orders')
          .select(`
            *,
            service:services(name),
            profiles:completed_by(full_name)
          `)
          .eq('id', orderId)
          .single();
        
        data = authResult.data;
        error = authResult.error;
      }

      if (error) {
        console.error(`Error al cargar detalles de la orden #${orderId}:`, error);
        return;
      }

      if (data) {
        // Añadir al principio del array para que aparezca primero
        allHistoryOrders.unshift(data);
        filterAndRender();
      }
    } catch (error) {
      console.error(`Error al cargar detalles de la orden #${orderId}:`, error);
    }
  };

  // Carga inicial
  await loadHistory();
  
  // Configurar suscripción en tiempo real
  setupRealtimeSubscription();
});
