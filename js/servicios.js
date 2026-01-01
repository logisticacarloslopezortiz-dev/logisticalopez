document.addEventListener('DOMContentLoaded', () => {
    // Inicializar iconos
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // Elementos del DOM
  const addServiceBtn = document.getElementById('addServiceBtn');
  const addVehicleBtn = document.getElementById('addVehicleBtn');
  const newServiceInput = document.getElementById('newService');
  const newVehicleInput = document.getElementById('newVehicle');
  const manageModal = document.getElementById('manageModal');
  const modalTitle = document.getElementById('manageModalTitle');
  const modalLabel = document.getElementById('manageModalLabel');
  const modalNameInput = document.getElementById('modalNameInput');
  const modalDescInput = document.getElementById('modalDescInput');
  const modalImageInput = document.getElementById('modalImageInput');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalConfirmBtn = document.getElementById('modalConfirmBtn');
  let modalMode = null; // 'service' | 'vehicle'
    const serviceList = document.getElementById('serviceList');
    const vehicleList = document.getElementById('vehicleList');

    let allServices = []; // Almacenará objetos {id, name, ...}
    let allVehicles = []; // Almacenará objetos {id, name, ...}

    // --- Carga de Datos ---
    async function loadInitialData() {
        try {
            const [services, vehicles, orders] = await Promise.all([
                supabaseConfig.getServices(),
                supabaseConfig.getVehicles(),
                supabaseConfig.getOrders() 
            ]);

            allServices = services || [];
            allVehicles = vehicles || [];
            
            renderServices();
            renderVehicles();
            updateSummary();
            updateCharts(orders || []);

        } catch (error) {
            console.error("Error cargando datos iniciales:", error);
            alert("No se pudieron cargar los datos del panel. Revisa la conexión.");
        }
    }

    // --- Gráficos y Estadísticas ---
    function updateCharts(orders) {
        if (!allServices.length || !allVehicles.length) return;

        const serviceCounts = {};
        const vehicleCounts = {};

        allServices.forEach(s => { serviceCounts[s.id] = { name: s.name, count: 0 }; });
        allVehicles.forEach(v => { vehicleCounts[v.id] = { name: v.name, count: 0 }; });

        orders.forEach(order => {
            if (order.service_id && serviceCounts[order.service_id]) {
                serviceCounts[order.service_id].count++;
            }
            if (order.vehicle_id && vehicleCounts[order.vehicle_id]) {
                vehicleCounts[order.vehicle_id].count++;
            }
        });

        const sortedServices = Object.values(serviceCounts).sort((a, b) => b.count - a.count);
        const sortedVehicles = Object.values(vehicleCounts).sort((a, b) => b.count - a.count);

        // Actualizar tarjetas de resumen
        document.getElementById('mostRequestedService').textContent = sortedServices[0]?.name || 'N/A';
        document.getElementById('mostUsedVehicle').textContent = sortedVehicles[0]?.name || 'N/A';

        // Paleta de colores extendida
        const colorPalette = [
            '#1E405A', // Azul Oscuro
            '#1E8A95', // Turquesa
            '#FBBF24', // Amarillo
            '#4A5568', // Gris Oscuro
            '#38A169', // Verde
            '#805AD5', // Púrpura
            '#DD6B20', // Naranja
            '#3182CE'  // Azul Claro
        ];

        // Gráfico de Servicios
        const serviceChartCtx = document.getElementById('serviceChart')?.getContext('2d');
        if (serviceChartCtx) {
            new Chart(serviceChartCtx, {
                type: 'bar',
                data: {
                    labels: sortedServices.map(s => s.name),
                    datasets: [{
                        label: 'No. de Solicitudes',
                        data: sortedServices.map(s => s.count),
                        backgroundColor: colorPalette, // Usar la paleta completa
                        borderColor: 'rgba(255, 255, 255, 0.5)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } },
                    plugins: { legend: { display: false } } // Ocultar leyenda para más claridad
                }
            });
        }

        // Gráfico de Vehículos
        const vehicleChartCtx = document.getElementById('vehicleChart')?.getContext('2d');
        if (vehicleChartCtx) {
            new Chart(vehicleChartCtx, {
                type: 'doughnut',
                data: {
                    labels: sortedVehicles.map(v => v.name),
                    datasets: [{
                        label: 'No. de Usos',
                        data: sortedVehicles.map(v => v.count),
                        backgroundColor: colorPalette, // Usar la paleta completa
                        borderColor: '#fff',
                        borderWidth: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                        }
                    }
                }
            });
        }
    }
    // --- Renderizado ---
    function renderServices() {
        serviceList.innerHTML = '';
        if (!allServices || allServices.length === 0) {
            serviceList.innerHTML = '<p class="text-gray-500 col-span-full">No hay servicios registrados.</p>';
            return;
        }
        allServices.forEach(service => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:shadow-md transition-shadow';
            li.innerHTML = `
                <div class="flex items-center gap-3">
                    <i data-lucide="box" class="w-5 h-5 text-red-600"></i>
                    <span class="font-medium text-gray-800">${service.name}</span>
                </div>
                <button data-id="${service.id}" data-name="${service.name}" class="delete-service text-gray-400 hover:text-red-600 transition-colors p-1 rounded-full hover:bg-red-100">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            `;
            serviceList.appendChild(li);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function renderVehicles() {
        vehicleList.innerHTML = '';
        if (!allVehicles || allVehicles.length === 0) {
            vehicleList.innerHTML = '<p class="text-gray-500 col-span-full">No hay vehículos registrados.</p>';
            return;
        }
        allVehicles.forEach(vehicle => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:shadow-md transition-shadow';
            li.innerHTML = `
                <div class="flex items-center gap-3">
                    <i data-lucide="car" class="w-5 h-5 text-blue-600"></i>
                    <span class="font-medium text-gray-800">${vehicle.name}</span>
                </div>
                <button data-id="${vehicle.id}" data-name="${vehicle.name}" class="delete-vehicle text-gray-400 hover:text-red-600 transition-colors p-1 rounded-full hover:bg-red-100">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            `;
            vehicleList.appendChild(li);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function updateSummary() {
        document.getElementById('totalServices').textContent = allServices?.length || 0;
        document.getElementById('totalVehicles').textContent = allVehicles?.length || 0;
        // Lógica para servicio y vehículo top requeriría analizar las órdenes
    }

    // --- Lógica de Negocio ---
    async function handleAddService() {
    const sourceInput = modalMode === 'service' && modalNameInput ? modalNameInput : newServiceInput;
    const serviceName = sourceInput.value.trim();
    const serviceDesc = (modalMode === 'service' && modalDescInput) ? modalDescInput.value.trim() : '';
    const serviceImage = (modalMode === 'service' && modalImageInput) ? modalImageInput.value.trim() : '';
        if (!serviceName) return;

        try {
            addServiceBtn.disabled = true;
            addServiceBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Agregando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            const payload = { name: serviceName };
            if (serviceDesc) payload.description = serviceDesc;
            if (serviceImage) payload.image_url = serviceImage;
            const newService = await supabaseConfig.addService(payload);
            allServices.push(newService);
            renderServices();
            updateSummary();
            sourceInput.value = '';
            if (modalDescInput) modalDescInput.value = '';
            if (modalImageInput) modalImageInput.value = '';
        } catch (error) {
            console.error('Error al agregar servicio:', error.message);
            alert(`No se pudo agregar el servicio. Es posible que ya exista. Error: ${error.message}`);
        } finally {
            addServiceBtn.disabled = false;
            addServiceBtn.innerHTML = '<i data-lucide="plus" class="w-4 h-4"></i> Agregar Servicio';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    async function handleAddVehicle() {
    const sourceInputV = modalMode === 'vehicle' && modalNameInput ? modalNameInput : newVehicleInput;
    const vehicleName = sourceInputV.value.trim();
    const vehicleDesc = (modalMode === 'vehicle' && modalDescInput) ? modalDescInput.value.trim() : '';
    const vehicleImage = (modalMode === 'vehicle' && modalImageInput) ? modalImageInput.value.trim() : '';
        if (!vehicleName) return;

        try {
            addVehicleBtn.disabled = true;
            addVehicleBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Agregando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            const payloadV = { name: vehicleName };
            if (vehicleDesc) payloadV.description = vehicleDesc;
            if (vehicleImage) payloadV.image_url = vehicleImage;
            const newVehicle = await supabaseConfig.addVehicle(payloadV);
            allVehicles.push(newVehicle);
            renderVehicles();
            updateSummary();
            sourceInputV.value = '';
            if (modalDescInput) modalDescInput.value = '';
            if (modalImageInput) modalImageInput.value = '';
        } catch (error) {
            console.error('Error al agregar vehículo:', error.message);
            alert(`No se pudo agregar el vehículo. Es posible que ya exista. Error: ${error.message}`);
        } finally {
            addVehicleBtn.disabled = false;
            addVehicleBtn.innerHTML = '<i data-lucide="plus" class="w-4 h-4"></i> Agregar Vehículo';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    async function handleDelete(e) {
        const button = e.target.closest('button');
        if (!button || !button.dataset.id) return;

        const isService = button.classList.contains('delete-service');
        const isVehicle = button.classList.contains('delete-vehicle');

        if (!isService && !isVehicle) return;

        const { id, name } = button.dataset;
        const type = isService ? 'servicio' : 'vehículo';

        if (confirm(`¿Estás seguro de que quieres eliminar el ${type} "${name}"?`)) {
            try {
                if (isService) {
                    await supabaseConfig.deleteService(id);
                    allServices = allServices.filter(s => s.id.toString() !== id.toString());
                    renderServices();
                } else {
                    await supabaseConfig.deleteVehicle(id);
                    allVehicles = allVehicles.filter(v => v.id.toString() !== id.toString());
                    renderVehicles();
                }
                updateSummary();
            } catch (error) {
                console.error(`Error al eliminar ${type}:`, error.message);
                alert(`No se pudo eliminar el ${type}. Error: ${error.message}`);
            }
        }
    }

    // --- Event Listeners ---
    function openManageModal(mode){
      modalMode = mode;
      if (!manageModal) return;
      if (mode === 'service'){
        modalTitle.textContent = 'Agregar Servicio';
        modalLabel.textContent = 'Nombre del servicio';
        modalNameInput.value = newServiceInput?.value || '';
        if (modalDescInput) modalDescInput.placeholder = 'Descripción del servicio';
        if (modalImageInput) modalImageInput.placeholder = 'URL de imagen del servicio';
      } else {
        modalTitle.textContent = 'Agregar Vehículo';
        modalLabel.textContent = 'Tipo de vehículo';
        modalNameInput.value = newVehicleInput?.value || '';
        if (modalDescInput) modalDescInput.placeholder = 'Descripción del vehículo';
        if (modalImageInput) modalImageInput.placeholder = 'URL de imagen del vehículo';
      }
      manageModal.classList.remove('hidden');
      manageModal.classList.add('flex');
      modalNameInput?.focus();
    }

    function closeManageModal(){
      if (!manageModal) return;
      manageModal.classList.add('hidden');
      manageModal.classList.remove('flex');
      modalMode = null;
    }

    if (addServiceBtn) addServiceBtn.addEventListener('click', () => openManageModal('service'));
    if (addVehicleBtn) addVehicleBtn.addEventListener('click', () => openManageModal('vehicle'));
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeManageModal);
    if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', () => {
      if (modalMode === 'service') handleAddService(); else handleAddVehicle();
      closeManageModal();
    });
    
    newServiceInput.addEventListener('keypress', (e) => e.key === 'Enter' && openManageModal('service'));
    newVehicleInput.addEventListener('keypress', (e) => e.key === 'Enter' && openManageModal('vehicle'));
    newServiceInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAddService());
    newVehicleInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAddVehicle());
    serviceList.addEventListener('click', handleDelete);
    vehicleList.addEventListener('click', handleDelete);

    // Evitar doble carga
    let initialDataLoaded = false;
    function safeLoadInitialData() {
        if (initialDataLoaded) return;
        initialDataLoaded = true;
        loadInitialData();
    }

    // Carga inicial condicionada solo a sesión admin confirmada por servidor
    window.addEventListener('admin-session-ready', () => {
        safeLoadInitialData();
    });

    // Fallback: Si el evento ya ocurrió o se perdió
    if (window.tlcAdminReady) {
        safeLoadInitialData();
    } else {
        // Doble seguridad: si pasados 2 segundos no hay evento, verificar sesión manualmente
        setTimeout(() => {
            if (!initialDataLoaded && window.supabaseConfig && window.supabaseConfig.client) {
                console.warn('Evento admin-session-ready no recibido, intentando carga manual...');
                window.supabaseConfig.client.auth.getSession().then(({ data }) => {
                    if (data && data.session) {
                        safeLoadInitialData();
                    }
                });
            }
        }, 2000);
    }
});
