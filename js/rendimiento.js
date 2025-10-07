// Rendimiento del Colaborador - JavaScript

// Variables globales
let currentCollabEmail = '';
let weeklyChart = null;
let servicesChart = null;

// Elementos del modal de horarios
const scheduleModal = document.getElementById('scheduleModal');
const editScheduleBtn = document.getElementById('editScheduleBtn');
const closeScheduleModal = document.getElementById('closeScheduleModal');
const cancelSchedule = document.getElementById('cancelSchedule');
const scheduleForm = document.getElementById('scheduleForm');

// Función para requerir sesión
function requireSession() {
    const session = JSON.parse(localStorage.getItem('tlc_collab_session') || 'null');
    if (!session) {
        window.location.href = 'login-colaborador.html';
        return null;
    }
    return session;
}

// Función para cargar órdenes y métricas
function loadOrders() {
    const orders = JSON.parse(localStorage.getItem('tlc_orders') || '[]');
    const metrics = JSON.parse(localStorage.getItem('tlc_collab_metrics') || '{}');
    return { orders, metrics };
}

// Función para formatear nombre del colaborador
function collabDisplayName(email) {
    const parts = email.split('@')[0].split(/[._-]/);
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

// Función para calcular métricas principales
function calculateMainMetrics(data, email) {
    const collaboratorOrders = data.orders.filter(order => order.completedBy === email || order.assignedEmail === email);
    const metrics = data.metrics[email] || { completedOrders: 0, totalTime: 0, serviceTypes: {} };
    
    const completed = collaboratorOrders.filter(order => 
        order.lastCollabStatus === 'entregado' || order.status === 'Completado'
    );
    
    const active = collaboratorOrders.filter(order => 
        ['en_camino_recoger', 'cargando', 'en_camino_entregar'].includes(order.lastCollabStatus)
    );
    
    const total = metrics.completedOrders;
    const successRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    
    // Calcular tiempo promedio real
    const avgTime = metrics.totalTime > 0 ? Math.round(metrics.totalTime / (1000 * 60 * metrics.completedOrders)) : 0;
    
    return {
        completed: metrics.completedOrders,
        active: active.length,
        successRate,
        avgTime
    };
}

// Función para obtener datos semanales
function getWeeklyData(data, email) {
    const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const weekData = new Array(7).fill(0);
    
    const now = new Date();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 1));
    
    const collaboratorOrders = data.orders.filter(order => order.completedBy === email);
    collaboratorOrders.forEach(order => {
        if (order.completedAt) {
            const orderDate = new Date(order.completedAt);
            const daysDiff = Math.floor((orderDate - startOfWeek) / (1000 * 60 * 60 * 24));
            if (daysDiff >= 0 && daysDiff < 7) {
                weekData[daysDiff]++;
            }
        }
    });
    
    return { labels: days, data: weekData };
}

// Función para obtener distribución de servicios
function getServicesDistribution(data, email) {
    const metrics = data.metrics[email] || { serviceTypes: {} };
    const services = metrics.serviceTypes;
    
    return {
        labels: Object.keys(services),
        data: Object.values(services)
    };
}

// Función para obtener estadísticas por vehículo
function getVehicleStats(data, email) {
    const collaboratorOrders = data.orders.filter(order => order.completedBy === email);
    const vehicles = {};
    
    collaboratorOrders.forEach(order => {
        if (order.vehicle && order.completedAt) {
            vehicles[order.vehicle] = (vehicles[order.vehicle] || 0) + 1;
        }
    });
    
    return vehicles;
}

// Función para obtener estadísticas de horarios
function getTimeStats(data, email) {
    const schedule = JSON.parse(localStorage.getItem(`schedule_${email}`) || 'null');
    if (!schedule) return null;

    return {
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        workDays: schedule.workDays
    };
}

// Función para renderizar horarios
function renderSchedule(schedule) {
    const container = document.getElementById('timeStats');
    if (!schedule) {
        container.innerHTML = '<p class="text-gray-500 text-sm">No hay horario configurado</p>';
        return;
    }

    container.innerHTML = `
        <div class="space-y-2">
            <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">Horario:</span>
                <span class="text-sm font-medium text-gray-800">${schedule.startTime} - ${schedule.endTime}</span>
            </div>
            <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">Días:</span>
                <span class="text-sm font-medium text-gray-800">${schedule.workDays.join(', ')}</span>
            </div>
        </div>
    `;
}

