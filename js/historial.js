let allRequests = [];
let filteredRequests = [];
let currentPage = 1;
const requestsPerPage = 15;

document.addEventListener('DOMContentLoaded', function() {
    // Inicializar iconos
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    loadFromSupabase();

    // Listeners para filtros
    document.getElementById('searchInput')?.addEventListener('input', applyFilters);
    document.getElementById('dateFilter')?.addEventListener('change', applyFilters);
    document.getElementById('clearFilters')?.addEventListener('click', clearFilters);
});

async function loadFromSupabase() {
    const tableBody = document.getElementById('historyTableBody');
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500"><div class="flex flex-col items-center gap-2"><i data-lucide="loader" class="w-8 h-8 animate-spin"></i><span>Cargando historial...</span></div></td></tr>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        // ✅ MEJORA: Cargar solo las órdenes completadas/canceladas y los datos relacionados.
        const { data, error } = await supabaseConfig.client
            .from('orders')
            .select('*, service:services(name), collaborator:collaborators!completed_by(name)')
            .in('status', ['Completado', 'Cancelado'])
            .order('completed_at', { ascending: false, nullsLast: true })
            .order('created_at', { ascending: false });

        if (error) throw error;

        allRequests = data || [];
        filteredRequests = [...allRequests];
        displayRequests();
    } catch (error) {
        console.error('Error cargando desde Supabase:', error);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-red-500">No se pudo cargar el historial.</td></tr>`;
    }
}

function displayRequests() {
    const tbody = document.getElementById('historyTableBody');
    const showingCount = document.getElementById('showingCount');
    const totalCount = document.getElementById('totalCount');

    if (!tbody) return;

    if (filteredRequests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron solicitudes en el historial.</td></tr>`;
        if (showingCount) showingCount.textContent = 0;
        if (totalCount) totalCount.textContent = allRequests.length;
        return;
    }

    const startIndex = (currentPage - 1) * requestsPerPage;
    const endIndex = startIndex + requestsPerPage;
    const pageRequests = filteredRequests.slice(startIndex, endIndex);

    tbody.innerHTML = pageRequests.map(request => `
        <tr data-id="${request.id}" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${request.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${request.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${request.service?.name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${request.completed_at ? new Date(request.completed_at).toLocaleDateString('es-DO') : 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${request.collaborator?.name || 'No asignado'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${request.status === 'Completado' ? 'text-green-600' : 'text-red-600'}">${request.estimated_price || 'N/A'}</td>
        </tr>
    `).join('');

    if (showingCount) showingCount.textContent = pageRequests.length;
    if (totalCount) totalCount.textContent = filteredRequests.length;
    // Aquí iría la lógica de paginación si se implementa
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const dateFilter = document.getElementById('dateFilter').value;

    filteredRequests = allRequests.filter(request => {
        const matchSearch = !searchTerm ||
            request.name.toLowerCase().includes(searchTerm) ||
            (request.service?.name || '').toLowerCase().includes(searchTerm) ||
            String(request.id).includes(searchTerm);

        const matchDate = !dateFilter || request.completed_at?.startsWith(dateFilter);

        return matchSearch && matchDate;
    });

    currentPage = 1;
    displayRequests();
}

function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('dateFilter').value = '';
    filteredRequests = [...allRequests];
    currentPage = 1;
    displayRequests();
}

// Hacer funciones globales para que los botones en el HTML puedan llamarlas
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;