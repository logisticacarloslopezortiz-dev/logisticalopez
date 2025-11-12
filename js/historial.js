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
      
      // Configuración del documento
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let yPosition = 20;
      
      // === PRIMERA PÁGINA: INFORMACIÓN DE LA EMPRESA Y RESUMEN DEL SERVICIO ===
      
      // Información de la empresa - Encabezado
      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.text('LOGISTICA LOPEZ ORTIZ', pageWidth / 2, yPosition, { align: 'center' });
      
      yPosition += 8;
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text('RNC: 133139413', pageWidth / 2, yPosition, { align: 'center' });
      
      yPosition += 6;
      doc.text('San Cristóbal, Plaza Vionicio, Calle Sánchez, Esquina Padre Ayala', pageWidth / 2, yPosition, { align: 'center' });
      
      yPosition += 6;
      doc.text('Tel: 829-729-3822 | Email: transporteylogisticalopezortiz@gmail.com', pageWidth / 2, yPosition, { align: 'center' });
      
      // Línea separadora
      yPosition += 10;
      doc.setDrawColor(0, 0, 0);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      
      // Título del reporte
      yPosition += 15;
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text('REPORTE DE ORDEN DE SERVICIO', pageWidth / 2, yPosition, { align: 'center' });
      
      yPosition += 10;
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      doc.text(`Número de Orden: #${order.id}`, pageWidth / 2, yPosition, { align: 'center' });
      
      // Datos del cliente
      yPosition += 20;
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('DATOS DEL CLIENTE', margin, yPosition);
      
      yPosition += 12;
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      
      const clientDetails = [
        ['Nombre:', order.name || 'N/A'],
        ['Teléfono:', order.phone || 'N/A'],
        ['Email:', order.email || 'N/A'],
        ['Empresa:', order.empresa || 'N/A'],
        ['RNC:', order.rnc || 'N/A']
      ];
      
      clientDetails.forEach(([label, value]) => {
        if (value !== 'N/A') {
          doc.setFont(undefined, 'bold');
          doc.text(label, margin, yPosition);
          doc.setFont(undefined, 'normal');
          doc.text(value, margin + 35, yPosition);
          yPosition += 8;
        }
      });
      
      // Resumen del servicio
      yPosition += 15;
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('RESUMEN DEL SERVICIO', margin, yPosition);
      
      yPosition += 12;
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      
      const serviceDetails = [
        ['Servicio:', order.service?.name || order.service_name || 'N/A'],
        ['Vehículo:', order.vehicle?.name || order.vehicle_name || 'N/A'],
        ['Fecha de solicitud:', formatDate(order.created_at)],
        ['Fecha de servicio:', `${order.date || 'N/A'} ${order.time || ''}`],
        ['Estado:', order.status || 'N/A'],
        ['Monto cobrado:', order.monto_cobrado ? `$${Number(order.monto_cobrado).toLocaleString('es-DO')}` : 'Por confirmar']
      ];
      
      serviceDetails.forEach(([label, value]) => {
        doc.setFont(undefined, 'bold');
        doc.text(label, margin, yPosition);
        doc.setFont(undefined, 'normal');
        doc.text(value, margin + 35, yPosition);
        yPosition += 8;
      });
      
      // Ruta del servicio
      if (order.pickup || order.delivery) {
        yPosition += 12;
        doc.setFont(undefined, 'bold');
        doc.text('RUTA:', margin, yPosition);
        yPosition += 8;
        doc.setFont(undefined, 'normal');
        
        if (order.pickup) {
          doc.text(`Recogida: ${order.pickup}`, margin + 10, yPosition);
          yPosition += 8;
        }
        if (order.delivery) {
          doc.text(`Entrega: ${order.delivery}`, margin + 10, yPosition);
          yPosition += 8;
        }
      }
      
      // Preguntas del servicio
      if (order.service_questions && Object.keys(order.service_questions).length > 0) {
        yPosition += 12;
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('DETALLES ADICIONALES', margin, yPosition);
        
        yPosition += 10;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        
        try {
          const questions = typeof order.service_questions === 'string' 
            ? JSON.parse(order.service_questions) 
            : order.service_questions;
            
          Object.entries(questions).forEach(([key, value]) => {
            if (yPosition > 250) { // Nueva página si no hay espacio
              doc.addPage();
              yPosition = 20;
            }
            doc.setFont(undefined, 'bold');
            doc.text(`${key}:`, margin, yPosition);
            doc.setFont(undefined, 'normal');
            
            // Manejar valores largos
            const text = String(value || '');
            if (text.length > 60) {
              const lines = doc.splitTextToSize(text, pageWidth - 2 * margin - 10);
              doc.text(lines, margin + 10, yPosition + 5);
              yPosition += lines.length * 4 + 5;
            } else {
              doc.text(text, margin + 10, yPosition + 5);
              yPosition += 12;
            }
          });
        } catch (e) {
          console.warn('Error al procesar service_questions:', e);
        }
      }
      
      // Evidencia
      if (order.evidence_photos && order.evidence_photos.length > 0) {
        yPosition += 10;
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(`Evidencia fotográfica: ${order.evidence_photos.length} foto(s) adjunta(s)`, margin, yPosition);
        yPosition += 5;
        doc.setFontSize(9);
        doc.setFont(undefined, 'italic');
        doc.text('(Las fotos están disponibles en el sistema)', margin, yPosition);
      }
      
      // === SEGUNDA PÁGINA: DATOS DEL COLABORADOR ===
      
      doc.addPage();
      yPosition = 30;
      
      // Repetir encabezado de empresa en segunda página
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text('LOGISTICA LOPEZ ORTIZ - RNC: 133139413', pageWidth / 2, yPosition, { align: 'center' });
      
      yPosition += 15;
      doc.setFontSize(16);
      doc.text('INFORMACIÓN DE FINALIZACIÓN', pageWidth / 2, yPosition, { align: 'center' });
      
      yPosition += 20;
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      
      const collaboratorName = order.profiles?.full_name || order.completed_by_name || 'No asignado';
      const completedDate = formatDate(order.completed_at);
      
      const completionDetails = [
        ['ID de Orden:', order.id.toString()],
        ['Completado por:', collaboratorName],
        ['Fecha de finalización:', completedDate],
        ['Método de pago:', order.metodo_pago || 'No especificado'],
        ['Monto final:', order.monto_cobrado ? `$${Number(order.monto_cobrado).toLocaleString('es-DO')}` : 'No cobrado']
      ];
      
      completionDetails.forEach(([label, value]) => {
        doc.setFont(undefined, 'bold');
        doc.text(label, margin, yPosition);
        doc.setFont(undefined, 'normal');
        doc.text(value, margin + 45, yPosition);
        yPosition += 12;
      });
      
      // Información adicional del colaborador
      if (order.assigned_to || order.accepted_by) {
        yPosition += 15;
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('HISTORIAL DE ASIGNACIONES', margin, yPosition);
        
        yPosition += 12;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        
        if (order.assigned_at) {
          doc.setFont(undefined, 'bold');
          doc.text('Asignado el:', margin, yPosition);
          doc.setFont(undefined, 'normal');
          doc.text(formatDate(order.assigned_at), margin + 30, yPosition);
          yPosition += 8;
        }
        
        if (order.accepted_at) {
          doc.setFont(undefined, 'bold');
          doc.text('Aceptado el:', margin, yPosition);
          doc.setFont(undefined, 'normal');
          doc.text(formatDate(order.accepted_at), margin + 30, yPosition);
          yPosition += 8;
        }
      }
      
      // Notas y observaciones
      yPosition += 20;
      doc.setFontSize(11);
      doc.setFont(undefined, 'italic');
      doc.text('Este documento es un reporte oficial de la orden de servicio.', margin, yPosition);
      
      yPosition += 6;
      doc.text('Para consultas, contactar a Logistica Lopez Ortiz.', margin, yPosition);
      
      // Pie de página en ambas páginas
      const addFooter = () => {
        const footerY = doc.internal.pageSize.getHeight() - 20;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}`, margin, footerY);
        doc.text('Sistema de Gestión - Logistica Lopez Ortiz', pageWidth - margin, footerY, { align: 'right' });
      };
      
      // Agregar pie de página a ambas páginas
      addFooter();
      
      // Descargar el PDF
      const fileName = `orden_${order.id}_${order.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'cliente'}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
      console.log(`[Historial] PDF generado exitosamente para la orden #${order.id}`);
      
    } catch (error) {
      console.error('[Historial] Error al generar PDF:', error);
      alert('Error al generar el PDF. Por favor intente nuevamente.');
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
      const authenticatedClient = supabaseConfig.client; // Usar el cliente autenticado

      // Paso 1: Obtener todas las órdenes completadas y canceladas sin joins
      const { data: orders, error: ordersError } = await authenticatedClient
        .from('orders')
        .select('*')
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

      // Paso 3: Obtener datos de colaboradores y servicios en paralelo
      let collaborators = [];
      let services = [];

      if (collaboratorIds.length > 0) {
        const { data: collabData, error: collabError } = await authenticatedClient
          .from('profiles')
          .select('id, full_name')
          .in('id', collaboratorIds);
        if (collabError) console.warn('[Historial] Error al cargar colaboradores:', collabError);
        else collaborators = collabData;
      }

      if (serviceIds.length > 0) {
        const { data: serviceData, error: serviceError } = await authenticatedClient
          .from('services')
          .select('id, name')
          .in('id', serviceIds);
        if (serviceError) console.warn('[Historial] Error al cargar servicios:', serviceError);
        else services = serviceData;
      }

      // Mapear para búsqueda rápida
      const collaboratorsMap = new Map(collaborators.map(c => [c.id, c.full_name]));
      const servicesMap = new Map(services.map(s => [s.id, s.name]));

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

  // Carga inicial y suscripción en tiempo real
  const initialize = async () => {
    await loadHistory();
    setupRealtimeSubscription();
  };

  // Esperar a que la sesión del administrador esté lista
  window.addEventListener('admin-session-ready', initialize);
});
