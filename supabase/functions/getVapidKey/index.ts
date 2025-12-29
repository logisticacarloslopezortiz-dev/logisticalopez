import { handleCors, jsonResponse } from '../cors-config.ts'

function isValidVapid(key: string): boolean {
  try {
    const padding = '='.repeat((4 - key.length % 4) % 4)
    const base64 = (key + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/')

    const binary = atob(base64)
    const raw = Uint8Array.from(binary, c => c.charCodeAt(0))

    return raw.length === 65 && raw[0] === 4
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  try {
    const publicKey =
      Deno.env.get('PUBLIC_VAPID_KEY') ??
      Deno.env.get('VAPID_PUBLIC_KEY')

    if (!publicKey) {
      return jsonResponse({ error: 'missing_public_vapid_key' }, 500, req)
    }

    if (!isValidVapid(publicKey)) {
      console.error('[getVapidKey] VAPID inválida')
      return jsonResponse({ error: 'invalid_public_vapid_key' }, 500, req)
    }

    return jsonResponse({ key: publicKey }, 200, req)
  } catch (err) {
    console.error('[getVapidKey] error:', err)
    return jsonResponse({ error: 'internal_error' }, 500, req)
  }
})
