// supabase/functions/cors-config.ts

// Estos encabezados permiten las solicitudes desde cualquier origen.
// Para producción, podrías restringirlo a 'https://logisticalopezortiz.com'.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Maneja las solicitudes OPTIONS (preflight) de CORS.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function jsonResponse(body: unknown, status: number): Response {
  const headers = new Headers(corsHeaders)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers })
}