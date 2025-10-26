-- Allow collaborators to claim pending, unassigned orders
DROP POLICY IF EXISTS "collaborator claim pending unassigned" ON public.orders;
CREATE POLICY "collaborator claim pending unassigned" ON public.orders
FOR UPDATE
USING (
  assigned_to IS NULL AND lower(status) = 'pendiente'
)
WITH CHECK (
  assigned_to = auth.uid() AND lower(status) != 'completado'
);