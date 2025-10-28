-- Fix RLS policies for orders table to resolve 406 errors
-- The issue is that collaborators need proper permissions to update orders

-- Drop existing problematic policies
DROP POLICY IF EXISTS "collaborator_select_pending" ON public.orders;
DROP POLICY IF EXISTS "collaborator_update_own_assigned" ON public.orders;

-- Create improved policies for collaborators
-- Allow collaborators to see pending orders (for claiming)
CREATE POLICY "collaborators_can_view_pending_orders" ON public.orders 
FOR SELECT USING (
  assigned_to IS NULL AND 
  lower(trim(status)) IN ('pendiente', 'pending')
);

-- Allow collaborators to see their own assigned orders
CREATE POLICY "collaborators_can_view_assigned_orders" ON public.orders 
FOR SELECT USING (
  assigned_to = auth.uid()
);

-- Allow collaborators to claim pending orders (assign themselves)
CREATE POLICY "collaborators_can_claim_orders" ON public.orders 
FOR UPDATE USING (
  assigned_to IS NULL AND 
  lower(trim(status)) IN ('pendiente', 'pending')
) WITH CHECK (
  assigned_to = auth.uid()
);

-- Allow collaborators to update their assigned orders
CREATE POLICY "collaborators_can_update_assigned_orders" ON public.orders 
FOR UPDATE USING (
  assigned_to = auth.uid()
) WITH CHECK (
  assigned_to = auth.uid()
);

-- Ensure collaborators exist in the collaborators table for proper access
-- This policy allows any authenticated user to read collaborator info (needed for validation)
DROP POLICY IF EXISTS "collaborator_self_select" ON public.collaborators;
CREATE POLICY "collaborators_can_read_all" ON public.collaborators 
FOR SELECT USING (true);

-- Allow collaborators to update their own profile
CREATE POLICY "collaborators_can_update_self" ON public.collaborators 
FOR UPDATE USING (auth.uid() = id) 
WITH CHECK (auth.uid() = id);