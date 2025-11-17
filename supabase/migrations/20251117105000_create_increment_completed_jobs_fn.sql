
-- Corregir la función RPC para que se integre con el sistema de métricas existente
CREATE OR REPLACE FUNCTION increment_completed_jobs(user_id_param uuid)
RETURNS void AS $$
BEGIN
  -- Llamar a la función existente que actualiza las métricas de rendimiento.
  -- Esto asegura que el contador de trabajos completados se incremente
  -- en la tabla 'collaborator_performance' para la fecha actual.
  PERFORM public.upsert_collaborator_metric_fixed(
    p_collaborator_id := user_id_param,
    p_metric_date := current_date,
    p_accept_inc := 0,
    p_in_progress_inc := 0,
    p_complete_inc := 1, -- Incrementar el contador de completados
    p_cancel_inc := 0,
    p_amount := null,
    p_rating := null,
    p_completion_minutes := null
  );
END;
$$ LANGUAGE plpgsql;
