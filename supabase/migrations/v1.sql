-- supabase/migrations/v1.sql
-- Fichero de migración para ajustar la base de datos a la nueva arquitectura de notificaciones.

-- 1. Añadir la nueva columna `target_contact_id` a la tabla `notification_outbox`
-- Esto permite tener una referencia explícita al cliente anónimo.
ALTER TABLE public.notification_outbox
ADD COLUMN IF NOT EXISTS target_contact_id UUID
REFERENCES public.clients(id) ON DELETE SET NULL;

-- 2. Crear la función RPC `get_subscriptions_by_role`
-- Esta función será llamada por la Edge Function `notify-role` para obtener
-- las suscripciones de todos los usuarios con un rol específico (ej. 'administrador').
-- Es SECURITY DEFINER para poder acceder a la tabla `collaborators` con privilegios elevados.
CREATE OR REPLACE FUNCTION public.get_subscriptions_by_role(role_name TEXT)
RETURNS TABLE(endpoint TEXT, keys JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      ps.endpoint,
      ps.keys
    FROM
      push_subscriptions ps
    JOIN
      collaborators c ON ps.user_id = c.id
    WHERE
      c.role = role_name
      AND c.status = 'activo';
END;
$$;

-- 3. Otorgar permisos para que la función pueda ser llamada por el rol `service_role`
-- (el rol que usan las Edge Functions de Supabase).
GRANT EXECUTE ON FUNCTION public.get_subscriptions_by_role(TEXT) TO service_role;

-- 4. Opcional: Limpieza de triggers antiguos
-- Si ya no se usarán, se pueden eliminar para evitar ejecuciones innecesarias.
-- NOTA: Se eliminarán en el siguiente paso del plan. Mantenerlos por ahora para no romper
-- el sistema actual hasta que la nueva lógica esté completamente desplegada.
-- DROP TRIGGER IF EXISTS trg_orders_notify_status ON public.orders;
-- DROP TRIGGER IF EXISTS trg_orders_notify_creation ON public.orders;
-- DROP FUNCTION IF EXISTS public.notify_order_creation();
-- DROP FUNCTION IF EXISTS public.notify_order_status_change();

-- 5. Añadir un índice para la nueva columna para optimizar búsquedas.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_target_contact_id
ON public.notification_outbox(target_contact_id);

-- 6. Añadir un índice en `processed_at` para optimizar la selección de notificaciones pendientes.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_processed_at_null
ON public.notification_outbox(processed_at)
WHERE processed_at IS NULL;
