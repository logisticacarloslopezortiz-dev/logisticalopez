-- Overload for public.set_order_amount to support calls without collaborator_id
-- This wrapper accepts (amount, method, order_id) and forwards with NULL collaborator_id

CREATE OR REPLACE FUNCTION public.set_order_amount(
  amount numeric,
  method text,
  order_id integer
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  -- Normalizar método vacío a NULL
  SELECT * INTO v_order
  FROM public.set_order_amount(
    amount := amount,
    collaborator_id := NULL,
    method := NULLIF(method, ''),
    order_id := order_id
  );
  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_order_amount(numeric, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.set_order_amount(numeric, text, integer) TO authenticated;