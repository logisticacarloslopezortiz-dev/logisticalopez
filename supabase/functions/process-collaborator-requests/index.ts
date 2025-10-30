/// <reference path="../globals.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../cors-config.ts'

// Helper to stringify unknown errors safely (avoids using `any` casts)
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  try {
    // Validate request method
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

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

    // Parse and validate request body
    let requestBody
    try {
      requestBody = await req.json()
    } catch (_e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }

    const { action, requestId, collaboratorData } = requestBody

    // Validate required fields based on action
    if (action === 'create_collaborator') {
      if (!collaboratorData?.email || !collaboratorData?.password || !collaboratorData?.name) {
        return jsonResponse({ 
          error: 'Missing required fields',
          details: 'Email, password and name are required'
        }, 400)
      }
    }

    switch (action) {
      case 'create_collaborator':
        try {
          // Create auth user
          let authUser: { user: { id: string } } | null = null
          const { data: _authUserData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: collaboratorData.email,
            password: collaboratorData.password,
            email_confirm: true,
            user_metadata: {
              role: 'colaborador',
              name: collaboratorData.name,
              matricula: collaboratorData.matricula
            }
          })

          // If createUser succeeded, _authUserData contains the user
          if (!authError && _authUserData) {
            authUser = _authUserData
          }

          // If createUser failed because the user already exists, try to fetch that user
          if (authError) {
            console.error('Auth error creating user:', authError)
            const authMsg = errMsg(authError)
            if (/already/i.test(authMsg) || authMsg.includes('already been registered') || authMsg.includes('already exists')) {
              try {
                // Try to retrieve existing user by email using admin API
                const { data: existingUserData, error: getErr } = await supabaseAdmin.auth.admin.getUserByEmail(collaboratorData.email)
                if (getErr) {
                  console.error('Error fetching existing user by email:', getErr)
                  return jsonResponse({ error: 'Failed to create auth user', details: authMsg }, 400)
                }
                const existingUser = (existingUserData && (existingUserData.user || existingUserData)) || null
                if (!existingUser || !existingUser.id) {
                  return jsonResponse({ error: 'Failed to create auth user', details: authMsg }, 400)
                }

                // Ensure a public profile row exists for this user
                try {
                  await supabaseAdmin.from('profiles').upsert({
                    id: existingUser.id,
                    full_name: collaboratorData.name,
                    email: collaboratorData.email,
                    created_at: new Date().toISOString()
                  }, { onConflict: 'id' })
                } catch (upsertErr) {
                  console.warn('Could not upsert profile for existing auth user:', errMsg(upsertErr))
                }

                // Reuse the existing user id for collaborator creation
                authUser = { user: { id: existingUser.id } }
              } catch (e) {
                console.error('Failed to handle existing auth user:', e)
                return jsonResponse({ error: 'Failed to create auth user', details: authMsg }, 400)
              }
            } else {
              return jsonResponse({ error: 'Failed to create auth user', details: authMsg }, 400)
            }
          }

          // Ensure we have an auth user id to associate
          if (!authUser || !authUser.user || !authUser.user.id) {
            console.error('No auth user available to create collaborator profile')
            return jsonResponse({ error: 'Missing auth user', details: 'Auth user id is required' }, 500)
          }

          // Create collaborator profile
          const { error: profileError } = await supabaseAdmin
            .from('collaborators')
            .insert({
              id: authUser.user.id,
              email: collaboratorData.email,
              role: 'colaborador', // Force role to colaborador
              name: collaboratorData.name,
              matricula: collaboratorData.matricula || null,
              status: 'activo',
              created_at: new Date().toISOString()
            })

          if (profileError) {
            // If profile creation fails, try to delete the auth user
            try {
              await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
            } catch (cleanupError) {
              console.error('Failed to cleanup auth user after profile creation failed:', errMsg(cleanupError))
            }

            console.error('Profile error:', errMsg(profileError))
            return jsonResponse({ error: 'Failed to create collaborator profile', details: errMsg(profileError) }, 400)
          }

          // Optional: update request status if table exists
          if (requestId) {
            try {
              await supabaseAdmin
                .from('collaborator_requests')
                .update({ 
                  status: 'approved',
                  processed_at: new Date().toISOString(),
                  processed_by: collaboratorData.processed_by || authUser.user.id
                })
                .eq('id', requestId)
            } catch (requestError) {
              // Log but don't fail if request update fails
              console.warn('Failed to update request status:', requestError)
            }
          }

          return jsonResponse({ 
            success: true, 
            message: 'Colaborador creado exitosamente',
            collaborator_id: authUser.user.id
          }, 200)
        } catch (error) {
          console.error('Unexpected error in create_collaborator:', error)
          const _msg = error instanceof Error ? error.message : String(error)
          return jsonResponse({ 
            error: 'Internal server error',
            details: _msg
          }, 500)
        }

      case 'reject_request':
        if (!requestId) {
          return jsonResponse({ 
            error: 'Missing required fields',
            details: 'Request ID is required for rejection'
          }, 400)
        }

        try {
          const { error: rejectError } = await supabaseAdmin
            .from('collaborator_requests')
            .update({ 
              status: 'rejected',
              processed_at: new Date().toISOString(),
              processed_by: collaboratorData?.processed_by,
              rejection_reason: collaboratorData?.rejection_reason
            })
            .eq('id', requestId)

          if (rejectError) {
            return jsonResponse({ error: 'Failed to reject request', details: errMsg(rejectError) }, 400)
          }

          return jsonResponse({ 
            success: true, 
            message: 'Solicitud rechazada exitosamente'
          }, 200)
        } catch (error) {
          console.error('Error in reject_request:', error)
          const _msg = error instanceof Error ? error.message : String(error)
          return jsonResponse({ 
            error: 'Failed to process rejection',
            details: _msg 
          }, 500)
        }

      default:
        return jsonResponse({ 
          error: 'Invalid action',
          details: `Action '${action}' not supported`
        }, 400)
    }

  } catch (error) {
    console.error('Fatal error in process-collaborator-requests:', error)
    const _msg = error instanceof Error ? error.message : String(error)
    return jsonResponse({ 
      error: 'Internal server error',
      details: _msg || 'Unexpected error occurred'
    }, 500)
  }
})