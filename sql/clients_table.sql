-- Tabla de clientes para solicitudes sin usuario autenticado

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

-- Añadir columna en orders para referenciar contacto de cliente
do $$ begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'orders' and column_name = 'client_contact_id'
  ) then
    alter table public.orders add column client_contact_id uuid;
  end if;
end $$;

-- FK hacia clients.id
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_client_contact_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_client_contact_id_fkey
      foreign key (client_contact_id)
      references public.clients(id)
      on delete set null;
  end if;
end $$;

-- RLS para clients (permitir insert/select a anon y authenticated)
alter table public.clients enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_insert_any'
  ) then
    create policy clients_insert_any on public.clients
      for insert to anon, authenticated
      with check (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_select_any'
  ) then
    create policy clients_select_any on public.clients
      for select to anon, authenticated
      using (true);
  end if;
end $$;