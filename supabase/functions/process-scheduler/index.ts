import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
console.log('Process Scheduler booting...')
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('❌ Missing environment variables')
    return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500 })
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
          'Authorization': `Bearer ${SERVICE_ROLE}`
        }
      }
    )
    const body = await response.text()
    console.log('✅ Status:', response.status)
    console.log('📦 Body:', body)
    return new Response(JSON.stringify({ ok: response.ok, status: response.status, body }), { status: 200 })
  } catch (err) {
    console.error('🔥 Scheduler error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
