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

    // Buscar binding existente
    const { data: existing, error: fetchErr } = await admin
      .from('device_bindings')
      .select('*')
      .eq('device_id', device_id)
      .limit(1);
    if (fetchErr) return errorResponse(fetchErr.message, 500);

    const now = new Date().toISOString();
    if (existing && existing.length > 0) {
      const binding = existing[0];
      if (binding.user_id !== user.id) {
        // Dispositivo ya vinculado a otro usuario
        return jsonResponse({ error: 'device_bound', bound_user_id: binding.user_id }, 409);
      }
      // Actualizar last_seen
      const { error: updErr } = await admin
        .from('device_bindings')
        .update({ last_seen: now })
        .eq('id', binding.id);
      if (updErr) return errorResponse(updErr.message, 500);
      return jsonResponse({ success: true, status: 'already_bound' }, 200);
    }

    // Crear nuevo binding
    const { error: insErr } = await admin
      .from('device_bindings')
      .insert({ device_id, user_id: user.id, bound_at: now, last_seen: now });
    if (insErr) return errorResponse(insErr.message, 500);

    return jsonResponse({ success: true, status: 'bound' }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error';
    return errorResponse(msg, 500);
  }
});