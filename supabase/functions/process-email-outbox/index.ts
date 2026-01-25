import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
interface EmailOutboxRow {
  id: string
  to_email: string
  subject: string
  html: string
  attempts: number
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = (Deno.env.get('RESEND_API_KEY') || '').trim()
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  throw new Error('supabase_config_error')
}
if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY not configured')
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v ?? '').trim())
async function handleEmail(email: EmailOutboxRow): Promise<boolean> {
  try {
    const to = String(email.to_email || '').trim()
    const subject = String(email.subject || '').trim()
    const html = String(email.html || '').trim()
    if (!to || !isValidEmail(to) || !subject || !html) {
      throw new Error('invalid_email_payload')
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        from: 'Logística López Ortiz <facturacion@logisticalopezortiz.com>',
        to: [to],
        subject,
        html,
        reply_to: ['no-reply@logisticalopezortiz.com']
      })
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      throw new Error(`resend_api_error:${r.status}:${JSON.stringify(j)}`)
    }
    if (!j?.id) {
      throw new Error('no_message_id_from_resend')
    }
    await supabase
      .from('email_outbox')
      .update({
        status: 'sent',
        attempts: email.attempts + 1,
        processed_at: new Date().toISOString()
      })
      .eq('id', email.id)
    return true
  } catch (err: any) {
    const nextStatus = email.attempts >= 5 ? 'failed' : 'retry'
    const errorMsg = String(err?.message || err).slice(0, 300)
    await supabase
      .from('email_outbox')
      .update({
        status: nextStatus,
        attempts: email.attempts + 1,
        last_error: errorMsg,
        failed_reason: nextStatus === 'failed' ? errorMsg : null,
        failed_at: nextStatus === 'failed' ? new Date().toISOString() : null,
        processed_at: nextStatus === 'failed' ? new Date().toISOString() : null
      })
      .eq('id', email.id)
    return false
  }
}
async function processPendingEmails(limit = 10) {
  const { data, error } = await supabase.rpc('claim_email_outbox', { p_limit: limit })
  if (error) throw error
  if (!data?.length) return { processed: 0 }
  let processed = 0
  const queue = [...(data as EmailOutboxRow[])]
  const workers = Math.min(3, queue.length)
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) {
        const ev = queue.shift()
        if (ev && (await handleEmail(ev))) processed++
      }
    })
  )
  return { processed }
}
Deno.serve(async req => {
  if (!['POST', 'GET'].includes(req.method)) {
    return new Response('Method not allowed', { status: 405 })
  }
  if (req.headers.get('x-internal-secret') !== Deno.env.get('PUSH_INTERNAL_SECRET')) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const limit = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 10))
  const result = await processPendingEmails(limit)
  return jsonResponse({ success: true, ...result })
})
