-- Allow collaborators to view pending, unassigned orders
create policy "collaborator select pending unassigned" on public.orders
for select using (
  assigned_to is null and lower(status) = 'pendiente'
);

-- Restrict collaborator updates: cannot set status to 'Completado'
drop policy if exists "collaborator update own assigned" on public.orders;
create policy "collaborator update own assigned" on public.orders
for update using (assigned_to = auth.uid())
with check (assigned_to = auth.uid() and lower(status) != 'completado');