-- Habilita el "impersonation" para que la función pueda ejecutarse con los permisos del usuario que la define.
ALTER ROLE postgres SET pgrst.db_pre_request = 'app.pre_request';
NOTIFY pgrst, 'reload schema';

-- Función para aceptar una orden.
CREATE OR REPLACE FUNCTION accept_order(order_id_param uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Actualizar la orden para asignarla al colaborador actual.
  -- Se usa auth.uid() para obtener el ID del usuario que llama a la función.
  -- Se añade una condición `AND assigned_to IS NULL` para evitar que una orden ya asignada sea aceptada por otro colaborador (previene race conditions).
  UPDATE public.orders
  SET
    status = 'Asignado',
    assigned_to = auth.uid(),
    assigned_at = now()
  WHERE
    id = order_id_param AND assigned_to IS NULL;
END;
$$;
