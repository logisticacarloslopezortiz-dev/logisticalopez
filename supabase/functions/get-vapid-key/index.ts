/// <reference path="../globals.d.ts" />
import { handleCors, jsonResponse } from '../cors-config.ts'

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  try {
    const pub = Deno.env.get('VAPID_PUBLIC_KEY')
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')
    if (pub && priv) {
      return jsonResponse({ key: pub }, 200, req)
    }

    const { generateVAPIDKeys } = await import('web-push')
    const keys = generateVAPIDKeys()
    return jsonResponse({ key: keys.publicKey }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonResponse({ error: msg }, 500, req)
  }
})
