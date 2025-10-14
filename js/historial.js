let allRequests = [];
let filteredRequests = [];
let currentPage = 1;
const requestsPerPage = 10;

document.addEventListener('DOMContentLoaded', function() {
    loadHistoryRequests();
});

function loadHistoryRequests() {
    // Cargar desde localStorage (solicitudes completadas/canceladas)
    const historyRequests = JSON.parse(localStorage.getItem('historyRequests') || '[]');
    
    // Si hay Supabase configurado, también cargar desde allí
    if (typeof supabaseConfig !== 'undefined' && !supabaseConfig.useLocalStorage) {
        loadFromSupabase();
    } else {
        allRequests = historyRequests;
        filteredRequests = [...allRequests];
        displayRequests();
    }

    const tableBody = document.getElementById('requestsTableBody');
    if (tableBody) {
        tableBody.addEventListener('dblclick', (e) => {
            const row = e.target.closest('tr');
            if (row && row.dataset.id) {
                viewRequestDetail(row.dataset.id);
            }
        });
    }
}

async function loadFromSupabase() {
    try {
        // Asumiendo que tienes una función en supabaseConfig para obtener el historial
        const requests = await supabaseConfig.getOrders(); // O una función específica getHistoryRequests()
        allRequests = requests.filter(r => r.status === 'Completado' || r.status === 'Cancelado');
        filteredRequests = [...allRequests];
        displayRequests();
    } catch (error) {
        console.error('Error cargando desde Supabase:', error);
        // Fallback a localStorage
        const historyRequests = JSON.parse(localStorage.getItem('historyRequests') || '[]');
        allRequests = historyRequests;
        filteredRequests = [...allRequests];
        displayRequests();
    }
}

function displayRequests() {
    const tbody = document.getElementById('requestsTableBody');
    const totalElement = document.getElementById('totalRequests');
    const noRequestsElement = document.getElementById('noRequests');
    
    if (!tbody || !totalElement || !noRequestsElement) return;

    if (filteredRequests.length === 0) {
        tbody.innerHTML = '';
        noRequestsElement.style.display = 'block';
        document.querySelector('.requests-table').style.display = 'none';
        return;
    }

    noRequestsElement.style.display = 'none';
    document.querySelector('.requests-table').style.display = 'block';

    const startIndex = (currentPage - 1) * requestsPerPage;
    const endIndex = startIndex + requestsPerPage;
    const pageRequests = filteredRequests.slice(startIndex, endIndex);

    tbody.innerHTML = pageRequests.map(request => `
        <tr data-id="${request.id}" class="hover:bg-gray-50 cursor-pointer">
            <td><strong>${request.id}</strong></td>
            <td>${new Date(request.createdAt || request.serviceDate).toLocaleDateString()}</td>
            <td>${request.name || request.clientName}</td>
            <td>${request.service}</td>
            <td>
                <span class="order-type-badge ${request.orderType === 'COMPROBANTE FISCAL FIJO' ? 'type-fiscal' : 'type-regular'}">
                    ${request.orderType === 'COMPROBANTE FISCAL FIJO' ? 'FISCAL' : 'REGULAR'}
                </span>
            </td>
            <td>
                <span class="status-badge status-${(request.status || '').toLowerCase().replace(' ', '-')}">
                    ${request.status}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-view" onclick="viewRequestDetail('${request.id}')">Ver</button>
                </div>
            </td>
        </tr>
    `).join('');

    totalElement.textContent = `Total: ${filteredRequests.length}`;
    generatePagination();
}

