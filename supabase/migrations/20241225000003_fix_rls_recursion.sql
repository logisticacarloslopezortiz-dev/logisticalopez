-- Fix recursion in RLS policies for public.collaborators
-- Remove policies that reference the same table and cause infinite recursion

-- Drop recursive policies on collaborators
drop policy if exists "admin select all" on public.collaborators;
drop policy if exists "admin insert" on public.collaborators;
drop policy if exists "admin update" on public.collaborators;
drop policy if exists "admin delete" on public.collaborators;

-- Keep "collab self select" as-is (already created in previous migration)
-- Add self-update policy to allow users to edit their own collaborator row
create policy "collab self update" on public.collaborators
for update using (id = auth.uid())
with check (id = auth.uid());

-- Note: Inserts/Deletes on collaborators should be performed via service role (Edge Functions)
-- and do not need additional policies here to avoid recursion.