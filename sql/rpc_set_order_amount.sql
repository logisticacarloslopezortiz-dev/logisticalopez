-- ==========================================================
-- ✅ Function: public.set_order_amount
-- ----------------------------------------------------------
-- Purpose:
--  Actualiza monto_cobrado y metodo_pago de una orden.
--  - Administradores pueden editar cualquier orden.
--  - Colaboradores solo las órdenes asignadas a ellos.
--  - Ejecuta con SECURITY DEFINER para bypass RLS de forma segura.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.set_order_amount(
  order_id integer,
  amount numeric,
  method text,
  collaborator_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  user_role text;
  is_admin boolean;
BEGIN
  -- 1️⃣ Verificar rol del usuario autenticado
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();

  is_admin := (user_role = 'admin');

  -- 2️⃣ Actualización según rol
  IF is_admin THEN
    UPDATE public.orders
    SET 
      monto_cobrado = amount,
      metodo_pago = NULLIF(method, '')
    WHERE id = order_id
    RETURNING id, short_id, monto_cobrado, metodo_pago
    INTO v_order;
  ELSE
    UPDATE public.orders
    SET 
      monto_cobrado = amount,
      metodo_pago = NULLIF(method, '')
    WHERE id = order_id
      AND (assigned_to = collaborator_id OR assigned_to = auth.uid())
    RETURNING id, short_id, monto_cobrado, metodo_pago
    INTO v_order;
  END IF;

  -- 3️⃣ Validar resultado
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada o sin autorización' 
      USING errcode = 'P0002';
  END IF;

  -- 4️⃣ Retornar objeto JSON con los campos actualizados
  RETURN json_build_object(
    'id', v_order.id,
    'short_id', v_order.short_id,
    'monto_cobrado', v_order.monto_cobrado,
    'metodo_pago', v_order.metodo_pago
  );
END;
$$;

-- 🔒 Permisos seguros
REVOKE ALL ON FUNCTION public.set_order_amount(integer, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_order_amount(integer, numeric, text, uuid) TO authenticated;
