-- Migración: Crear tablas y constraints según BLOQUES 1–3
-- Fecha: 2025-10-27

-- 🧩 BLOQUE 1 – Extensión y tablas base
-- Extensión requerida para UUIDs
create extension if not exists "pgcrypto";

-- Tabla de perfiles (base vacía)
create table if not exists public.profiles (
  id uuid primary key,
  email text,
  name text,
  created_at timestamptz not null default now()
);

-- Tabla de colaboradores (base vacía)
create table if not exists public.collaborators (
  id uuid primary key,
  email text,
  name text,
  phone text,
  matricula text,
  created_at timestamptz not null default now()
);

-- ✅ Esto solo crea las tablas vacías base sin errores.

-- 🧩 BLOQUE 2 – Columnas y ajustes
-- Añadir columnas a profiles
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists role text;

-- Añadir columnas a collaborators
alter table public.collaborators add column if not exists role text;
alter table public.collaborators add column if not exists status text default 'activo';

-- Normalizar datos nulos
update public.collaborators set status = coalesce(status, 'activo');
update public.collaborators set role = coalesce(role, 'colaborador');

-- 🧩 BLOQUE 3 – Constraints y validaciones
-- Validar roles de profiles
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_chk'
  ) then
    alter table public.profiles
      add constraint profiles_role_chk
      check (lower(role) in ('administrador','colaborador','chofer','operador','cliente'));
  end if;
end$$;

-- Validar roles de collaborators
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'collaborators_role_chk'
  ) then
    alter table public.collaborators
      add constraint collaborators_role_chk
      check (lower(role) in ('administrador','colaborador','chofer','operador'));
  end if;
end$$;

-- Validar estados de collaborators
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'collaborators_status_chk'
  ) then
    alter table public.collaborators
      add constraint collaborators_status_chk
      check (status in ('activo','inactivo'));
  end if;
end$$;

-- Índices para rendimiento
-- Índices de profiles
create index if not exists profiles_email_idx on public.profiles(email);
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_updated_at_idx on public.profiles(updated_at);

-- Índices de collaborators
create index if not exists collaborators_email_idx on public.collaborators(email);
create index if not exists collaborators_role_idx on public.collaborators(role);
create index if not exists collaborators_status_idx on public.collaborators(status);

-- =========================
-- Tablas adicionales
-- =========================

-- Tabla de notificaciones
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null,
  order_id text null,
  title text not null,
  body text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_id_idx on public.notifications(user_id);

-- Tabla de suscripciones push
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

-- Tabla de matrículas
create table if not exists public.matriculas (
  id bigserial primary key,
  user_id uuid not null,
  matricula text not null,
  status text not null default 'activo',
  created_at timestamptz not null default now()
);
create index if not exists matriculas_user_id_idx on public.matriculas(user_id);

-- Tabla de facturas
create table if not exists public.invoices (
  id bigserial primary key,
  order_id text not null,
  client_name text,
  client_phone text,
  client_email text,
  rnc text,
  company_name text,
  amount numeric(12,2) not null,
  currency text not null default 'DOP',
  pdf_url text,
  created_at timestamptz not null default now()
);
create index if not exists invoices_order_id_idx on public.invoices(order_id);

-- Tabla de servicios
create table if not exists public.services (
  id bigserial primary key,
  name text not null unique,
  description text,
  base_price numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists services_active_idx on public.services(active);

-- Tabla de órdenes
create table if not exists public.orders (
  id text primary key,
  client_name text,
  client_phone text,
  client_email text,
  service text,
  vehicle text,
  address text,
  assigned_to uuid references public.collaborators(id) on delete set null,
  status text not null check (status in ('pendiente','en_proceso','completado','cancelado')),
  price numeric(12,2),
  photos jsonb,
  evidence_urls jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_assigned_to_idx on public.orders(assigned_to);
create index if not exists orders_created_at_idx on public.orders(created_at);

-- Tabla de negocio
create table if not exists public.business (
  id bigserial primary key,
  owner_user_id uuid,
  company_name text not null,
  rnc text,
  phone text,
  email text,
  address text,
  logo_url text,
  created_at timestamptz not null default now()
);

-- Habilitar RLS y política no recursiva para business
alter table public.business enable row level security;
drop policy if exists "owner_full_access_business" on public.business;
create policy "owner_full_access_business" on public.business
for all using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());
create index if not exists business_owner_user_id_idx on public.business(owner_user_id);
create index if not exists business_rnc_idx on public.business(rnc);