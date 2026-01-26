import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

console.log('Process Scheduler booting...')

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const INTERNAL_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET')

  if (!SUPABASE_URL || !INTERNAL_SECRET) {
    console.error('❌ Missing environment variables')
    return new Response(JSON.stringify({ error: 'Configuration error' }), { status: 500 })
  }

  try {
    console.log('🚀 Invoking process-outbox...')

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 15000)

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/process-outbox?limit=50`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': INTERNAL_SECRET
        }
      }
    )

    const data = await response.json().catch(() => ({}))

    console.log('✅ process-outbox status:', response.status)
    console.log('📦 response body:', data)

    return new Response(JSON.stringify({
      ok: response.ok,
      status: response.status,
      result: data
    }), { status: 200 })

  } catch (err: any) {
    console.error('🔥 Scheduler error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
