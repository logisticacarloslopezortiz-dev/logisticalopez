/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs detallados
function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

Deno.serve(async (req: Request) => {
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
    
    const { email, password, name, phone, matricula } = body || {};

    // Validar campos requeridos
    if (!email || !password || !name) {
      return jsonResponse({ error: 'Faltan campos requeridos: email, password, name' }, 400);
    }

    // Crear usuario en Auth
    logDebug('Creando usuario en Auth', { email, name });
    const { data: userRes, error: signUpError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, phone, matricula }
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

      // 1. Insertar primero en tabla profiles (evita violación de FK en collaborators)
      const { error: profileErr } = await admin
        .from('profiles')
        .insert({
          id: user.id,
          email,
          full_name: name,
          phone,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (profileErr) {
        logDebug('Error al insertar en profiles', profileErr);
        // Rollback: eliminar el usuario de Auth para no dejar cuentas colgando
        try { await admin.auth.admin.deleteUser(user.id); } catch (cleanupError) {
          logDebug('Fallo al limpiar usuario auth tras error de profiles', cleanupError);
        }
        return jsonResponse({ error: profileErr.message }, 400);
      }

      // 2. Insertar en tabla collaborators
      const { error: collabErr } = await admin
        .from('collaborators')
        .insert({ 
          id: user.id, 
          email, 
          name, 
          phone, 
          matricula,
          status: 'activo',
          created_at: new Date().toISOString()
        });

      if (collabErr) {
        logDebug('Error al insertar colaborador', collabErr);
        // Rollback: limpiar perfil y usuario auth
        try { await admin.from('profiles').delete().eq('id', user.id); } catch (cleanupError) {
          logDebug('Fallo al limpiar profiles tras error collaborators', cleanupError);
        }
        try { await admin.auth.admin.deleteUser(user.id); } catch (cleanupError) {
          logDebug('Fallo al limpiar usuario auth tras error collaborators', cleanupError);
        }
        return jsonResponse({ error: collabErr.message }, 400);
      }

      // 3. Insertar en tabla matriculas si se proporcionó
      if (matricula) {
        const { error: matriculaErr } = await admin
          .from('matriculas')
          .insert({
            user_id: user.id,
            matricula,
            status: 'activo',
            created_at: new Date().toISOString()
          });

        if (matriculaErr) {
          logDebug('Error al insertar en matriculas', matriculaErr);
          // Rollback: eliminar collaborator y profile y auth
          try { await admin.from('collaborators').delete().eq('id', user.id); } catch (cleanupError) {
            logDebug('Fallo al limpiar collaborators tras error matriculas', cleanupError);
          }
          try { await admin.from('profiles').delete().eq('id', user.id); } catch (cleanupError) {
            logDebug('Fallo al limpiar profiles tras error matriculas', cleanupError);
          }
          try { await admin.auth.admin.deleteUser(user.id); } catch (cleanupError) {
            logDebug('Fallo al limpiar usuario auth tras error matriculas', cleanupError);
          }
          return jsonResponse({ error: matriculaErr.message }, 400);
        }
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