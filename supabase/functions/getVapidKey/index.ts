// import de CORS
import { handleCors, jsonResponse } from '../cors-config.ts'
// usar import dinámico para evitar fallo de inicialización si el bundle cambia

// Servidor principal
Deno.serve(async (req: Request) => {
  // Manejo de preflight (OPTIONS)
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  // Métodos permitidos
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }

  try {
    const pub = Deno.env.get('VAPID_PUBLIC_KEY')
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')

    if (pub && priv) {
      return jsonResponse({ key: pub }, 200, req)
    }

    const webpush = await import('https://esm.sh/web-push@3.6.1')
    const keys = (webpush as any)?.generateVAPIDKeys ? (webpush as any).generateVAPIDKeys() : webpush.default.generateVAPIDKeys()

    return jsonResponse({ key: keys.publicKey }, 200, req)

  } catch (e) {
    console.error("Error en VAPID key function:", e)

    const msg = e instanceof Error ? e.message : String(e)
    return jsonResponse({ error: msg }, 500, req)
  }
})
