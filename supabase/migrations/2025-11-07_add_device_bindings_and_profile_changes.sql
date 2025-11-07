-- Migration: device_bindings, profile_changes, client_logs

-- Table: device_bindings
create table if not exists public.device_bindings (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  user_id uuid not null,
  bound_at timestamptz not null default now(),
  last_seen timestamptz
);
alter table public.device_bindings enable row level security;

-- Table: profile_changes (auditoría de cambios de perfiles)
create table if not exists public.profile_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  editor_id uuid,
  changed_fields jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.profile_changes enable row level security;

-- Table: client_logs (logs cliente opcionales)
create table if not exists public.client_logs (
  id uuid primary key default gen_random_uuid(),
  level text,
  message text,
  stack text,
  url text,
  user_id uuid,
  created_at timestamptz not null default now()
);
alter table public.client_logs enable row level security;

-- Nota: Las políticas RLS deben definirse según roles del proyecto.
-- En esta migración se habilita RLS pero no se crean políticas, por lo que el acceso
-- queda restringido por defecto (solo service role). Añade políticas en supabase/policies/rls_policies.sql.