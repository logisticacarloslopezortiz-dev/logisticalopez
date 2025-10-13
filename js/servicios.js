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
    const serviceList = document.getElementById('serviceList');
    const vehicleList = document.getElementById('vehicleList');

    let allServices = []; // Almacenará objetos {id, name, ...}
    let allVehicles = []; // Almacenará objetos {id, name, ...}

    // --- Carga de Datos ---
    async function loadInitialData() {
        try {
            [allServices, allVehicles] = await Promise.all([
                supabaseConfig.getServices(), // Ya obtiene de Supabase
                supabaseConfig.getVehicles()  // Ya obtiene de Supabase
            ]);
            renderServices();
            renderVehicles();
            updateSummary();
        } catch (error) {
            console.error("Error cargando datos iniciales:", error);
            alert("No se pudieron cargar los servicios y vehículos. Revisa la conexión.");
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
        const serviceName = newServiceInput.value.trim();
        if (!serviceName) return;

        try {
            addServiceBtn.disabled = true;
            addServiceBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Agregando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            const newService = await supabaseConfig.addService({ name: serviceName });
            allServices.push(newService);
            renderServices();
            updateSummary();
            newServiceInput.value = '';
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
        const vehicleName = newVehicleInput.value.trim();
        if (!vehicleName) return;

        try {
            addVehicleBtn.disabled = true;
            addVehicleBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Agregando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            const newVehicle = await supabaseConfig.addVehicle({ name: vehicleName });
            allVehicles.push(newVehicle);
            renderVehicles();
            updateSummary();
            newVehicleInput.value = '';
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
    addServiceBtn.addEventListener('click', handleAddService);
    addVehicleBtn.addEventListener('click', handleAddVehicle);
    newServiceInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAddService());
    newVehicleInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAddVehicle());
    serviceList.addEventListener('click', handleDelete);
    vehicleList.addEventListener('click', handleDelete);

    // Carga inicial
    loadInitialData();
});// c:\Users\usuario\Documents\tlc\js\servicios.js

async function loadInitialData() {
    try {
        // 1. Llama a Supabase para obtener los datos
        [allServices, allVehicles] = await Promise.all([
            supabaseConfig.getServices(), // <-- Pide los servicios a la base de datos
            supabaseConfig.getVehicles()  // <-- Pide los vehículos a la base de datos
        ]);
        // 2. Dibuja los datos en la pantalla
        renderServices();
        renderVehicles();
        updateSummary();
    } catch (error) {
        console.error("Error cargando datos iniciales:", error);
        alert("No se pudieron cargar los servicios y vehículos. Revisa la conexión.");
    }
}
