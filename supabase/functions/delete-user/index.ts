// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Headers para permitir CORS desde tu aplicación web
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Manejar la solicitud de pre-vuelo (preflight) de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    let userId: string = (body?.userId || '').toString()
    const email: string = (body?.email || '').toString().toLowerCase().trim()
    if (!userId && !email) {
      throw new Error('Se requiere userId o email para eliminar al usuario.')
    }

    // Crear un cliente de Supabase con permisos de administrador
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Resolver ID por email si es necesario
    if (!userId && email) {
      const { data: profile, error: pErr } = await adminClient
        .from('profiles')
        .select('id,email')
        .eq('email', email)
        .maybeSingle()
      if (pErr) throw new Error(`Fallo al buscar perfil: ${pErr.message}`)
      if (!profile) throw new Error('No se encontró perfil para ese email')
      userId = profile.id
    }

    // Eliminar el usuario del sistema de autenticación
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId)
    if (authError && authError.message !== 'User not found') {
      throw authError
    }

    // Eliminar registros relacionados (best-effort)
    const { error: profErr } = await adminClient.from('profiles').delete().eq('id', userId)
    const { error: collabErr } = await adminClient.from('collaborators').delete().eq('id', userId)
    const { error: ordersErr } = await adminClient.from('orders').update({ assigned_to: null }).eq('assigned_to', userId)

    return new Response(
      JSON.stringify({ message: `Usuario ${userId} eliminado.`, details: { profiles: profErr?.message, collaborators: collabErr?.message, orders: ordersErr?.message } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
