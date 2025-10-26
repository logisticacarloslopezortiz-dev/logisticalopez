import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with Service Role key for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { action, requestId, collaboratorData } = await req.json()

    switch (action) {
      case 'create_collaborator':
        // Create new collaborator account
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: collaboratorData.email,
          password: collaboratorData.password,
          email_confirm: true,
          user_metadata: {
            role: 'colaborador',
            name: collaboratorData.name,
            matricula: collaboratorData.matricula
          }
        })

        if (authError) {
          throw new Error(`Error creating auth user: ${authError.message}`)
        }

        // Create collaborator profile
        const { error: profileError } = await supabaseAdmin
          .from('collaborators')
          .insert({
            id: authUser.user.id,
            email: collaboratorData.email,
            role: collaboratorData.role || 'colaborador',
            name: collaboratorData.name,
            matricula: collaboratorData.matricula,
            status: collaboratorData.status || 'activo',
            created_at: new Date().toISOString()
          })

        if (profileError) {
          throw new Error(`Error creating collaborator: ${profileError.message}`)
        }

        // Update the request status to 'approved'
        if (requestId) {
          await supabaseAdmin
            .from('collaborator_requests')
            .update({ 
              status: 'approved',
              processed_at: new Date().toISOString(),
              processed_by: collaboratorData.processed_by
            })
            .eq('id', requestId)
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Colaborador creado exitosamente',
            collaborator_id: authUser.user.id
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )

      case 'reject_request':
        // Update the request status to 'rejected'
        const { error: rejectError } = await supabaseAdmin
          .from('collaborator_requests')
          .update({ 
            status: 'rejected',
            processed_at: new Date().toISOString(),
            processed_by: collaboratorData.processed_by,
            rejection_reason: collaboratorData.rejection_reason
          })
          .eq('id', requestId)

        if (rejectError) {
          throw new Error(`Error rejecting request: ${rejectError.message}`)
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Solicitud rechazada exitosamente'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )

      default:
        return new Response(
          JSON.stringify({ error: 'Acción no válida' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        )
    }

  } catch (error) {
    console.error('Error in process-collaborator-requests:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Error interno del servidor'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})