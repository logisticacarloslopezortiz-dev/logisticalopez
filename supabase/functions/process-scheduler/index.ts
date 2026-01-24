import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

console.log('Job Scheduler invoked')

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const INTERNAL_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET')

  if (!SUPABASE_URL || !INTERNAL_SECRET) {
    console.error('Missing environment variables')
    return new Response(
      JSON.stringify({ error: 'Configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    console.log('Invoking process-outbox...')
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/process-outbox?limit=50`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': INTERNAL_SECRET
        }
      }
    )
    
    // Read the response regardless of status
    const data = await response.json().catch(() => ({}))
    console.log('process-outbox response:', response.status, data)

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
      status: response.status
    })
  } catch (error: any) {
    console.error('Scheduler error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
