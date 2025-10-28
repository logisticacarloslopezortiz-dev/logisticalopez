/// <reference path="../globals.d.ts" />
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts'

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  try {
    const { lat, lon } = await req.json()

    if (!lat || !lon) {
      throw new Error('Faltan los parámetros de latitud o longitud.')
    }

    // Llamar a la API de Nominatim desde el servidor
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
    
    const nominatimResponse = await fetch(nominatimUrl, {
      headers: {
        // Es buena práctica enviar un User-Agent
        'User-Agent': 'LogisticaLopezOrtiz/1.0 (https://your-app-url.com)'
      }
    })

    if (!nominatimResponse.ok) {
      throw new Error(`Error al contactar Nominatim: ${nominatimResponse.statusText}`)
    }

    const data = await nominatimResponse.json()

    // Devolver la respuesta al cliente con los headers de CORS
    return jsonResponse(data)

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    return jsonResponse({ error: message }, 400)
  }
});
