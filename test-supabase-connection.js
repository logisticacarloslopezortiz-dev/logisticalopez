// test-supabase-connection.js
// Script para probar la conexión a Supabase y verificar órdenes

document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== TEST SUPABASE CONNECTION ===');

  try {
    // Verificar configuración
    if (!window.supabaseConfig || !supabaseConfig.client) {
      throw new Error('Supabase client not configured');
    }
    console.log('✅ Supabase client configured');

    // Verificar sesión
    const { data: sessionData, error: sessionError } = await supabaseConfig.client.auth.getSession();
    console.log('Session data:', sessionData);
    console.log('Session error:', sessionError);

    if (!sessionData?.session) {
      console.warn('❌ No active session');
      return;
    }
    console.log('✅ Session active, user:', sessionData.session.user.id);

    // Probar acceso a tabla orders
    const { data: orders, error: ordersError } = await supabaseConfig.client
      .from('orders')
      .select('id,status,assigned_to')
      .limit(5);

    console.log('Orders query result:', { orders, ordersError });

    if (ordersError) {
      console.error('❌ Cannot access orders table:', ordersError);
    } else {
      console.log('✅ Orders table accessible, found', orders?.length || 0, 'orders');
      console.log('Sample orders:', orders);
    }

    // Probar acceso a tabla collaborators
    const { data: collab, error: collabError } = await supabaseConfig.client
      .from('collaborators')
      .select('id,name,status')
      .eq('id', sessionData.session.user.id)
      .maybeSingle();

    console.log('Collaborator query result:', { collab, collabError });

    if (collabError) {
      console.error('❌ Cannot access collaborators table:', collabError);
    } else {
      console.log('✅ Collaborator data:', collab);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }

  console.log('=== END TEST ===');
});