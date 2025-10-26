-- Add role column to collaborators table
-- This migration adds the missing 'role' column that's required for RLS policies

alter table public.collaborators 
add column if not exists role text default 'colaborador';

-- Add check constraint to ensure valid roles
alter table public.collaborators 
add constraint valid_role_check 
check (role in ('administrador', 'colaborador'));

-- Update existing records to have proper roles
-- Note: This assumes the first user created should be an admin
-- Adjust this logic based on your specific needs
update public.collaborators 
set role = 'administrador' 
where id = (
  select id from public.collaborators 
  order by created_at asc 
  limit 1
) and role is null;

-- Ensure all other records have 'colaborador' role
update public.collaborators 
set role = 'colaborador' 
where role is null;

-- Make role column not null after setting defaults
alter table public.collaborators 
alter column role set not null;