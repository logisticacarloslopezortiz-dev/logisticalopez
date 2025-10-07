/**
 * Script de migración de datos desde localStorage a Supabase
 * 
 * Este archivo contiene funciones para migrar los datos almacenados en localStorage
 * a una base de datos Supabase. Debe ejecutarse después de configurar las tablas en Supabase.
 */

// Configuración de Supabase (reemplazar con valores reales)
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_KEY = 'tu-clave-anon-publica';

// Inicializar cliente de Supabase
const initSupabase = () => {
  return supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
};

// Función principal de migración
async function migrateDataToSupabase() {
  const supabase = initSupabase();
  
  try {
    // Mostrar mensaje de inicio
    console.log('Iniciando migración de datos a Supabase...');
    
    // Migrar vehículos
    await migrateVehicles(supabase);
    
    // Migrar servicios
    await migrateServices(supabase);
    
    // Migrar usuarios (clientes y colaboradores)
    await migrateUsers(supabase);
    
    // Migrar órdenes
    await migrateOrders(supabase);
    
    // Generar datos de rendimiento
    await generatePerformanceData(supabase);
    
    // Generar facturas para órdenes completadas
    await generateInvoices(supabase);
    
    console.log('Migración completada exitosamente');
  } catch (error) {
    console.error('Error durante la migración:', error.message);
  }
}

// Migrar vehículos desde localStorage
async function migrateVehicles(supabase) {
  const vehicles = JSON.parse(localStorage.getItem('vehicles') || '[]');
  console.log(`Migrando ${vehicles.length} vehículos...`);
  
  for (const vehicle of vehicles) {
    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        name: vehicle.name,
        type: vehicle.type,
        capacity: parseFloat(vehicle.capacity) || 0,
        is_active: vehicle.isActive !== false
      });
      
    if (error) console.error('Error al migrar vehículo:', error.message);
  }
  
  console.log('Migración de vehículos completada');
}

// Migrar servicios desde localStorage
async function migrateServices(supabase) {
  const services = [
    { name: 'Mudanza', description: 'Servicio de mudanza residencial', base_price: 150 },
    { name: 'Transporte Comercial', description: 'Transporte de mercancías para negocios', base_price: 200 },
    { name: 'Carga Pesada', description: 'Transporte de carga pesada y voluminosa', base_price: 300 }
  ];
  
  console.log(`Migrando ${services.length} servicios...`);
  
  for (const service of services) {
    const { data, error } = await supabase
      .from('services')
      .insert(service);
      
    if (error) console.error('Error al migrar servicio:', error.message);
  }
  
  console.log('Migración de servicios completada');
}

// Migrar usuarios desde localStorage
async function migrateUsers(supabase) {
  // Migrar clientes (extraídos de órdenes)
  const orders = JSON.parse(localStorage.getItem('orders') || '[]');
  const clientsMap = new Map();
  
  // Extraer clientes únicos de las órdenes
  orders.forEach(order => {
    if (order.clientName && order.clientEmail && order.clientPhone) {
      clientsMap.set(order.clientEmail, {
        name: order.clientName,
        email: order.clientEmail,
        phone: order.clientPhone,
        role: 'client'
      });
    }
  });
  
  const clients = Array.from(clientsMap.values());
  console.log(`Migrando ${clients.length} clientes...`);
  
  // Migrar colaboradores
  const collaborators = JSON.parse(localStorage.getItem('collaborators') || '[]');
  console.log(`Migrando ${collaborators.length} colaboradores...`);
  
  // Combinar usuarios para inserción
  const users = [
    ...clients,
    ...collaborators.map(collab => ({
      name: collab.name,
      email: collab.email || `${collab.name.toLowerCase().replace(/\s+/g, '.')}@tlc.com`,
      phone: collab.phone || '000-000-0000',
      role: 'collaborator'
    }))
  ];
  
  // Generar contraseña temporal para todos los usuarios
  for (const user of users) {
    // En producción, usar bcrypt o similar para hash de contraseñas
    user.password_hash = 'temporal_password_hash';
    
    const { data, error } = await supabase
      .from('users')
      .insert(user);
      
    if (error) console.error(`Error al migrar usuario ${user.email}:`, error.message);
  }
  
  console.log('Migración de usuarios completada');
}

