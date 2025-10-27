-- Migración: Crear tablas faltantes para funcionalidades del proyecto
-- Fecha: 2025-10-27

-- Tabla de notificaciones (log y auditoría de envíos)
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

-- Tabla de suscripciones push (Web Push)
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

-- Nota: Si existe el esquema de autenticación de Supabase, se puede agregar FK:
-- alter table public.push_subscriptions
--   add constraint push_subscriptions_user_fk foreign key (user_id)
--   references auth.users (id) on delete cascade;

-- Tabla de perfiles (rol y metadatos)
create table if not exists public.profiles (
  id uuid primary key,
  email text,
  name text,
  role text check (role in ('administrador','colaborador','cliente')),
  created_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_email_idx on public.profiles(email);

-- Tabla de colaboradores (requerida por varias funciones Edge)
create table if not exists public.collaborators (
  id uuid primary key,
  email text,
  name text,
  phone text,
  role text,
  matricula text,
  status text not null default 'activo',
  created_at timestamptz not null default now()
);
create index if not exists collaborators_role_idx on public.collaborators(role);
create index if not exists collaborators_status_idx on public.collaborators(status);

-- Tabla de matrículas (vehículos vinculados a colaboradores)
create table if not exists public.matriculas (
  id bigserial primary key,
  collaborator_id uuid not null,
  matricula text not null,
  status text not null default 'activo',
  created_at timestamptz not null default now()
);
create index if not exists matriculas_collaborator_id_idx on public.matriculas(collaborator_id);

-- FK opcional si existe public.collaborators
-- alter table public.matriculas
--   add constraint matriculas_collaborator_fk foreign key (collaborator_id)
--   references public.collaborators (id) on delete cascade;

-- Tabla de facturas generadas (para soporte de PDF)
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

-- =========================
-- Mejoras y tablas faltantes
-- =========================

-- Ajustes en profiles para alinear con el backend (Edge Functions)
alter table if exists public.profiles
  add column if not exists full_name text;
alter table if exists public.profiles
  add column if not exists phone text;
alter table if exists public.profiles
  add column if not exists updated_at timestamptz not null default now();

-- Índices útiles
create index if not exists collaborators_email_idx on public.collaborators(email);
create index if not exists profiles_updated_at_idx on public.profiles(updated_at);

-- Normalización del estado de colaboradores (solo 'activo'/'inactivo')
do $$
begin
  if not exists (
    select 1 from pg_constraint 
    where conname = 'collaborators_status_chk'
  ) then
    alter table public.collaborators
      add constraint collaborators_status_chk
      check (status in ('activo','inactivo'));
  end if;
end$$;

-- Corregir inconsistencia en matriculas: usar user_id (uuid) en lugar de collaborator_id
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matriculas' and column_name = 'collaborator_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matriculas' and column_name = 'user_id'
  ) then
    alter table public.matriculas
      add column user_id uuid;
    update public.matriculas set user_id = collaborator_id;
    alter table public.matriculas
      drop column collaborator_id;
  end if;
end$$;
create index if not exists matriculas_user_id_idx on public.matriculas(user_id);

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

-- Tabla de órdenes (incluye evidencia y asignación a colaboradores)
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
  photos jsonb,              -- fotos capturadas en proceso
  evidence_urls jsonb,       -- evidencia final (urls)
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_assigned_to_idx on public.orders(assigned_to);
create index if not exists orders_created_at_idx on public.orders(created_at);

-- Tabla de negocio/empresa (incluye RNC)
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
create index if not exists business_owner_user_id_idx on public.business(owner_user_id);
create index if not exists business_rnc_idx on public.business(rnc);