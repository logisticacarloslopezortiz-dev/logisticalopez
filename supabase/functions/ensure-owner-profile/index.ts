/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: 'Error de configuración del servidor' }, 500);
    }

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.substring(7);
    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }

    const user = userData.user;
    const userId = user.id;
    const email = user.email || (user.user_metadata?.email as string) || '';
    const name = (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || (email?.split('@')[0] || 'Dueño');
    const phone = (user.user_metadata?.phone as string) || '';
    // Sin roles: el dueño se define en public.business.owner_user_id

    // Verificar existencia
    const { data: existing, error: findErr } = await admin
      .from('collaborators')
      .select('id')
      .eq('id', userId)
      .limit(1);

    if (findErr) return jsonResponse({ error: findErr.message }, 400);

    if (!existing || existing.length === 0) {
      const { error: insErr } = await admin
        .from('collaborators')
        .insert({ id: userId, email, name, phone, status: 'activo', role: 'administrador' });
      if (insErr) return jsonResponse({ error: insErr.message }, 400);
    }

    // Asegurar perfil en profiles
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .limit(1);

    if (profErr) return jsonResponse({ error: profErr.message }, 400);
    if (!prof || prof.length === 0) {
      const { error: insProfErr } = await admin
        .from('profiles')
        .insert({ id: userId, email, full_name: name, phone, role: 'administrador' });
      if (insProfErr) return jsonResponse({ error: insProfErr.message }, 400);
    }

    // Vincular dueño en la configuración del negocio
    const { error: upsertBizErr } = await admin
      .from('business')
      .upsert({ id: 1, owner_user_id: userId }, { onConflict: 'id' });
    if (upsertBizErr) return jsonResponse({ error: upsertBizErr.message }, 400);

    return jsonResponse({ created: false, id: userId, owner_set: true }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fallo inesperado';
    return jsonResponse({ error: msg }, 400);
  }
});