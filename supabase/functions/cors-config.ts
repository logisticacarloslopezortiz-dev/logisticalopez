// supabase/functions/cors-config.ts

// Lista de orígenes permitidos para las solicitudes.
const allowedOrigins = [
  'https://logisticalopezortiz.com', // Dominio de producción
  'http://127.0.0.1:5502',          // Entorno de desarrollo local
  'http://localhost:5502',           // Alias de desarrollo local
  'http://127.0.0.1:8000',           // Servidor de Python para pruebas
  'http://localhost:8000',           // Alias del servidor de Python
];

// Genera las cabeceras CORS dinámicamente.
// Si el origen de la solicitud está en la lista de permitidos, lo refleja.
// Si no, utiliza el dominio de producción como valor por defecto por seguridad.
function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && allowedOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, Authorization, X-Client-Info, Apikey, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '10',
  };
}

// Maneja las solicitudes pre-vuelo (OPTIONS) de CORS.
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('Origin');
    return new Response('ok', { status: 200, headers: getCorsHeaders(origin) });
  }
  return null;
}

// Crea una respuesta JSON incluyendo las cabeceras CORS dinámicas.
// NOTA: Se ha añadido el parámetro `req` para poder obtener el origen.
export function jsonResponse(body: unknown, status = 200, req: Request): Response {
  const origin = req.headers.get('Origin');
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' },
  });
}