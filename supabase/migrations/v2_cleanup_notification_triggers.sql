-- supabase/migrations/v2_cleanup_notification_triggers.sql
-- Este script elimina los triggers y funciones de notificación antiguos
-- que han sido reemplazados por la Edge Function `process-outbox`.

-- 1. Eliminar el trigger que se disparaba al crear una orden.
DROP TRIGGER IF EXISTS trg_orders_notify_creation ON public.orders;

-- 2. Eliminar el trigger que se disparaba al actualizar el estado de una orden.
DROP TRIGGER IF EXISTS trg_orders_notify_status ON public.orders;

-- 3. Eliminar la función que manejaba la notificación de creación de orden.
DROP FUNCTION IF EXISTS public.notify_order_creation();

-- 4. Eliminar la función que manejaba la notificación de cambio de estado.
DROP FUNCTION IF EXISTS public.notify_order_status_change();

-- 5. Modificar la función `create_order_with_contact` para insertar en el `notification_outbox`
-- [IMPORTANTE] En lugar de depender de un trigger, ahora la inserción en el outbox
-- se hará explícitamente desde la función que crea la orden. Esto es más robusto.

CREATE OR REPLACE FUNCTION public.create_order_with_contact(order_payload jsonb)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_client_id UUID := (SELECT auth.uid());
  v_contact_id UUID;
  v_order public.orders;
  v_push_subscription JSONB;
BEGIN
  -- Extraer la suscripción push del payload
  v_push_subscription := order_payload->'push_subscription';

  -- Lógica para cliente anónimo
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients(name, phone, email)
    VALUES (
      NULLIF(order_payload->>'name', ''),
      NULLIF(order_payload->>'phone', ''),
      NULLIF(order_payload->>'email', '')
    ) RETURNING id INTO v_contact_id;

    -- Insertar la suscripción push vinculada al contacto, si existe
    IF v_push_subscription IS NOT NULL AND v_push_subscription->>'endpoint' IS NOT NULL THEN
      INSERT INTO public.push_subscriptions(client_contact_id, endpoint, keys)
      VALUES (v_contact_id, v_push_subscription->>'endpoint', v_push_subscription->'keys')
      ON CONFLICT (client_contact_id, endpoint) DO UPDATE SET keys = excluded.keys;
    END IF;

    -- Insertar la orden
    INSERT INTO public.orders (
      name, phone, email, rnc, empresa, service_id, vehicle_id, service_questions,
      pickup, delivery, origin_coords, destination_coords, "date", "time",
      status, estimated_price, tracking_data, client_contact_id
    ) VALUES (
      NULLIF(order_payload->>'name', ''), NULLIF(order_payload->>'phone', ''), NULLIF(order_payload->>'email', ''),
      NULLIF(order_payload->>'rnc', ''), NULLIF(order_payload->>'empresa', ''),
      (order_payload->>'service_id')::bigint, (order_payload->>'vehicle_id')::bigint, order_payload->'service_questions',
      order_payload->>'pickup', order_payload->>'delivery',
      order_payload->'origin_coords', order_payload->'destination_coords',
      (order_payload->>'date')::date, (order_payload->>'time')::time,
      'Pendiente', order_payload->>'estimated_price', order_payload->'tracking_data', v_contact_id
    ) RETURNING * INTO v_order;

    -- Insertar notificaciones en el outbox para el cliente anónimo y el admin
    -- Notificación para el cliente
    INSERT INTO public.notification_outbox(order_id, new_status, target_contact_id, payload)
    VALUES (
      v_order.id,
      'Creada',
      v_contact_id,
      jsonb_build_object(
        'title', '✅ Solicitud Recibida',
        'body', 'Hemos recibido tu solicitud #' || v_order.short_id || '. Pronto será revisada.'
      )
    );

  -- Lógica para cliente autenticado
  ELSE
    -- Insertar suscripción push vinculada al usuario, si existe
    IF v_push_subscription IS NOT NULL AND v_push_subscription->>'endpoint' IS NOT NULL THEN
      INSERT INTO public.push_subscriptions(user_id, endpoint, keys)
      VALUES (v_client_id, v_push_subscription->>'endpoint', v_push_subscription->'keys')
      ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = excluded.keys;
    END IF;

    -- Insertar la orden
    INSERT INTO public.orders (
      name, phone, email, rnc, empresa, service_id, vehicle_id, service_questions,
      pickup, delivery, origin_coords, destination_coords, "date", "time",
      status, estimated_price, tracking_data, client_id
    ) VALUES (
      NULLIF(order_payload->>'name', ''), NULLIF(order_payload->>'phone', ''), NULLIF(order_payload->>'email', ''),
      NULLIF(order_payload->>'rnc', ''), NULLIF(order_payload->>'empresa', ''),
      (order_payload->>'service_id')::bigint, (order_payload->>'vehicle_id')::bigint, order_payload->'service_questions',
      order_payload->>'pickup', order_payload->>'delivery',
      order_payload->'origin_coords', order_payload->'destination_coords',
      (order_payload->>'date')::date, (order_payload->>'time')::time,
      'Pendiente', order_payload->>'estimated_price', order_payload->'tracking_data', v_client_id
    ) RETURNING * INTO v_order;

    -- Insertar notificación en el outbox para el cliente autenticado
    INSERT INTO public.notification_outbox(order_id, new_status, target_user_id, payload)
    VALUES (
      v_order.id,
      'Creada',
      v_client_id,
      jsonb_build_object(
        'title', '✅ Solicitud Recibida',
        'body', 'Hemos recibido tu solicitud #' || v_order.short_id || '. Pronto será revisada.'
      )
    );
  END IF;

  -- Notificación para el administrador (común para ambos casos)
  INSERT INTO public.notification_outbox(order_id, new_status, target_role, payload)
  VALUES (
    v_order.id,
    'Creada',
    'administrador',
    jsonb_build_object(
      'title', '📢 Nueva Solicitud Recibida',
      'body', 'Se ha creado la solicitud #' || v_order.short_id || ' por ' || COALESCE(v_order.name, 'No especificado') || '.'
    )
  );

  RETURN v_order;
END;
$$;

-- 6. Re-otorgar permisos a la función modificada
GRANT EXECUTE ON FUNCTION public.create_order_with_contact(jsonb) TO anon, authenticated;
