import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const body = await req.json();
    const { user_id, email, password, name, matricula, phone } = body || {};

    if (!user_id) {
      return jsonResponse({ error: 'Falta user_id' }, 400);
    }

    // 1) Actualizar credenciales en Auth (email/password) y metadata
    logDebug('Actualizando usuario en Auth', { user_id, email: !!email, password: !!password });
    const { error: authErr } = await admin.auth.admin.updateUserById(user_id, {
      email: email ?? undefined,
      password: password ?? undefined,
      user_metadata: {
        full_name: name ?? undefined,
        phone: phone ?? undefined,
        matricula: matricula ?? undefined,
      },
    });
    if (authErr) return jsonResponse({ error: authErr.message }, 400);

    // 2) Actualizar collaborators (sin campo 'role' para evitar 42703)
    const updateCollab: any = {};
    if (email !== undefined) updateCollab.email = email;
    if (name !== undefined) updateCollab.name = name;
    if (phone !== undefined) updateCollab.phone = phone;
    if (matricula !== undefined) updateCollab.matricula = matricula;

    if (Object.keys(updateCollab).length > 0) {
      const { error: collabErr } = await admin.from('collaborators').update(updateCollab).eq('id', user_id);
      if (collabErr) return jsonResponse({ error: collabErr.message }, 400);
    }

    // 3) Actualizar profiles (sin campo 'role' para coherencia con esquema)
    const updateProfile: any = {};
    if (email !== undefined) updateProfile.email = email;
    if (name !== undefined) updateProfile.full_name = name;
    if (phone !== undefined) updateProfile.phone = phone;
    if (Object.keys(updateProfile).length > 0) {
      updateProfile.updated_at = new Date().toISOString();
      const { error: profErr } = await admin.from('profiles').update(updateProfile).eq('id', user_id);
      if (profErr) return jsonResponse({ error: profErr.message }, 400);
    }

    // 4) Upsert matrícula
    if (matricula !== undefined) {
      const { error: matErr } = await admin
        .from('matriculas')
        .upsert({ user_id, matricula, status: 'activo', created_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (matErr) return jsonResponse({ error: matErr.message }, 400);
    }

    return jsonResponse({ success: true }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fallo inesperado';
    logDebug('Error inesperado', e);
    return jsonResponse({ error: msg }, 500);
  }
});