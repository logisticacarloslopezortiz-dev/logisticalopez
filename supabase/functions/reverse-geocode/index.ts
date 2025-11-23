/// <reference path="../globals.d.ts" />
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts'

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  try {
    const body = await req.json()
    const latRaw = body?.lat
    const lonRaw = body?.lon
    const lat = typeof latRaw === 'string' ? parseFloat(latRaw) : Number(latRaw)
    const lon = typeof lonRaw === 'string' ? parseFloat(lonRaw) : Number(lonRaw)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return jsonResponse({ error: 'Parámetros inválidos: lat y lon deben ser numéricos.' }, 200)
    }

    // Llamar a la API de Nominatim desde el servidor
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=es-DO`;
    
    const nominatimResponse = await fetch(nominatimUrl, {
      headers: {
        // Es buena práctica enviar un User-Agent
        'User-Agent': 'LogisticaLopezOrtiz/1.0 (https://logisticalopezortiz.com)'
      }
    })

    if (!nominatimResponse.ok) {
      return jsonResponse({ error: `Error Nominatim: ${nominatimResponse.status} ${nominatimResponse.statusText}` }, 200)
    }

    const data = await nominatimResponse.json()

    // Devolver la respuesta al cliente con los headers de CORS
    return jsonResponse(data)

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    return jsonResponse({ error: message }, 200)
  }
});
