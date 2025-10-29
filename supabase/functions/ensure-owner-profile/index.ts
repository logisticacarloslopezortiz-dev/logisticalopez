import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cargar variables de entorno evitando el prefijo prohibido "SUPABASE_" en funciones
const SUPABASE_URL = Deno.env.get('EDGE_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('EDGE_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('EDGE_SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

Deno.serve(async (req) => {
  // Manejar la solicitud preflight de CORS
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // 1. Validar el token JWT del usuario
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Falta el token de autorización' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');

    // Crear un cliente de Supabase para obtener el usuario a partir del token
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: 'Token inválido o expirado' }, 401);
    }

    // 2. Crear un cliente de Supabase con rol de servicio para operar en la base de datos
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // 3. Verificar si ya existe un perfil en 'collaborators'
    const { data: existingCollaborator, error: selectError } = await supabaseAdmin
      .from('collaborators')
      .select('id')
      .eq('id', user.id)
      .single();

    // Si ya existe o hay un error que no sea "no encontrado", no hacer nada
    if (existingCollaborator || (selectError && selectError.code !== 'PGRST116')) {
      return jsonResponse({ success: true, message: 'El perfil del colaborador ya existe.' });
    }

    // 4. Si no existe, crearlo con rol de 'administrador'
    const { error: insertError } = await supabaseAdmin.from('collaborators').insert({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Admin',
      role: 'administrador',
      status: 'activo',
    });

    if (insertError) throw insertError;

    return jsonResponse({ success: true, message: 'Perfil de administrador creado y sincronizado.' });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});