import { handleCors, jsonResponse } from '../cors-config.ts'

Deno.serve(async (req: Request) => {
  const corsPreflight = handleCors(req)
  if (corsPreflight) return corsPreflight

  try {
    const url = new URL(req.url)
    let body: any = null
    try { body = await req.json() } catch (_) { body = null }

    const rawQuery = (body?.q ?? body?.query ?? url.searchParams.get('q') ?? '').toString().trim()
    const country = (body?.country ?? url.searchParams.get('country') ?? '').toString().trim()

    if (!rawQuery || rawQuery.length < 3) {
      return jsonResponse({ results: [], message: 'query_too_short' }, 200, req)
    }

    const fullQuery = country ? `${rawQuery}, ${country}` : rawQuery
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&accept-language=es-DO&q=${encodeURIComponent(fullQuery)}`

    const resp = await fetch(nominatimUrl, {
      headers: { 'User-Agent': 'LogisticaLopezOrtiz/1.0 (https://logisticalopezortiz.com)' }
    })
    if (!resp.ok) {
      return jsonResponse({ error: `nominatim_error_${resp.status}` }, 200, req)
    }

    const data = await resp.json()
    const results = Array.isArray(data) ? data.map((r: any) => ({
      label: String(r.display_name || ''),
      lat: Number(r.lat),
      lon: Number(r.lon),
      boundingbox: r.boundingbox || null,
      address: r.address || null
    })) : []

    return jsonResponse({ results }, 200, req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return jsonResponse({ error: msg }, 200, req)
  }
})