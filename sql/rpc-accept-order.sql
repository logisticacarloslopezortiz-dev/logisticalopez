-- =====================================================
-- RPC: accept_order(order_id BIGINT)
-- Actualiza una orden identificada por supabase_seq_id
-- y agrega una entrada inicial al tracking_data
-- =====================================================

BEGIN;

-- Asegurar extensión para funciones de tiempo si se requiere
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Crear función RPC
CREATE OR REPLACE FUNCTION public.accept_order(order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _now TIMESTAMPTZ := NOW();
BEGIN
  -- Intentar actualizar por supabase_seq_id; si existe columna short_id, también permitir coincidencia por short_id
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'short_id'
  ) THEN
    UPDATE public.orders
    SET
      status = 'Aceptada',
      assigned_at = COALESCE(assigned_at, _now),
      tracking_data = (
        COALESCE(tracking_data, '[]'::jsonb)
        || jsonb_build_array(
             jsonb_build_object(
               'status', 'en_camino_recoger',
               'date', _now,
               'description', 'Orden aceptada, en camino a recoger'
             )
           )
      )
    WHERE id = order_id OR supabase_seq_id = order_id OR short_id = order_id::text;
  ELSE
    UPDATE public.orders
    SET
      status = 'Aceptada',
      assigned_at = COALESCE(assigned_at, _now),
      tracking_data = (
        COALESCE(tracking_data, '[]'::jsonb)
        || jsonb_build_array(
             jsonb_build_object(
               'status', 'en_camino_recoger',
               'date', _now,
               'description', 'Orden aceptada, en camino a recoger'
             )
           )
      )
    WHERE id = order_id OR supabase_seq_id = order_id;
  END IF;

  -- Nota: si no existió coincidencia, no se afectarán filas.
END;
$$;

-- Opcional: conceder privilegios de ejecución a roles típicos
GRANT EXECUTE ON FUNCTION public.accept_order(BIGINT) TO anon, authenticated, service_role;

COMMIT;