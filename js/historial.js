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
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500"><div class="flex flex-col items-center gap-2"><i data-lucide="loader" class="w-8 h-8 animate-spin"></i><span>Cargando historial...</span></div></td></tr>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        // ✅ MEJORA: Cargar solo las órdenes completadas/canceladas y los datos relacionados.
        const { data, error } = await supabaseConfig.client
            .from('orders')
            .select('*, service:services(name), completed:profiles!orders_completed_by_fkey(full_name)')
            .in('status', ['Completado', 'Cancelado'])
            .order('completed_at', { ascending: false, nullsLast: true })
            .order('created_at', { ascending: false });

        if (error) throw error;

        allRequests = data || [];
        filteredRequests = [...allRequests];
        displayRequests();
    } catch (error) {
        console.error('Error cargando desde Supabase:', error);
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-red-500">No se pudo cargar el historial.</td></tr>`;
}
}

function displayRequests() {
    const tbody = document.getElementById('historyTableBody');
    const showingCount = document.getElementById('showingCount');
    const totalCount = document.getElementById('totalCount');

    if (!tbody) return;

    if (filteredRequests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">No se encontraron solicitudes en el historial.</td></tr>`;
        if (showingCount) showingCount.textContent = 0;
        if (totalCount) totalCount.textContent = allRequests.length;
        return;
    }

    const startIndex = (currentPage - 1) * requestsPerPage;
    const endIndex = startIndex + requestsPerPage;
    const pageRequests = filteredRequests.slice(startIndex, endIndex);

    tbody.innerHTML = pageRequests.map(request => {
        const evidence = Array.isArray(request.photos) ? request.photos : (Array.isArray(request.evidence_urls) ? request.evidence_urls : []);
        const evidenceCell = evidence.length > 0
            ? `<button class="view-evidence px-3 py-1 bg-blue-600 text-white rounded text-sm" data-id="${request.id}">Ver</button>`
            : '<span class="text-gray-400">N/A</span>';
        return `
        <tr data-id="${request.id}" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${request.id}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${request.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${request.service?.name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${request.completed_at ? new Date(request.completed_at).toLocaleDateString('es-DO') : 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${request.completed?.full_name || 'No asignado'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${request.status === 'Completado' ? 'text-green-600' : 'text-red-600'}">${request.estimated_price || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">${evidenceCell}</td>
        </tr>`;
    }).join('');

    if (showingCount) showingCount.textContent = pageRequests.length;
    if (totalCount) totalCount.textContent = filteredRequests.length;
    // Aquí iría la lógica de paginación si se implementa

    // Vincular botones de evidencia
    document.querySelectorAll('.view-evidence').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const req = filteredRequests.find(r => String(r.id) === String(id));
            openEvidenceModal(req);
        });
    });
}

function openEvidenceModal(request) {
    const modal = document.getElementById('evidenceModal');
    const gallery = document.getElementById('evidenceGallery');
    if (!modal || !gallery || !request) return;
    const evidence = Array.isArray(request.photos) ? request.photos : (Array.isArray(request.evidence_urls) ? request.evidence_urls : []);
    if (evidence.length === 0) {
        gallery.innerHTML = '<div class="text-gray-500">No hay evidencia disponible para esta solicitud.</div>';
    } else {
        gallery.innerHTML = evidence.map(url => `
            <div class="border rounded-lg overflow-hidden">
              <img src="${url}" alt="Evidencia" class="w-full h-40 object-cover" />
            </div>
        `).join('');
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'closeEvidenceModal') {
        const modal = document.getElementById('evidenceModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }
});

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const dateFilter = document.getElementById('dateFilter').value;

    filteredRequests = allRequests.filter(request => {
        const matchSearch = !searchTerm ||
            request.name.toLowerCase().includes(searchTerm) ||
            (request.service?.name || '').toLowerCase().includes(searchTerm) ||
            String(request.id).toLowerCase().includes(searchTerm) ||
            String(request.short_id || '').toLowerCase().includes(searchTerm);

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