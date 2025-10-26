import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS igual al patrón de delete-user
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const body = await req.json();
    const { email, password, name, phone, role = 'Colaborador' } = body || {};

    if (!email || !password || !name) {
      return jsonResponse({ error: 'Faltan campos requeridos: email, password, name' }, 400);
    }

    // Crear usuario en Auth
    const { data: userRes, error: signUpError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, phone, role }
    });

    if (signUpError) return jsonResponse({ error: signUpError.message }, 400);

    const user = userRes.user;

    // Insertar perfil en collaborators (si no existe)
    const { data: existing, error: findErr } = await admin
      .from('collaborators')
      .select('id')
      .eq('id', user.id)
      .limit(1);

    if (findErr) return jsonResponse({ error: findErr.message }, 400);

    if (!existing || existing.length === 0) {
      const { error: insErr } = await admin
        .from('collaborators')
        .insert({ id: user.id, email, name, phone, role, status: 'Activo' });

      if (insErr) return jsonResponse({ error: insErr.message }, 400);
    }

    return jsonResponse({ message: 'Colaborador creado', user_id: user.id }, 200);
  } catch (e) {
    const msg = e?.message || 'Fallo inesperado';
    return jsonResponse({ error: msg }, 400);
  }
});