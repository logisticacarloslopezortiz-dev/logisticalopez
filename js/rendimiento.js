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

// Sesión: usar Supabase Auth en lugar de localStorage custom
async function getSupabaseSession() {
    try {
        const { data: { session } } = await supabaseConfig.client.auth.getSession();
        if (!session) {
            window.location.href = 'login-colaborador.html';
            return null;
        }
        return session;
    } catch (err) {
        console.error('Error obteniendo sesión Supabase:', err);
        window.location.href = 'login-colaborador.html';
        return null;
    }
}

// ✅ OPTIMIZADO: Llama a la función RPC para obtener todas las métricas del servidor
async function fetchPerformanceMetrics(collabId) {
    try {
        const { data, error } = await supabaseConfig.client.rpc('get_collaborator_performance', {
            p_collaborator_id: collabId
        });

        if (error) {
            // Si la función RPC no existe, mostrar un error claro.
            if (error.code === '42883') {
                console.error("Error: La función 'get_collaborator_performance' no existe en la base de datos. Por favor, ejecuta el script en `sql/rpc_functions.sql`.");
                throw new Error("Función de métricas no encontrada en el servidor.");
            }
            throw error;
        }

        return data;
    } catch (e) {
        console.error('Error cargando métricas de rendimiento desde RPC:', e);
        // Devuelve un objeto con valores por defecto para evitar que la UI se rompa
        return {
            completed_orders: 0,
            active_orders: 0,
            success_rate: 0,
            avg_completion_minutes: 0,
            weekly_performance: [],
            services_distribution: {},
            vehicles_distribution: {},
            recent_history: []
        };
    }
}

// Función para formatear nombre del colaborador
function collabDisplayName(email = '') {
    try {
        const base = email.split('@')[0];
        return base.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } catch {
        return 'Colaborador';
    }
}

// ✅ OPTIMIZADO: Actualiza el sidebar con los datos de la RPC
function updateSidebarStats(metrics) {
    try {
        document.getElementById('collabActiveJobs').textContent = metrics.active_orders || 0;
        document.getElementById('collabCompletedJobs').textContent = metrics.completed_orders || 0;
        // El conteo de pendientes se podría añadir a la RPC si fuera necesario,
        // pero por ahora lo mantenemos simple.
    } catch (err) {
        console.warn('[Stats] Error al actualizar estadísticas del sidebar:', err);
    }
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

// ✅ OPTIMIZADO: Renderiza el historial reciente desde los datos de la RPC
function renderRecentHistory(history) {
    const container = document.getElementById('recentHistory');
    
    if (!history || history.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="5" class="py-8 text-center text-gray-500">
                    No hay historial reciente disponible.
                </td>
            </tr>
        `;
        return;
    }
    
    container.innerHTML = history.map(order => {
        const date = new Date(order.completed_at);
        const formattedDate = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
        const durationHours = Math.round((order.completion_time_minutes || 0) / 60);

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-3">${formattedDate}</td>
                <td class="p-3 hidden sm:table-cell">${order.service_name || 'N/A'}</td>
                <td class="p-3 hidden md:table-cell">${order.vehicle_name || 'N/A'}</td>
                <td class="p-3">
                    <span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                        Completado
                    </span>
                </td>
                <td class="p-3 hidden sm:table-cell">${durationHours}h</td>
            </tr>
        `;
    }).join('');
}

// Función para actualizar perfil del colaborador
function updateCollaboratorProfile(session) {
    const user = session.user;
    const name = user.user_metadata?.full_name || collabDisplayName(user.email);
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    
    document.getElementById('collabName').textContent = name;
    document.getElementById('collabEmail').textContent = user.email;
    document.getElementById('collabAvatar').textContent = initials;
}

// ✅ OPTIMIZADO: Función principal que carga y renderiza los datos desde la RPC
async function loadPerformanceData(collabId) {
    // Cargar Chart.js si no está disponible
    if (!window.Chart) {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                script.async = true;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (e) {
            console.error('No se pudo cargar Chart.js. Los gráficos no estarán disponibles.');
            return;
        }
    }

    // 1. Obtener todas las métricas del servidor en una sola llamada
    const metrics = await fetchPerformanceMetrics(collabId);

    // 2. Renderizar las métricas principales
    document.getElementById('completedCount').textContent = metrics.completed_orders;
    document.getElementById('activeCount').textContent = metrics.active_orders;
    document.getElementById('successRate').textContent = `${metrics.success_rate}%`;
    document.getElementById('avgTime').textContent = `${Math.round(metrics.avg_completion_minutes / 60)}h`;

    // 3. Renderizar gráficos
    const weeklyData = {
        labels: metrics.weekly_performance.map(d => d.day),
        data: metrics.weekly_performance.map(d => d.count)
    };
    createWeeklyChart(weeklyData);

    const servicesData = {
        labels: Object.keys(metrics.services_distribution),
        data: Object.values(metrics.services_distribution)
    };
    createServicesChart(servicesData);

    // 4. Renderizar otros componentes
    const monthlyGoal = 50; // La meta puede ser dinámica en el futuro
    updateProgressCircle(metrics.completed_orders, monthlyGoal);
    renderVehicleStats(metrics.vehicles_distribution);
    renderRecentHistory(metrics.recent_history);

    // 5. Actualizar estadísticas del sidebar
    updateSidebarStats(metrics);

    // 6. Cargar y renderizar el horario desde localStorage (esto se mantiene local)
    const schedule = getTimeStats(null, currentCollabEmail);
    renderSchedule(schedule);
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    const session = await getSupabaseSession();
    if (!session) return;

    currentCollabEmail = session.user?.email || '';
    updateCollaboratorProfile({ email: currentCollabEmail });

    // Inicializar iconos de Lucide
    if (window.lucide) {
        lucide.createIcons();
    }

    await loadPerformanceData(session.user.id);

    // Actualizar cada 30 segundos
    setInterval(() => loadPerformanceData(session.user.id), 30000);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn){
        logoutBtn.addEventListener('click', async () => {
            try { await supabaseConfig.client.auth.signOut(); } catch(e){}
            try {
                const uid = session.user?.id;
                const preserve = [`tlc_collab_active_job`];
                if (uid) preserve.push(`tlc_active_job_${uid}`);
                const keys = Object.keys(localStorage);
                for (const k of keys) { if (!preserve.includes(k)) { try { localStorage.removeItem(k); } catch(_){} } }
            } catch(_){}
            window.location.href = 'login-colaborador.html';
        });
    }
});
