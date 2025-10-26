// Función Edge para proporcionar la clave VAPID pública
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCors, jsonResponse } from '../cors-config.ts';

// Función para registrar logs
function logDebug(message: string, data?: any) {
  console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
}

// Manejador principal de la función
serve(async (req) => {
  // Manejar solicitudes OPTIONS (preflight CORS)
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  
  try {
    // Obtener la clave VAPID pública desde las variables de entorno
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    
    if (!vapidPublicKey) {
      logDebug('VAPID_PUBLIC_KEY no está configurada en las variables de entorno');
      // Proporcionar una clave de respaldo para desarrollo (no usar en producción)
      return jsonResponse({ 
        vapidPublicKey: 'BLBz5HXcYVnRWZxsRiEgTQZYfS6VipYQPj7xQYqKtBUH9Mz7OHwzB5UYRurLrj_TJKQNRPDkzDKq9lHP0ERJ1K8',
        source: 'fallback'
      });
    }
    
    return jsonResponse({ 
      vapidPublicKey,
      source: 'env'
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    logDebug('Error al procesar la solicitud', error);
    return jsonResponse({ error: message }, 500);
  }
});