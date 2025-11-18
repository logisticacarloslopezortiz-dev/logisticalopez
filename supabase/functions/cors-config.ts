// Configuración CORS estándar para todas las funciones Edge de Supabase
// Importa este archivo en todas tus funciones Edge para mantener una configuración CORS consistente

const allowedOrigins = new Set([
  'https://logisticalopezortiz.com',
  'http://127.0.0.1:5502',
  'http://localhost:5502',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

export function corsHeadersForOrigin(origin: string | null): Record<string, string> {
  const allowOrigin = origin && allowedOrigins.has(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, Authorization, X-Client-Info, Apikey, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '10',
    'Access-Control-Allow-Credentials': 'true'
  };
}

// Back-compat default headers (used when origin is not available)
export const corsHeaders = corsHeadersForOrigin(null);

// Función para manejar solicitudes OPTIONS (preflight CORS)
export function handleCors(req: Request): Response | null {
  // Manejar solicitudes OPTIONS (preflight CORS)
  if (req.method === 'OPTIONS') {
    // Es crucial devolver un status 200 OK en la respuesta preflight.
    const origin = req.headers.get('origin');
    return new Response('ok', { status: 200, headers: corsHeadersForOrigin(origin) });
  }
  
  return null;
}

// Función para crear respuestas JSON con CORS
export function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  const origin = req?.headers?.get('origin') ?? null;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForOrigin(origin), 'Content-Type': 'application/json' }
  });
}