import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors, jsonResponse } from '../cors-config.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // Preflight CORS dinámico
  const cors = handleCors(req)
  if (cors) return cors
  
  try {
    const isValidVapid = (key: string | null | undefined) => {
      try {
        const k = String(key || '').trim()
        if (!k) return false
        const padding = '='.repeat((4 - k.length % 4) % 4)
        const base64 = (k + padding).replace(/-/g, '+').replace(/_/g, '/')
        const binary = atob(base64)
        const raw = Uint8Array.from(binary, c => c.charCodeAt(0))
        return raw.length === 65 && raw[0] === 4
      } catch { return false }
    }

    let vapidKey = Deno.env.get('PUBLIC_VAPID_KEY') || Deno.env.get('VAPID_PUBLIC_KEY')
    if (!isValidVapid(vapidKey)) {
      const url = Deno.env.get('SUPABASE_URL') || ''
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      if (url && key) {
        const supabase = createClient(url, key)
        const { data } = await supabase.from('business').select('vapid_public_key,push_vapid_key').limit(1).maybeSingle()
        const pub = (data?.vapid_public_key || '').trim()
        if (isValidVapid(pub)) vapidKey = pub
      }
    }

    if (!isValidVapid(vapidKey)) {
      return jsonResponse({ error: 'missing_or_invalid_public_vapid_key' }, 500, req)
    }
    return jsonResponse({ key: vapidKey }, 200, req)
  } catch (error: any) {
    return jsonResponse({ error: String(error?.message || error) }, 500, req)
  }
})
