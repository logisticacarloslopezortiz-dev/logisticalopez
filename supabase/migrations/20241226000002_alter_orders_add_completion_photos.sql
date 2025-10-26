-- Ensure completion and evidence columns exist on public.orders

alter table if exists public.orders
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists evidence_photos jsonb default '[]'::jsonb;

-- Optional index to query completed orders quickly
create index if not exists idx_orders_completed_at on public.orders (completed_at);

-- Optional: maintain updated_at timestamp if table uses it
-- create or replace function public.set_updated_at()
-- returns trigger as $$
-- begin
--   new.updated_at = now();
--   return new;
-- end;
-- $$ language plpgsql;
-- drop trigger if exists orders_set_updated_at on public.orders;
-- create trigger orders_set_updated_at before update on public.orders
-- for each row execute procedure public.set_updated_at();