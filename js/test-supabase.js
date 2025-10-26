// Script para verificar la conexión y funciones de Supabase
console.log('Iniciando prueba de Supabase...');

// Verificar que supabaseConfig esté disponible
if (typeof supabaseConfig === 'undefined') {
  console.error('Error: supabaseConfig no está definido');
} else {
  console.log('✅ supabaseConfig está disponible');
  
  // Verificar que el cliente de Supabase esté inicializado
  if (supabaseConfig.client) {
    console.log('✅ Cliente de Supabase inicializado correctamente');
    
    // Probar conexión con una consulta simple
    testSupabaseConnection();
  } else {
    console.error('❌ Error: Cliente de Supabase no inicializado');
  }
}

// Función para probar la conexión a Supabase
async function testSupabaseConnection() {
  try {
    // Probar la conexión con una consulta simple a la tabla services
    const { data, error } = await supabaseConfig.client.from('services').select('count').limit(1);
    
    if (error) {
      console.error('❌ Error de conexión a Supabase:', error.message);
    } else {
      console.log('✅ Conexión a Supabase exitosa');
      
      // Probar funciones de acceso a datos
      await testDataAccessFunctions();
    }
  } catch (err) {
    console.error('❌ Error al probar la conexión:', err.message);
  }
}

// Función para probar las funciones de acceso a datos
async function testDataAccessFunctions() {
  try {
    // Probar getServices
    console.log('Probando getServices()...');
    const services = await supabaseConfig.getServices();
    console.log(`✅ getServices() funcionando: ${services.length} servicios encontrados`);
    
    // Probar getVehicles
    console.log('Probando getVehicles()...');
    const vehicles = await supabaseConfig.getVehicles();
    console.log(`✅ getVehicles() funcionando: ${vehicles.length} vehículos encontrados`);
    
    // Probar getOrders si hay alguna orden en la base de datos
    console.log('Probando getOrders()...');
    const orders = await supabaseConfig.getOrders();
    console.log(`✅ getOrders() funcionando: ${orders.length} órdenes encontradas`);
    
    console.log('✅ Todas las pruebas completadas exitosamente');
  } catch (err) {
    console.error('❌ Error al probar funciones de acceso a datos:', err.message);
  }
}