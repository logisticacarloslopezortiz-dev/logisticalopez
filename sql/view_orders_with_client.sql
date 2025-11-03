-- View: public.orders_with_client
-- Unifica los datos del cliente desde orders, profiles y clients
-- y expone columnas auxiliares para nombre de servicio, vehículo
-- y nombre del colaborador que completó la orden.

CREATE OR REPLACE VIEW public.orders_with_client AS
SELECT
  o.*,
  COALESCE(o.name, p.full_name, c.name) AS client_name,
  COALESCE(o.phone, p.phone, c.phone) AS client_phone,
  COALESCE(o.email, p.email, c.email) AS client_email,
  s.name AS service_name,
  v.name AS vehicle_name,
  cb.full_name AS completed_by_full_name
FROM public.orders o
LEFT JOIN public.profiles p ON p.id = o.client_id
LEFT JOIN public.clients c ON c.id = o.client_contact_id
LEFT JOIN public.services s ON s.id = o.service_id
LEFT JOIN public.vehicles v ON v.id = o.vehicle_id
LEFT JOIN public.profiles cb ON cb.id = o.completed_by;

GRANT SELECT ON public.orders_with_client TO anon;
GRANT SELECT ON public.orders_with_client TO authenticated;