function generatePagination() {
    const totalPages = Math.ceil(filteredRequests.length / requestsPerPage);
    const paginationElement = document.getElementById('pagination');
    
    if (!paginationElement || totalPages <= 1) {
        if(paginationElement) paginationElement.innerHTML = '';
        return;
    }

    let paginationHTML = '';
    
    if (currentPage > 1) {
        paginationHTML += `<button onclick="changePage(${currentPage - 1})">Anterior</button>`;
    }

    for (let i = 1; i <= totalPages; i++) {
        paginationHTML += `<button onclick="changePage(${i})" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
    }

    if (currentPage < totalPages) {
        paginationHTML += `<button onclick="changePage(${currentPage + 1})">Siguiente</button>`;
    }

    paginationElement.innerHTML = paginationHTML;
}

function changePage(page) {
    currentPage = page;
    displayRequests();
}

function applyFilters() {
    const dateFilter = document.getElementById('filterDate').value;
    const statusFilter = document.getElementById('filterStatus').value;
    const serviceFilter = document.getElementById('filterService').value;
    const idFilter = document.getElementById('searchId').value.toLowerCase();

    filteredRequests = allRequests.filter(request => {
        const requestDate = request.createdAt || request.serviceDate;
        const matchDate = !dateFilter || (requestDate && requestDate.startsWith(dateFilter));
        const matchStatus = !statusFilter || request.status === statusFilter;
        const matchService = !serviceFilter || request.service === serviceFilter;
        const matchId = !idFilter || (request.id && request.id.toLowerCase().includes(idFilter));

        return matchDate && matchStatus && matchService && matchId;
    });

    currentPage = 1;
    displayRequests();
}

function clearFilters() {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterService').value = '';
    document.getElementById('searchId').value = '';
    
    filteredRequests = [...allRequests];
    currentPage = 1;
    displayRequests();
}

function viewRequestDetail(requestId) {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) return;

    const modal = document.getElementById('requestDetailModal');
    const content = document.getElementById('requestDetailContent');

    let detailHTML = `
        <div class="request-detail">
            <div class="detail-section">
                <h4>Información General</h4>
                <p><strong>ID:</strong> ${request.id}</p>
                <p><strong>Tipo:</strong> ${request.orderType || 'REGULAR'}</p>
                <p><strong>Estado:</strong> ${request.status}</p>
                <p><strong>Fecha:</strong> ${new Date(request.createdAt || request.serviceDate).toLocaleString()}</p>
            </div>
            
            <div class="detail-section">
                <h4>Cliente</h4>
                <p><strong>Nombre:</strong> ${request.name || request.clientName}</p>
                <p><strong>Teléfono:</strong> ${request.phone || request.clientPhone}</p>
                <p><strong>Email:</strong> ${request.email || request.clientEmail || 'No proporcionado'}</p>
            </div>

            <div class="detail-section">
                <h4>Servicio</h4>
                <p><strong>Tipo:</strong> ${request.service}</p>
                <p><strong>Vehículo:</strong> ${request.vehicle}</p>
            </div>

            <div class="detail-section">
                <h4>Ubicaciones</h4>
                <p><strong>Recogida:</strong> ${request.pickup || request.pickupAddress}</p>
                <p><strong>Entrega:</strong> ${request.delivery || request.deliveryAddress}</p>
            </div>

            <div class="detail-section">
                <h4>Colaborador y Tiempos</h4>
                <p><strong>Asignado a:</strong> ${request.assignedTo || 'No asignado'}</p>
                <p><strong>Completado por:</strong> ${request.completedBy || 'N/A'}</p>
                <div class="mt-2">
                    <h5 class="font-medium text-gray-600">Historial de Acciones:</h5>
                    <ul class="list-disc pl-5 text-sm text-gray-500">
                        ${(request.tracking || []).map(t => `<li>${t.status} - ${new Date(t.at).toLocaleString()}</li>`).join('') || '<li>No hay acciones registradas.</li>'}
                    </ul>
                </div>
            </div>

            <div class="detail-section">
                <h4>Evidencia Fotográfica</h4>
                <div class="grid grid-cols-3 gap-2 mt-2">
                    ${(request.photos || []).map(p => `<a href="${p}" target="_blank"><img src="${p}" class="w-full h-auto rounded-md object-cover aspect-square"></a>`).join('') || '<p class="col-span-3 text-sm text-gray-500">No hay fotos de evidencia.</p>'}
                </div>
            </div>
    `;

    if (request.rnc || (request.rncData && request.rncData.rncNumber)) {
        detailHTML += `
            <div class="detail-section">
                <h4>Datos Fiscales</h4>
                <p><strong>RNC:</strong> ${request.rnc || request.rncData.rncNumber}</p>
                <p><strong>Empresa:</strong> ${request.empresa || request.rncData.companyName}</p>
            </div>
        `;
    }

    if (request.service_questions || request.serviceDetails) {
        const details = request.service_questions || request.serviceDetails;
        detailHTML += `
            <div class="detail-section">
                <h4>Detalles Específicos del Servicio</h4>
                <div class="service-details">${Object.entries(details).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`).join('\n')}</div>
            </div>
        `;
    }

    detailHTML += '</div>';
    content.innerHTML = detailHTML;
    modal.style.display = 'block';
}

function closeRequestDetail() {
    document.getElementById('requestDetailModal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('requestDetailModal');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
}

// Hacer funciones globales para que los botones en el HTML puedan llamarlas
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.changePage = changePage;
window.viewRequestDetail = viewRequestDetail;
window.closeRequestDetail = closeRequestDetail;