// Función para mostrar modal de horarios
function showScheduleModal() {
    const email = currentCollabEmail;
    const schedule = JSON.parse(localStorage.getItem(`schedule_${email}`) || 'null');
    
    if (schedule) {
        scheduleForm.startTime.value = schedule.startTime;
        scheduleForm.endTime.value = schedule.endTime;
        const checkboxes = scheduleForm.querySelectorAll('input[name="workDays"]');
        checkboxes.forEach(cb => {
            cb.checked = schedule.workDays.includes(cb.value);
        });
    }
    
    scheduleModal.classList.remove('hidden');
}

// Función para ocultar modal de horarios
function hideScheduleModal() {
    scheduleModal.classList.add('hidden');
    scheduleForm.reset();
}

// Función para guardar horario
function saveSchedule(event) {
    event.preventDefault();
    
    const startTime = scheduleForm.startTime.value;
    const endTime = scheduleForm.endTime.value;
    const workDays = Array.from(scheduleForm.querySelectorAll('input[name="workDays"]:checked'))
        .map(cb => cb.value);
    
    const schedule = { startTime, endTime, workDays };
    localStorage.setItem(`schedule_${currentCollabEmail}`, JSON.stringify(schedule));
    
    renderSchedule(schedule);
    hideScheduleModal();
}

