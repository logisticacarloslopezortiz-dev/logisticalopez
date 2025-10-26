-- Allow public order insertion for the contact form
-- This enables the public form to create orders without authentication

create policy "public insert orders" on public.orders
for insert with check (true);

-- Note: This allows anyone to insert orders, which is needed for the public contact form
-- The orders will be created without assigned_to (null) and with status 'pendiente'
-- Only authenticated collaborators/admins can then assign and update these orders