/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return errorResponse('config_error', 500);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) return errorResponse('missing_token', 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return errorResponse('invalid_token', 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const device_id: string = body?.device_id;
    if (!device_id || typeof device_id !== 'string') return errorResponse('missing_device_id', 400);

    // Obtener binding
    const { data: existing, error: fetchErr } = await admin
      .from('device_bindings')
      .select('id, user_id, device_id')
      .eq('device_id', device_id)
      .limit(1);
    if (fetchErr) return errorResponse(fetchErr.message, 500);
    const binding = existing && existing[0];
    if (!binding) return errorResponse('not_found', 404);

    // Verificar si es admin o dueño del binding
    let isAdmin = false;
    try {
      const { data: collab, error: collabErr } = await admin
        .from('collaborators')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (!collabErr && collab && (collab.role || '').toLowerCase() === 'administrador') {
        isAdmin = true;
      }
    } catch (_) {}

    if (!isAdmin && binding.user_id !== user.id) {
      return errorResponse('forbidden', 403);
    }

    // Eliminar binding
    const { error: delErr } = await admin
      .from('device_bindings')
      .delete()
      .eq('id', binding.id);
    if (delErr) return errorResponse(delErr.message, 500);

    return jsonResponse({ success: true }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error';
    return errorResponse(msg, 500);
  }
});