-- Tabla de rendimiento del colaborador
-- Vinculada a public.collaborators y protegida por RLS

create extension if not exists pgcrypto;

create table if not exists public.collaborator_performance (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references public.collaborators(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  jobs_completed int not null default 0,
  jobs_cancelled int not null default 0,
  avg_completion_minutes numeric(10,2),
  avg_rating numeric(3,2),
  on_time_rate numeric(5,2),
  total_distance_km numeric(10,2),
  revenue numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collaborator_performance_period_unique unique (collaborator_id, period_start, period_end)
);

-- Índices para consultas eficientes
create index if not exists collaborator_performance_collaborator_idx on public.collaborator_performance(collaborator_id);
create index if not exists collaborator_performance_period_start_idx on public.collaborator_performance(period_start);
create index if not exists collaborator_performance_period_end_idx on public.collaborator_performance(period_end);

-- Activar RLS
alter table public.collaborator_performance enable row level security;

-- Políticas: colaboradores leen su propio rendimiento; admins/owners gestionan todo
drop policy if exists "collaborator_read_own_performance" on public.collaborator_performance;
create policy "collaborator_read_own_performance" on public.collaborator_performance
  for select using (collaborator_id = auth.uid());

drop policy if exists "admin_manage_performance" on public.collaborator_performance;
create policy "admin_manage_performance" on public.collaborator_performance
  for all using (public.is_owner(auth.uid()) or public.is_admin(auth.uid()))
  with check (public.is_owner(auth.uid()) or public.is_admin(auth.uid()));

-- Trigger para mantener updated_at
create or replace function public.set_updated_at_collab_perf()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_updated_at_collab_perf on public.collaborator_performance;
create trigger trg_set_updated_at_collab_perf
before update on public.collaborator_performance
for each row execute function public.set_updated_at_collab_perf();

comment on table public.collaborator_performance is 'Métricas de rendimiento por período para colaboradores.';
comment on column public.collaborator_performance.avg_completion_minutes is 'Tiempo promedio de completitud en minutos.';
comment on column public.collaborator_performance.on_time_rate is 'Porcentaje de entregas a tiempo (0-100).';