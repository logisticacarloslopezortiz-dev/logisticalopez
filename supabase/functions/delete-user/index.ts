/// <reference path="../globals.d.ts" />
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts'

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  try {
    const body = await req.json()
    let userId: string = (body?.userId || '').toString()
    const email: string = (body?.email || '').toString().toLowerCase().trim()
    if (!userId && !email) {
      return jsonResponse({ error: 'Se requiere userId o email para eliminar al usuario.' }, 400)
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
      if (pErr) return jsonResponse({ error: `Fallo al buscar perfil: ${pErr.message}` }, 400)
      if (!profile) return jsonResponse({ error: 'No se encontró perfil para ese email' }, 404)
      userId = profile.id
    }

    // Eliminar el usuario del sistema de autenticación
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId)
    if (authError && authError.message !== 'User not found') {
      return jsonResponse({ error: authError.message }, 400)
    }

    // Eliminar registros relacionados (best-effort)
    const { error: profErr } = await adminClient.from('profiles').delete().eq('id', userId)
    const { error: collabErr } = await adminClient.from('collaborators').delete().eq('id', userId)
    const { error: ordersErr } = await adminClient.from('orders').update({ assigned_to: null }).eq('assigned_to', userId)

    return jsonResponse({ message: `Usuario ${userId} eliminado.`, details: { profiles: profErr?.message, collaborators: collabErr?.message, orders: ordersErr?.message } }, 200)
  } catch (error) {
    const message = (error as Error)?.message || 'Error desconocido'
    return jsonResponse({ error: message }, 400)
  }
})
