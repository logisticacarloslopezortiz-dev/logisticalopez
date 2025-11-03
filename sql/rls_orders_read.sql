-- Optional RLS read policy for authenticated users to fetch assigned orders.
-- Enable only if RLS is active and you need broader read access.

alter table public.orders enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'read_assigned_orders'
  ) then
    create policy read_assigned_orders on public.orders
      for select to authenticated
      using (assigned_to = auth.uid());
  end if;
end $$;