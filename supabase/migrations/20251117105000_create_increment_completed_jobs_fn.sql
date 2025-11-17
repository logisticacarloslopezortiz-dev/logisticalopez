
-- Crear la función RPC para incrementar los trabajos completados de un colaborador
CREATE OR REPLACE FUNCTION increment_completed_jobs(user_id_param uuid)
RETURNS void AS $$
BEGIN
  -- Incrementar el contador de trabajos completados en la tabla de colaboradores
  -- Esta es una suposición, la tabla y columna podrían tener otros nombres.
  -- Se asume que existe una tabla 'collaborators' con una columna 'completed_jobs'.
  -- Si no existe, esta función fallará y deberá ser ajustada.
  UPDATE public.collaborators
  SET completed_jobs = COALESCE(completed_jobs, 0) + 1
  WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql;
