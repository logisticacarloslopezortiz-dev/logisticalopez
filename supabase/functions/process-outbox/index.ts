/// <reference path="../globals.d.ts" />

import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Task {
  id: number
  event_type: string
  recipient_id: string | null
  recipient_contact_id: string | null
  recipient_type: 'client' | 'collaborator' | 'admin'
  payload: {
    [key: string]: any
    new_status?: string
    old_status?: string
    order_id?: number
    id?: number
  }
  template_data: {
    title: string
    body: string
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`
const SITE_BASE = Deno.env.get('PUBLIC_SITE_URL') || 'https://logisticalopezortiz.com'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

Deno.serve(async (req: Request) => {
  // 1. Manejar la solicitud CORS (preflight)
  const corsResponse = handleCors(req)
  if (corsResponse) {
    return corsResponse
  }

  console.log('--- Iniciando process-outbox ---')

  try {
    // 2. Reclamar tareas de la cola de notificaciones
    const { data: tasks, error: claimError } = await supabase.rpc('claim_notification_outbox', {
      p_batch_size: 25,
    })

    if (claimError) {
      console.error('Error reclamando tareas:', claimError)
      return jsonResponse({ success: false, error: 'claim_failed', details: claimError.message }, 500)
    }

    if (!tasks || tasks.length === 0) {
      console.log('No hay tareas para procesar.')
      return jsonResponse({ success: true, message: 'No tasks to process.', processed: [] }, 200)
    }

    console.log(`Procesando ${tasks.length} tareas...`)

    // 3. Procesar cada tarea en paralelo
    const results = await Promise.all(
      (tasks as Task[]).map(async (task) => {
        try {
          // 3.1. Encontrar el ID de OneSignal del destinatario
          let onesignalId: string | null = null
          if (task.recipient_id) {
            const { data: profile } = await supabase
              .from('collaborators')
              .select('onesignal_id')
              .eq('id', task.recipient_id)
              .maybeSingle()
            onesignalId = profile?.onesignal_id || null
          } else if (task.recipient_contact_id) {
            const { data: client } = await supabase
              .from('clients')
              .select('onesignal_id')
              .eq('id', task.recipient_contact_id)
              .maybeSingle()
            onesignalId = client?.onesignal_id || null
          }

          if (!onesignalId) {
            throw new Error(`No se encontró OneSignal ID para el destinatario ${task.recipient_id || task.recipient_contact_id}`)
          }

          // 3.2. Preparar el mensaje usando la plantilla
          const orderId = task.payload?.order_id || task.payload?.id || ''
          const title = task.template_data.title.replace(/{{id}}/g, String(orderId))
          const body = task.template_data.body.replace(/{{id}}/g, String(orderId))
          const url = `${SITE_BASE}/${task.recipient_type === 'client' ? 'seguimiento.html' : 'inicio.html'}`

          // 3.3. Enviar la notificación llamando a la función dedicada
          const pushResponse = await fetch(`${FUNCTIONS_BASE}/send-onesignal-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_ROLE}`,
            },
            body: JSON.stringify({ player_ids: [onesignalId], title, message: body, url, data: { orderId } }),
          })

          if (!pushResponse.ok) {
            const errorBody = await pushResponse.text()
            throw new Error(`Fallo al enviar push: ${pushResponse.status} ${errorBody}`)
          }

          // 4. Marcar la tarea como enviada
          await supabase.rpc('mark_notification_sent', { p_id: task.id })
          return { id: task.id, status: 'sent' }
        } catch (err) {
          // 5. Marcar la tarea como fallida
          console.error(`Fallo al procesar tarea ${task.id}:`, err.message)
          await supabase.rpc('mark_notification_failed', { p_id: task.id, p_error: err.message })
          return { id: task.id, status: 'failed', error: err.message }
        }
      })
    )

    console.log('--- Fin process-outbox ---')
    return jsonResponse({ success: true, processed: results }, 200)
  } catch (e) {
    console.error('Error crítico en process-outbox:', e)
    return jsonResponse({ success: false, error: e.message }, 500)
  }
})