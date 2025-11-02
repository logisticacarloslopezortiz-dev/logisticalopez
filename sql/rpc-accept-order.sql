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
SECURITY DEFINER
AS $$
DECLARE
  _now TIMESTAMPTZ := NOW();
BEGIN
  -- Actualizar la orden por supabase_seq_id
  UPDATE public.orders
  SET
    status = 'En proceso',
    last_collab_status = 'en_camino_recoger',
    accepted_at = _now,
    tracking_data = (
      COALESCE(tracking_data, '[]'::jsonb)
      || jsonb_build_object(
           'status', 'en_camino_recoger',
           'date', _now,
           'description', 'Orden aceptada, en camino a recoger'
         )
    )
  WHERE supabase_seq_id = order_id;

  -- Nota: si supabase_seq_id no existe, no se afectarán filas.
END;
$$;

-- Opcional: conceder privilegios de ejecución a roles típicos
-- GRANT EXECUTE ON FUNCTION public.accept_order(BIGINT) TO anon, authenticated, service_role;

COMMIT;