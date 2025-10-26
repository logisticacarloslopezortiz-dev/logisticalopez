-- Adjust claim policy to be robust against whitespace in status
DROP POLICY IF EXISTS "collaborator claim pending unassigned" ON public.orders;
CREATE POLICY "collaborator claim pending unassigned" ON public.orders
FOR UPDATE
USING (
  assigned_to IS NULL AND lower(trim(status)) = 'pendiente'
)
WITH CHECK (
  assigned_to = auth.uid() AND lower(trim(status)) != 'completado'
);