-- accept_order.sql
CREATE OR REPLACE FUNCTION public.accept_order(order_id_param bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verificar que el usuario sea un colaborador activo
  IF NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE id = auth.uid() AND status = 'activo'
  ) THEN
    RAISE EXCEPTION 'No tienes permiso para aceptar órdenes.';
  END IF;

  -- Actualizar la orden solo si está 'Pendiente' y no está asignada
  UPDATE public.orders
  SET
    assigned_to = auth.uid(),
    status = 'En proceso',
    last_collab_status = 'en_camino_recoger',
    assigned_at = now()
  WHERE
    id = order_id_param
    AND status = 'Pendiente'
    AND assigned_to IS NULL;

  -- Verificar si la actualización fue exitosa
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden no está disponible para ser aceptada.';
  END IF;
END;
$$;
