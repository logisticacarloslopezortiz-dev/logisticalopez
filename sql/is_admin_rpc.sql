CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
DECLARE
  is_admin_result boolean;
BEGIN
  SELECT (EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid() AND role = 'administrador'
  )) INTO is_admin_result;

  RETURN is_admin_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
