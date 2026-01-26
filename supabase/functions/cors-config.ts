// Configuración CORS estándar para todas las funciones Edge de Supabase
// Importa este archivo en todas tus funciones Edge para mantener una configuración CORS consistente

const allowedOrigins = new Set([
  'https://logisticalopezortiz.com',
  'https://www.logisticalopezortiz.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5502',
  'http://localhost:5502',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5507',
  'http://localhost:5507',
  'http://127.0.0.1:5510',
  'http://localhost:5510'
]);

export function corsHeadersForOrigin(origin: string | null): Record<string, string> {
  const isAllowed = !!origin && allowedOrigins.has(origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': isAllowed ? origin! : '*',
    'Access-Control-Allow-Headers': [
      'authorization',
      'Authorization',
      'apikey',
      'Apikey',
      'content-type',
      'Content-Type',
      'x-client-info',
      'X-Client-Info',
      'x-supabase-client',
      'X-Supabase-Client',
      'x-supabase-client-platform',
      'X-Supabase-Client-Platform',
      'x-client-trace-id',
      'X-Client-Trace-Id'
    ].join(', '),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '10'
  };
  if (isAllowed) headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

// Back-compat default headers (used when origin is not available)
export const corsHeaders = corsHeadersForOrigin(null);

// Función para manejar solicitudes OPTIONS (preflight CORS)
export function handleCors(req: Request): Response | null {
  // Manejar solicitudes OPTIONS (preflight CORS)
  if (req.method === 'OPTIONS') {
    // Es crucial devolver un status 200 OK en la respuesta preflight.
    const origin = req.headers.get('origin');
    const base = corsHeadersForOrigin(origin);
    const requested = req.headers.get('access-control-request-headers');
    if (requested) {
      // Reflejar los headers solicitados además de los permitidos base
      base['Access-Control-Allow-Headers'] = `${base['Access-Control-Allow-Headers']}, ${requested}`;
    }
    return new Response('ok', { status: 200, headers: base });
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
