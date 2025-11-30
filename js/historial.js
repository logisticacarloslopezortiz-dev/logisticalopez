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
      
      // --- CONFIGURACIÓN Y HELPERS ---
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 15;
      const contentWidth = pageWidth - (margin * 2);
      let yPosition = 20;
      const lineHeight = 6; // Altura de línea base para texto normal
      const sectionGap = 12; // Espacio entre secciones

      // Helper para renderizar una fila con etiqueta y valor (maneja texto largo)
      const printRow = (label, value, y, options = {}) => {
          const labelWidth = options.labelWidth || 40;
          const valueX = margin + labelWidth;
          const valueWidth = contentWidth - labelWidth;

          doc.setFont(undefined, 'bold');
          doc.text(label, margin, y);
          doc.setFont(undefined, 'normal');

          const lines = doc.splitTextToSize(String(value || 'N/A'), valueWidth);
          doc.text(lines, valueX, y);

          // Retorna la nueva posición Y después de este bloque, añadiendo un pequeño espacio
          return y + (lines.length * lineHeight) + 2;
      };

      // Helper para añadir un salto de página si es necesario
      const checkPageBreak = (y) => {
        if (y > doc.internal.pageSize.getHeight() - 20) {
          doc.addPage();
          return 20; // Reset Y a la posición inicial
        }
        return y;
      };

      // --- PÁGINA 1: RESUMEN DE LA ORDEN ---
      
      // Encabezado
      doc.setFontSize(20);
      doc.setFont(undefined, 'bold');
      doc.text('LOGISTICA LOPEZ ORTIZ', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 8;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text('RNC: 133139413', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 5;
      doc.text('Tel: 829-729-3822 | Email: transporteylogisticalopezortiz@gmail.com', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 5;

      const addressLines = doc.splitTextToSize('San Cristóbal, Plaza Vionicio, Calle Sánchez, Esquina Padre Ayala', contentWidth);
      doc.text(addressLines, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += (addressLines.length * 4) + sectionGap;

      // Línea separadora
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += sectionGap;

      // Título
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text('Reporte de Orden de Servicio', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 8;
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      doc.text(`#${order.id}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += sectionGap * 1.5;

      // Secciones
      doc.setFontSize(11);
      
      const sections = [
        { title: 'DATOS DEL CLIENTE', details: [
          ['Nombre:', order.name],
          ['Teléfono:', order.phone],
          ['Email:', order.email],
          order.empresa ? ['Empresa:', order.empresa] : null,
          order.rnc ? ['RNC:', order.rnc] : null
        ]},
        { title: 'RESUMEN DEL SERVICIO', details: [
          ['Servicio:', order.service?.name || order.service_name],
          ['Vehículo:', order.vehicle?.name || order.vehicle_name],
          ['Solicitud:', formatDate(order.created_at)],
          ['Programado:', `${order.date || ''} ${order.time || ''}`.trim()],
          ['Estado:', order.status],
          ['Monto:', order.monto_cobrado ? `$${Number(order.monto_cobrado).toLocaleString('es-DO')}` : 'N/A']
        ]},
        { title: 'RUTA', details: [
          ['Recogida:', order.pickup],
          ['Entrega:', order.delivery]
        ]}
      ];

      sections.forEach(section => {
        yPosition = checkPageBreak(yPosition);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text(section.title, margin, yPosition);
        yPosition += 8;
        doc.setFontSize(11);
        section.details.filter(Boolean).forEach(([label, value]) => {
          yPosition = checkPageBreak(yPosition);
          yPosition = printRow(label, value, yPosition);
        });
        yPosition += sectionGap / 2;
      });

      // Detalles adicionales (preguntas)
      if (order.service_questions && Object.keys(order.service_questions).length > 0) {
        yPosition = checkPageBreak(yPosition);
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('DETALLES ADICIONALES', margin, yPosition);
        yPosition += 8;
        doc.setFontSize(10);
        
        const questions = typeof order.service_questions === 'string'
            ? JSON.parse(order.service_questions) 
            : order.service_questions;
            
        for (const [key, value] of Object.entries(questions)) {
            yPosition = checkPageBreak(yPosition);
            const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ':';
            yPosition = printRow(formattedKey, value, yPosition, { labelWidth: 55, lineHeight: 4.5 });
        }
      }

      // --- PÁGINA 2: INFORMACIÓN DE FINALIZACIÓN ---
      doc.addPage();
      yPosition = 20;

      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text('Información de Finalización', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += sectionGap * 1.5;
      
      doc.setFontSize(12);
      const collaboratorName = order.profiles?.full_name || order.completed_by_name || 'No asignado';
      
      yPosition = printRow('ID de Orden:', order.id.toString(), yPosition, { labelWidth: 50, lineHeight: 6, gap: 4 });
      yPosition = printRow('Completado por:', collaboratorName, yPosition, { labelWidth: 50, lineHeight: 6, gap: 4 });
      yPosition = printRow('Fecha de finalización:', formatDate(order.completed_at), yPosition, { labelWidth: 50, lineHeight: 6, gap: 4 });
      yPosition = printRow('Método de pago:', order.metodo_pago, yPosition, { labelWidth: 50, lineHeight: 6, gap: 4 });
      yPosition = printRow('Monto final:', order.monto_cobrado ? `$${Number(order.monto_cobrado).toLocaleString('es-DO')}` : 'No cobrado', yPosition, { labelWidth: 50, lineHeight: 6, gap: 4 });

      if (order.evidence_photos && order.evidence_photos.length > 0) {
        yPosition = checkPageBreak(yPosition);
        yPosition = printRow('Evidencia:', `${order.evidence_photos.length} foto(s) disponible(s) en el sistema.`, yPosition, { labelWidth: 50, lineHeight: 6, gap: 4 });
      }

      yPosition += sectionGap;
      yPosition = checkPageBreak(yPosition);
      doc.setFontSize(11);
      doc.setFont(undefined, 'italic');
      doc.text('Este documento es un reporte oficial del servicio prestado.', margin, yPosition);

      // Pie de página en todas las páginas
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const footerY = doc.internal.pageSize.getHeight() - 15;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
        doc.text(`Generado el: ${new Date().toLocaleString('es-ES')}`, margin, footerY);
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin, footerY, { align: 'right' });
      }
      
      const fileName = `reporte_orden_${order.id}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
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