// Migrar órdenes desde localStorage
async function migrateOrders(supabase) {
  const orders = JSON.parse(localStorage.getItem('orders') || '[]');
  console.log(`Migrando ${orders.length} órdenes...`);
  
  // Obtener mapeo de emails a IDs de usuarios
  const { data: users } = await supabase
    .from('users')
    .select('id, email, role');
  
  const userEmailToId = {};
  users.forEach(user => {
    userEmailToId[user.email] = user.id;
  });
  
  // Obtener servicios
  const { data: services } = await supabase
    .from('services')
    .select('id, name');
  
  const serviceNameToId = {};
  services.forEach(service => {
    serviceNameToId[service.name] = service.id;
  });
  
  // Obtener vehículos
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, name');
  
  const vehicleNameToId = {};
  vehicles.forEach(vehicle => {
    vehicleNameToId[vehicle.name] = vehicle.id;
  });
  
  // Migrar cada orden
  for (const order of orders) {
    const clientId = userEmailToId[order.clientEmail];
    if (!clientId) {
      console.warn(`Cliente no encontrado para la orden ${order.id}, email: ${order.clientEmail}`);
      continue;
    }
    
    // Mapear servicio
    const serviceId = serviceNameToId[order.service];
    if (!serviceId) {
      console.warn(`Servicio no encontrado para la orden ${order.id}: ${order.service}`);
      continue;
    }
    
    // Mapear vehículo
    const vehicleId = vehicleNameToId[order.vehicle];
    if (!vehicleId) {
      console.warn(`Vehículo no encontrado para la orden ${order.id}: ${order.vehicle}`);
      continue;
    }
    
    // Mapear colaborador asignado si existe
    let assignedToId = null;
    let assignedAt = null;
    let completedAt = null;
    
    if (order.assignedTo) {
      // Buscar colaborador por nombre
      const collaborator = users.find(u => 
        u.role === 'collaborator' && u.name === order.assignedTo
      );
      
      if (collaborator) {
        assignedToId = collaborator.id;
        assignedAt = new Date().toISOString();
        
        // Si el estado es completado, establecer fecha de completado
        if (order.status === 'Completado') {
          completedAt = new Date().toISOString();
        }
      }
    }
    
    // Mapear estado
    let status = 'pendiente';
    switch (order.status) {
      case 'En proceso':
        status = 'en_proceso';
        break;
      case 'Completado':
        status = 'completado';
        break;
      case 'Cancelado':
        status = 'cancelado';
        break;
    }
    
    // Crear objeto de orden para Supabase
    const newOrder = {
      client_id: clientId,
      service_id: serviceId,
      vehicle_id: vehicleId,
      pickup_address: order.pickupAddress,
      pickup_lat: order.pickupLocation?.lat || null,
      pickup_lng: order.pickupLocation?.lng || null,
      delivery_address: order.deliveryAddress,
      delivery_lat: order.deliveryLocation?.lat || null,
      delivery_lng: order.deliveryLocation?.lng || null,
      items_description: order.itemsDescription || '',
      scheduled_date: order.date,
      scheduled_time: order.time,
      status: status,
      price: parseFloat(order.price) || 0,
      assigned_to: assignedToId,
      assigned_at: assignedAt,
      completed_at: completedAt
    };
    
    const { data, error } = await supabase
      .from('orders')
      .insert(newOrder);
      
    if (error) console.error(`Error al migrar orden ${order.id}:`, error.message);
  }
  
  console.log('Migración de órdenes completada');
}

// Generar datos de rendimiento para colaboradores
async function generatePerformanceData(supabase) {
  // Obtener colaboradores
  const { data: collaborators } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'collaborator');
  
  console.log(`Generando datos de rendimiento para ${collaborators.length} colaboradores...`);
  
  // Para cada colaborador, generar métricas de rendimiento
  for (const collaborator of collaborators) {
    // Obtener órdenes completadas por este colaborador
    const { data: completedOrders } = await supabase
      .from('orders')
      .select('price')
      .eq('assigned_to', collaborator.id)
      .eq('status', 'completado');
    
    if (!completedOrders || completedOrders.length === 0) continue;
    
    // Calcular ganancias totales
    const totalEarnings = completedOrders.reduce((sum, order) => sum + order.price, 0);
    
    // Generar calificación promedio aleatoria entre 3.5 y 5.0
    const averageRating = (3.5 + Math.random() * 1.5).toFixed(2);
    
    // Crear registro de rendimiento para el mes actual
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    const performanceData = {
      collaborator_id: collaborator.id,
      orders_completed: completedOrders.length,
      total_earnings: totalEarnings,
      average_rating: parseFloat(averageRating),
      period_start: firstDayOfMonth.toISOString().split('T')[0],
      period_end: lastDayOfMonth.toISOString().split('T')[0]
    };
    
    const { data, error } = await supabase
      .from('performance')
      .insert(performanceData);
      
    if (error) console.error(`Error al generar datos de rendimiento:`, error.message);
  }
  
  console.log('Generación de datos de rendimiento completada');
}

// Generar facturas para órdenes completadas
async function generateInvoices(supabase) {
  // Obtener órdenes completadas
  const { data: completedOrders } = await supabase
    .from('orders')
    .select('id, price, completed_at')
    .eq('status', 'completado');
  
  if (!completedOrders || completedOrders.length === 0) {
    console.log('No hay órdenes completadas para generar facturas');
    return;
  }
  
  console.log(`Generando facturas para ${completedOrders.length} órdenes completadas...`);
  
  // Para cada orden completada, generar una factura
  for (const order of completedOrders) {
    // Calcular subtotal (precio sin impuestos)
    const subtotal = order.price / 1.16; // Asumiendo IVA del 16%
    const tax = order.price - subtotal;
    
    // Generar número de factura único
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
    
    const invoiceData = {
      order_id: order.id,
      invoice_number: invoiceNumber,
      subtotal: parseFloat(subtotal.toFixed(2)),
      tax: parseFloat(tax.toFixed(2)),
      total: order.price,
      issued_at: new Date().toISOString(),
      paid_at: new Date().toISOString(), // Asumiendo que todas están pagadas
      payment_method: 'Transferencia'
    };
    
    const { data, error } = await supabase
      .from('invoices')
      .insert(invoiceData);
      
    if (error) console.error(`Error al generar factura para orden ${order.id}:`, error.message);
  }
  
  console.log('Generación de facturas completada');
}

// Función para ejecutar la migración
function runMigration() {
  // Verificar que se haya cargado la librería de Supabase
  if (typeof supabase === 'undefined') {
    console.error('Error: La librería de Supabase no está cargada');
    return;
  }
  
  // Confirmar con el usuario
  if (confirm('¿Estás seguro de que deseas migrar todos los datos a Supabase? Esta operación no se puede deshacer.')) {
    migrateDataToSupabase();
  }
}

// Exportar funciones para uso en la consola del navegador
window.tlcMigration = {
  runMigration,
  migrateDataToSupabase,
  migrateVehicles,
  migrateServices,
  migrateUsers,
  migrateOrders,
  generatePerformanceData,
  generateInvoices
};

console.log('Script de migración cargado. Ejecuta window.tlcMigration.runMigration() para iniciar la migración.');