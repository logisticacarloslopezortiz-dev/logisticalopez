-- Crear tabla de configuración del negocio
create table if not exists public.business_settings (
  id integer primary key default 1,
  business_name text,
  address text,
  phone text,
  email text,
  rnc text,
  quotation_rates jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Habilitar RLS
alter table public.business_settings enable row level security;

-- Solo administradores pueden ver y modificar la configuración del negocio
create policy "admin full access business_settings" on public.business_settings
for all using (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
) with check (
  exists (
    select 1 from public.collaborators c
    where c.id = auth.uid() and lower(c.role) = 'administrador'
  )
);

-- Función para actualizar updated_at automáticamente
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger para actualizar updated_at
create trigger update_business_settings_updated_at
  before update on public.business_settings
  for each row execute function update_updated_at_column();

-- Insertar configuración inicial si no existe
insert into public.business_settings (id, business_name, address, phone, email)
values (1, 'Mi Negocio', '', '', '')
on conflict (id) do nothing;