// Función para crear gráfico semanal
function createWeeklyChart(weeklyData) {
    const ctx = document.getElementById('weeklyChart').getContext('2d');
    
    if (weeklyChart) {
        weeklyChart.destroy();
    }
    
    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: weeklyData.labels,
            datasets: [{
                label: 'Solicitudes Completadas',
                data: weeklyData.data,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// Función para crear gráfico de servicios
function createServicesChart(servicesData) {
    const ctx = document.getElementById('servicesChart').getContext('2d');
    
    if (servicesChart) {
        servicesChart.destroy();
    }
    
    servicesChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: servicesData.labels,
            datasets: [{
                data: servicesData.data,
                backgroundColor: [
                    'rgba(34, 197, 94, 0.8)',
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(249, 115, 22, 0.8)'
                ],
                borderColor: [
                    'rgba(34, 197, 94, 1)',
                    'rgba(59, 130, 246, 1)',
                    'rgba(249, 115, 22, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Función para actualizar progreso circular
function updateProgressCircle(completed, goal) {
    const circle = document.getElementById('progressCircle');
    const percentText = document.getElementById('progressPercent');
    
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    const percent = Math.min((completed / goal) * 100, 100);
    const offset = circumference - (percent / 100) * circumference;
    
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
    
    percentText.textContent = Math.round(percent) + '%';
    
    document.getElementById('monthlyGoal').textContent = goal;
    document.getElementById('monthlyCompleted').textContent = completed;
}

// Event listeners para el modal de horarios
if (editScheduleBtn) editScheduleBtn.addEventListener('click', showScheduleModal);
if (closeScheduleModal) closeScheduleModal.addEventListener('click', hideScheduleModal);
if (cancelSchedule) cancelSchedule.addEventListener('click', hideScheduleModal);
if (scheduleForm) scheduleForm.addEventListener('submit', saveSchedule);

// Función para renderizar estadísticas de vehículos
function renderVehicleStats(vehicleStats) {
    const container = document.getElementById('vehicleStats');
    const total = Object.values(vehicleStats).reduce((sum, count) => sum + count, 0);
    
    container.innerHTML = '';
    
    Object.entries(vehicleStats).forEach(([vehicle, count]) => {
        const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
        
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between';
        div.innerHTML = `
            <span class="text-sm text-gray-600">${vehicle}</span>
            <div class="flex items-center space-x-2">
                <div class="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div class="h-full bg-orange-500 rounded-full" style="width: ${percentage}%"></div>
                </div>
                <span class="text-sm font-medium text-gray-800">${count}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

// Función para renderizar estadísticas de horarios
function renderTimeStats(timeStats) {
    const container = document.getElementById('timeStats');
    const total = Object.values(timeStats).reduce((sum, count) => sum + count, 0);
    
    container.innerHTML = '';
    
    Object.entries(timeStats).forEach(([timeSlot, count]) => {
        const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
        
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between';
        div.innerHTML = `
            <span class="text-sm text-gray-600">${timeSlot}</span>
            <div class="flex items-center space-x-2">
                <div class="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div class="h-full bg-indigo-500 rounded-full" style="width: ${percentage}%"></div>
                </div>
                <span class="text-sm font-medium text-gray-800">${count}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

// Función para renderizar historial reciente
function renderRecentHistory(collaboratorOrders) {
    const container = document.getElementById('recentHistory');
    const recentOrders = collaboratorOrders
        .filter(order => order.lastCollabStatus === 'entregado' || order.status === 'entregado')
        .sort((a, b) => new Date(b.fecha || b.createdAt || 0) - new Date(a.fecha || a.createdAt || 0))
        .slice(0, 10);
    
    container.innerHTML = '';
    
    if (recentOrders.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="5" class="py-8 text-center text-gray-500">
                    No hay historial disponible
                </td>
            </tr>
        `;
        return;
    }
    
    recentOrders.forEach(order => {
        const date = new Date(order.fecha || order.createdAt || Date.now());
        const formattedDate = date.toLocaleDateString('es-ES', { 
            day: '2-digit', 
            month: '2-digit' 
        });
        
        const duration = Math.round(1 + Math.random() * 4); // Simulado
        
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-100 hover:bg-gray-50';
        row.innerHTML = `
            <td class="py-3">${formattedDate}</td>
            <td class="py-3">${order.servicio || 'N/A'}</td>
            <td class="py-3">${order.vehiculo || 'N/A'}</td>
            <td class="py-3">
                <span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                    Completado
                </span>
            </td>
            <td class="py-3">${duration}h</td>
        `;
        container.appendChild(row);
    });
}

// Función para actualizar perfil del colaborador
function updateCollaboratorProfile(session) {
    const name = collabDisplayName(session.email);
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    
    document.getElementById('collabName').textContent = name;
    document.getElementById('collabEmail').textContent = session.email;
    document.getElementById('collabAvatar').textContent = initials;
}

// Función principal para cargar datos
function loadPerformanceData() {
    const data = loadOrders();
    
    // Actualizar métricas principales
    const mainMetrics = calculateMainMetrics(data, currentCollabEmail);
    document.getElementById('completedCount').textContent = mainMetrics.completed;
    document.getElementById('activeCount').textContent = mainMetrics.active;
    document.getElementById('successRate').textContent = mainMetrics.successRate + '%';
    document.getElementById('avgTime').textContent = mainMetrics.avgTime + 'h';
    
    // Crear gráficos
    const weeklyData = getWeeklyData(data, currentCollabEmail);
    createWeeklyChart(weeklyData);
    
    const servicesData = getServicesDistribution(data, currentCollabEmail);
    createServicesChart(servicesData);
    
    // Actualizar progreso circular
    const monthlyGoal = 50; // Meta mensual
    updateProgressCircle(mainMetrics.completed, monthlyGoal);
    
    // Renderizar estadísticas
    const vehicleStats = getVehicleStats(data, currentCollabEmail);
    renderVehicleStats(vehicleStats);
    
    // Renderizar horario
    const schedule = getTimeStats(data, currentCollabEmail);
    renderSchedule(schedule);
    
    // Renderizar historial
    const collaboratorOrders = data.orders.filter(order => 
        order.completedBy === currentCollabEmail || 
        order.assignedEmail === currentCollabEmail
    );
    renderRecentHistory(collaboratorOrders);
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    const session = requireSession();
    if (!session) return;
    
    currentCollabEmail = session.email;
    updateCollaboratorProfile(session);
    
    // Inicializar iconos de Lucide
    lucide.createIcons();
    
    // Cargar datos de rendimiento
    loadPerformanceData();
    
    // Actualizar cada 30 segundos
    setInterval(loadPerformanceData, 30000);
});