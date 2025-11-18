import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponse } from '../cors-config.ts';

Deno.serve(async (req: Request) => {
  // Primero, maneja la solicitud pre-vuelo de CORS si es necesario.
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // Solo se permite el método POST para esta función.
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method not allowed' }, 405, req);
    }

    // Asegura que las variables de entorno de Supabase estén disponibles.
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Error: Faltan las variables de entorno de Supabase.');
      return jsonResponse({ success: false, error: 'Server configuration error' }, 500, req);
    }

    // Crea un cliente de Supabase con privilegios de administrador.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Extrae el `userId` del cuerpo de la solicitud.
    const body = await req.json().catch(() => ({}));
    const userId: string = body?.userId;
    if (!userId || typeof userId !== 'string') {
      return jsonResponse({ success: false, error: 'User ID is required' }, 400, req);
    }

    // Llama a la función RPC `increment_completed_jobs` en la base de datos.
    console.log(`[increment-completed-jobs] Intentando para userId: ${userId}`);
    const { error } = await admin.rpc('increment_completed_jobs', { user_id: userId });

    // Si la llamada a RPC falla, registra el error y devuelve una respuesta 500.
    if (error) {
      console.error(`[increment-completed-jobs] Error en RPC para userId: ${userId}`, error);
      return jsonResponse({ success: false, error: error.message }, 500, req);
    }

    // Si la operación es exitosa, devuelve una respuesta 200.
    return jsonResponse({ success: true, message: 'Completed jobs incremented successfully' }, 200, req);

  } catch (e) {
    // Captura cualquier otro error, lo registra y devuelve una respuesta 500.
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[increment-completed-jobs] Error inesperado:', message);
    return jsonResponse({ success: false, error: message }, 500, req);
  }
});
