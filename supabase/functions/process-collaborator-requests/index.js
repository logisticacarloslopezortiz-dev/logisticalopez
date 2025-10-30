// Función Edge para procesar solicitudes de colaboradores
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejo de preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Crear cliente de Supabase con la clave de servicio
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Obtener datos del cuerpo de la solicitud
    const { action, collaboratorData } = await req.json()

    // Validar la acción
    if (action !== 'create_collaborator') {
      return new Response(
        JSON.stringify({ success: false, error: 'Acción no válida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Validar datos del colaborador
    if (!collaboratorData || !collaboratorData.email || !collaboratorData.password || !collaboratorData.name) {
      return new Response(
        JSON.stringify({ success: false, error: 'Datos de colaborador incompletos' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // 1. Crear usuario en Auth
    const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
      email: collaboratorData.email,
      password: collaboratorData.password,
      email_confirm: true
    })

    if (authError) {
      console.error('Error al crear usuario en Auth:', authError)
      return new Response(
        JSON.stringify({ success: false, error: authError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const userId = authData.user.id

    // 2. Crear perfil en profiles
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .insert({
        id: userId,
        full_name: collaboratorData.name,
        email: collaboratorData.email,
        phone: collaboratorData.phone || ''
      })

    if (profileError) {
      console.error('Error al crear perfil:', profileError)
      // Intentar eliminar el usuario creado para evitar inconsistencias
      await supabaseClient.auth.admin.deleteUser(userId)
      return new Response(
        JSON.stringify({ success: false, error: 'Error al crear perfil: ' + profileError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // 3. Crear colaborador en collaborators
    const { error: collabError } = await supabaseClient
      .from('collaborators')
      .insert({
        id: userId,
        name: collaboratorData.name,
        email: collaboratorData.email,
        phone: collaboratorData.phone || '',
        matricula: collaboratorData.matricula || null,
        status: 'activo',
        role: 'colaborador'
      })

    if (collabError) {
      console.error('Error al crear colaborador:', collabError)
      // No eliminamos el usuario/perfil ya que podría ser un error temporal
      return new Response(
        JSON.stringify({ success: false, error: 'Error al crear colaborador: ' + collabError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // 4. Si hay matrícula, registrarla
    if (collaboratorData.matricula) {
      const { error: matriculaError } = await supabaseClient
        .from('matriculas')
        .insert({
          user_id: userId,
          matricula: collaboratorData.matricula,
          status: 'activo'
        })

      if (matriculaError) {
        console.error('Error al registrar matrícula:', matriculaError)
        // No es un error crítico, continuamos
      }
    }

    // Éxito
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Colaborador creado exitosamente',
        data: {
          id: userId,
          name: collaboratorData.name,
          email: collaboratorData.email
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error en la función Edge:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Error interno del servidor: ' + error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})