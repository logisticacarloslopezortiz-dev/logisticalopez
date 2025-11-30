/**
 * ✅ TEST DATA FIXTURE
 * Proporciona datos de prueba para desarrollo y demostración.
 * Se carga solo si no hay datos reales disponibles desde Supabase.
 */

window.TEST_DATA = {
  // Órdenes pendientes (sin asignar)
  pending: [
    {
      id: 1001,
      short_id: 'TLC001',
      name: 'Juan García',
      email: 'juan@example.com',
      phone: '+52 5555551234',
      status: 'Pendiente',
      service: 'Mudanza Residencial',
      vehicle: 'Van 3.5T',
      pickup: 'Calle Principal 123, CDMX',
      delivery: 'Avenida Reforma 456, CDMX',
      date: '2025-11-26',
      time: '10:00 AM',
      assigned_to: null,
      origin_coords: { lat: 19.4269, lng: -99.1276 },
      destination_coords: { lat: 19.4452, lng: -99.1299 },
      evidence_photos: [],
      tracking_data: [{ status: 'Pendiente', date: new Date().toISOString() }]
    },
    {
      id: 1002,
      short_id: 'TLC002',
      name: 'María López',
      email: 'maria@example.com',
      phone: '+52 5555552345',
      status: 'Pendiente',
      service: 'Paquetería Express',
      vehicle: 'Bicicleta',
      pickup: 'Centro Comercial Norte, CDMX',
      delivery: 'Zona Residencial Sur, CDMX',
      date: '2025-11-26',
      time: '02:30 PM',
      assigned_to: null,
      origin_coords: { lat: 19.5031, lng: -99.2038 },
      destination_coords: { lat: 19.3325, lng: -99.1331 },
      evidence_photos: [],
      tracking_data: [{ status: 'Pendiente', date: new Date().toISOString() }]
    },
    {
      id: 1003,
      short_id: 'TLC003',
      name: 'Carlos Rodríguez',
      email: 'carlos@example.com',
      phone: '+52 5555553456',
      status: 'Pendiente',
      service: 'Entrega Especial',
      vehicle: 'Auto Sedan',
      pickup: 'Oficina Downtown, CDMX',
      delivery: 'Residencia Polanco, CDMX',
      date: '2025-11-26',
      time: '04:00 PM',
      assigned_to: null,
      origin_coords: { lat: 19.4363, lng: -99.1332 },
      destination_coords: { lat: 19.4526, lng: -99.1932 },
      evidence_photos: [],
      tracking_data: [{ status: 'Pendiente', date: new Date().toISOString() }]
    }
  ],

  // Órdenes asignadas (ejemplo de órdenes asignadas al colaborador actual)
  assigned: [
    {
      id: 2001,
      short_id: 'TLC-A001',
      name: 'Roberto Sánchez',
      email: 'roberto@example.com',
      phone: '+52 5555554567',
      status: 'En proceso',
      service: 'Mudanza Comercial',
      vehicle: 'Camión 5T',
      pickup: 'Almacén Centro, CDMX',
      delivery: 'Bodega Ecatepec, Edo Mex',
      date: '2025-11-26',
      time: '08:00 AM',
      assigned_to: 'demo-user-123', // Reemplazar con user.id real
      origin_coords: { lat: 19.4295, lng: -99.1332 },
      destination_coords: { lat: 19.6015, lng: -99.0506 },
      last_collab_status: 'en_camino_recoger',
      evidence_photos: [],
      tracking_data: [
        { status: 'Asignado', date: new Date(Date.now() - 3600000).toISOString() },
        { status: 'en_camino_recoger', date: new Date().toISOString() }
      ]
    },
    {
      id: 2002,
      short_id: 'TLC-A002',
      name: 'Patricia Martínez',
      email: 'patricia@example.com',
      phone: '+52 5555555678',
      status: 'En proceso',
      service: 'Paquetería Premium',
      vehicle: 'Moto',
      pickup: 'Tienda Premium, CDMX',
      delivery: 'Domicilio Cliente, CDMX',
      date: '2025-11-26',
      time: '11:00 AM',
      assigned_to: 'demo-user-123',
      origin_coords: { lat: 19.4326, lng: -99.1438 },
      destination_coords: { lat: 19.4445, lng: -99.1606 },
      last_collab_status: 'cargando',
      evidence_photos: [],
      tracking_data: [
        { status: 'Asignado', date: new Date(Date.now() - 1800000).toISOString() },
        { status: 'en_camino_recoger', date: new Date(Date.now() - 900000).toISOString() },
        { status: 'cargando', date: new Date().toISOString() }
      ]
    }
  ],

  // Órdenes completadas (para historial)
  completed: [
    {
      id: 3001,
      short_id: 'TLC-C001',
      name: 'Fernando López',
      email: 'fernando@example.com',
      phone: '+52 5555556789',
      status: 'Completada',
      service: 'Mudanza Residencial',
      vehicle: 'Van 3.5T',
      pickup: 'Apartamento Antiguo',
      delivery: 'Apartamento Nuevo',
      date: '2025-11-25',
      time: '09:00 AM',
      assigned_to: 'demo-user-123',
      origin_coords: { lat: 19.4202, lng: -99.1662 },
      destination_coords: { lat: 19.4317, lng: -99.1450 },
      last_collab_status: 'entregado',
      evidence_photos: ['https://via.placeholder.com/300x300?text=Foto+1'],
      tracking_data: [
        { status: 'Asignado', date: new Date(Date.now() - 86400000).toISOString() },
        { status: 'en_camino_recoger', date: new Date(Date.now() - 82800000).toISOString() },
        { status: 'cargando', date: new Date(Date.now() - 79200000).toISOString() },
        { status: 'en_camino_entregar', date: new Date(Date.now() - 75600000).toISOString() },
        { status: 'entregado', date: new Date(Date.now() - 72000000).toISOString() }
      ]
    }
  ]
};

/**
 * Función para obtener datos de prueba
 * @param {string} type - 'pending', 'assigned', o 'all'
 * @param {string} assignedToId - ID del colaborador (para filtrar assigned)
 * @returns {Array} - Array de órdenes
 */
function getTestOrders(type = 'all', assignedToId = 'demo-user-123') {
  switch (type) {
    case 'pending':
      return TEST_DATA.pending;
    case 'assigned':
      return TEST_DATA.assigned.filter(o => o.assigned_to === assignedToId);
    case 'completed':
      return TEST_DATA.completed.filter(o => o.assigned_to === assignedToId);
    case 'all':
    default:
      return [
        ...TEST_DATA.pending,
        ...TEST_DATA.assigned.filter(o => o.assigned_to === assignedToId),
        ...TEST_DATA.completed.filter(o => o.assigned_to === assignedToId)
      ];
  }
}

console.log('✅ Test data fixture loaded. Use getTestOrders() to retrieve mock data.');
