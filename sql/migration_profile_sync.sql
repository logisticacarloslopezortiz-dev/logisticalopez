-- =============================================================
-- Migration: Add Profile Sync Trigger and Fix RLS Policies
-- =============================================================

-- 1. Add trigger to sync profile names from collaborators
CREATE OR REPLACE FUNCTION public.sync_profile_name()
RETURNS trigger AS $$
BEGIN
  -- Upsert into public.profiles to ensure a profile row always exists for the collaborator
  INSERT INTO public.profiles (id, full_name, email, phone, created_at, updated_at)
  VALUES (NEW.id, NEW.name, NEW.email, NEW.phone, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_profile_name ON public.collaborators;
CREATE TRIGGER trg_sync_profile_name
AFTER INSERT OR UPDATE OF name, email, phone ON public.collaborators
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_name();

-- 2. Fix RLS policies for orders
-- Ensure RLS is enabled on the tables we will modify (safe to run multiple times)
ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.collaborators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_pending_orders" ON public.orders;
CREATE POLICY "public_insert_pending_orders" ON public.orders
FOR INSERT
WITH CHECK (
  -- Allow pending orders from any client (including anonymous)
  status = 'Pendiente' AND
  -- Prevent hijacking by ensuring client_id is either null or matches auth
  (client_id IS NULL OR client_id = auth.uid()) AND
  -- Additional safety: assigned_to must be null for new orders
  assigned_to IS NULL
);

-- 3. More permissive read policy for orders (helps with 401s)
DROP POLICY IF EXISTS "public_read_pending_orders" ON public.orders;
CREATE POLICY "public_read_pending_orders" ON public.orders
FOR SELECT USING (
  -- Allow reading pending orders or own orders
  status = 'Pendiente' OR
  client_id = auth.uid() OR
  assigned_to = auth.uid() OR
  -- Admins and owners can read all
  public.is_owner(auth.uid()) OR 
  public.is_admin(auth.uid())
);

-- 4. Make sure collaborator operations work
DROP POLICY IF EXISTS "collaborator_all_on_own_orders" ON public.orders;
CREATE POLICY "collaborator_all_on_own_orders" ON public.orders
FOR ALL USING (
  -- Must be an active collaborator
  EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = auth.uid() AND c.status = 'activo'
  ) AND (
    -- And either the order is assigned to them
    assigned_to = auth.uid() OR
    -- Or it's pending (allowing them to accept it)
    status = 'Pendiente'
  )
) WITH CHECK (
  -- For inserts/updates, must be an active collaborator
  EXISTS (
    SELECT 1 FROM public.collaborators c
    WHERE c.id = auth.uid() AND c.status = 'activo'
  )
);

-- 5. Fix collaborator self-management
DROP POLICY IF EXISTS "collaborator_self_manage" ON public.collaborators;
CREATE POLICY "collaborator_self_manage" ON public.collaborators
FOR ALL USING (
  -- Collaborators can manage their own profiles
  auth.uid() = id OR
  -- Admins and owners can manage all
  public.is_owner(auth.uid()) OR 
  public.is_admin(auth.uid())
) WITH CHECK (
  -- Similar check for insert/update
  auth.uid() = id OR
  public.is_owner(auth.uid()) OR 
  public.is_admin(auth.uid())
);

-- 6. Add admin insert policy for collaborators (helps with creation)
DROP POLICY IF EXISTS "admin_insert_collaborators" ON public.collaborators;
CREATE POLICY "admin_insert_collaborators" ON public.collaborators
FOR INSERT
WITH CHECK (
  public.is_owner(auth.uid()) OR 
  public.is_admin(auth.uid())
);

-- 7. Ensure admins can manage profiles
DROP POLICY IF EXISTS "admin_manage_profiles" ON public.profiles;
CREATE POLICY "admin_manage_profiles" ON public.profiles
FOR ALL USING (
  public.is_owner(auth.uid()) OR 
  public.is_admin(auth.uid())
) WITH CHECK (
  public.is_owner(auth.uid()) OR 
  public.is_admin(auth.uid())
);

-- 8. Add profile insert for new users
DROP POLICY IF EXISTS "auth_insert_profile" ON public.profiles;
CREATE POLICY "auth_insert_profile" ON public.profiles
FOR INSERT
WITH CHECK (
  -- New users can create their profile
  auth.uid() = id
);