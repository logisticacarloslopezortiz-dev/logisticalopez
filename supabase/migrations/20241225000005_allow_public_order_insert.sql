-- Align with schema.sql: only allow inserting 'Pendiente' and client owned/anonymous
drop policy if exists "public insert orders" on public.orders;
create policy "public insert orders" on public.orders
for insert
to public
with check (
  status = 'Pendiente' and (client_id is null or client_id = auth.uid())
);

-- The public contact form inserts orders as 'Pendiente' with client_id null
-- Collaborators/admins (authenticated) can later claim and update the orders