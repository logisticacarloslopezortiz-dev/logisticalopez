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
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get('authorization') || '';
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
    const role = 'administrador';

    // Verificar existencia
    const { data: existing, error: findErr } = await admin
      .from('collaborators')
      .select('id, role')
      .eq('id', userId)
      .limit(1);

    if (findErr) return jsonResponse({ error: findErr.message }, 400);

    if (!existing || existing.length === 0) {
      const { error: insErr } = await admin
        .from('collaborators')
        .insert({ id: userId, email, name, phone, role, status: 'Activo' });
      if (insErr) return jsonResponse({ error: insErr.message }, 400);
      return jsonResponse({ created: true, id: userId, role }, 200);
    }

    return jsonResponse({ created: false, id: existing[0].id, role: existing[0].role }, 200);
  } catch (e) {
    const msg = e?.message || 'Fallo inesperado';
    return jsonResponse({ error: msg }, 400);
  }
});