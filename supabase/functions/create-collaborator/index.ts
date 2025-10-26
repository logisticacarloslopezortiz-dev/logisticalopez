import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs detallados
function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

Deno.serve(async (req) => {
  // Manejar solicitudes OPTIONS (preflight CORS)
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Obtener variables de entorno
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Verificar que las variables de entorno estén definidas
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      logDebug('Variables de entorno faltantes', { SUPABASE_URL: !!SUPABASE_URL, SUPABASE_SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE });
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500);
    }

    // Crear cliente de Supabase con rol de servicio para operaciones administrativas
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // Extraer datos del cuerpo de la solicitud
    const body = await req.json();
    logDebug('Datos recibidos', body);
    
    const { email, password, name, phone, role = 'Colaborador', matricula } = body || {};

    // Validar campos requeridos
    if (!email || !password || !name) {
      return jsonResponse({ error: 'Faltan campos requeridos: email, password, name' }, 400);
    }

    // Crear usuario en Auth
    logDebug('Creando usuario en Auth', { email, name, role });
    const { data: userRes, error: signUpError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone, role, matricula }
    });

    if (signUpError) {
      logDebug('Error al crear usuario en Auth', signUpError);
      return jsonResponse({ error: signUpError.message }, 400);
    }

    const user = userRes.user;
    logDebug('Usuario creado en Auth', { userId: user.id });

    // Insertar perfil en collaborators (si no existe)
    const { data: existing, error: findErr } = await admin
      .from('collaborators')
      .select('id')
      .eq('id', user.id)
      .limit(1);

    if (findErr) {
      logDebug('Error al buscar perfil existente', findErr);
      return jsonResponse({ error: findErr.message }, 400);
    }

    if (!existing || existing.length === 0) {
      logDebug('Creando perfil de colaborador', { userId: user.id });
      const { error: insErr } = await admin
        .from('collaborators')
        .insert({ 
          id: user.id, 
          email, 
          name, 
          phone, 
          role, 
          matricula,
          status: 'Activo',
          created_at: new Date().toISOString()
        });

      if (insErr) {
        logDebug('Error al insertar perfil de colaborador', insErr);
        return jsonResponse({ error: insErr.message }, 400);
      }
    }

    return jsonResponse({ 
      success: true,
      message: 'Colaborador creado exitosamente', 
      user_id: user.id 
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fallo inesperado';
    logDebug('Error inesperado', e);
    return jsonResponse({ error: msg }, 500);
  }
});