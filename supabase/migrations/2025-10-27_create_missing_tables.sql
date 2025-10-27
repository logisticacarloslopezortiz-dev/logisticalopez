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