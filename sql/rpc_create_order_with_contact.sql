-- RPC: public.create_order_with_contact
-- Inserta una orden creando contacto en public.clients si no hay usuario autenticado
-- Devuelve la fila completa de public.orders

CREATE OR REPLACE FUNCTION public.create_order_with_contact(order_payload jsonb)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := (SELECT auth.uid());
  v_contact_id bigint;
  v_order public.orders;
BEGIN
  -- Si no hay usuario autenticado, crear contacto
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients(name, phone, email)
    VALUES (
      NULLIF(order_payload->>'name',''),
      NULLIF(order_payload->>'phone',''),
      NULLIF(order_payload->>'email','')
    )
    RETURNING id INTO v_contact_id;
  END IF;

  -- Insertar la orden usando los datos del payload
  INSERT INTO public.orders (
    name, phone, email, rnc, empresa,
    service_id, vehicle_id, service_questions,
    pickup, delivery,
    origin_coords, destination_coords,
    date, time,
    status, estimated_price,
    tracking_data, tracking,
    client_id, client_contact_id
  ) VALUES (
    NULLIF(order_payload->>'name',''),
    NULLIF(order_payload->>'phone',''),
    NULLIF(order_payload->>'email',''),
    NULLIF(order_payload->>'rnc',''),
    NULLIF(order_payload->>'empresa',''),
    NULLIF(order_payload->>'service_id','')::int,
    NULLIF(order_payload->>'vehicle_id','')::int,
    order_payload->'service_questions',
    order_payload->>'pickup',
    order_payload->>'delivery',
    order_payload->'origin_coords',
    order_payload->'destination_coords',
    order_payload->>'date',
    order_payload->>'time',
    COALESCE(order_payload->>'status','Pendiente'),
    order_payload->>'estimated_price',
    order_payload->'tracking_data',
    COALESCE(order_payload->'tracking', order_payload->'tracking_data'),
    v_client_id,
    CASE WHEN v_client_id IS NULL THEN v_contact_id ELSE NULL END
  )
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_contact(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_contact(jsonb) TO authenticated;