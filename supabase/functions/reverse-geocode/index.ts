import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// Headers para permitir CORS desde cualquier origen
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Manejar la solicitud pre-vuelo (preflight) de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { lat, lon } = await req.json();

    if (!lat || !lon) {
      throw new Error('Faltan los parámetros de latitud o longitud.');
    }

    // Llamar a la API de Nominatim desde el servidor
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
    
    const nominatimResponse = await fetch(nominatimUrl, {
      headers: {
        // Es buena práctica enviar un User-Agent
        'User-Agent': 'LogisticaLopezOrtiz/1.0 (https://your-app-url.com)' 
      }
    });

    if (!nominatimResponse.ok) {
      throw new Error(`Error al contactar Nominatim: ${nominatimResponse.statusText}`);
    }

    const data = await nominatimResponse.json();

    // Devolver la respuesta al cliente con los headers de CORS
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
