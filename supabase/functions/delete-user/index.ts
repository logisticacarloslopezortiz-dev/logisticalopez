import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Headers para permitir CORS desde tu aplicación web
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Manejar la solicitud de pre-vuelo (preflight) de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId } = await req.json()
    if (!userId) {
      throw new Error("Se requiere el ID del usuario (userId).")
    }

    // Crear un cliente de Supabase con permisos de administrador
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Eliminar el usuario del sistema de autenticación
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId)

    if (authError) {
      // Si el usuario ya no existe en auth, no lo consideramos un error fatal
      if (authError.message !== 'User not found') {
        throw authError
      }
    }

    return new Response(JSON.stringify({ message: `Usuario ${userId} eliminado del sistema de autenticación.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
