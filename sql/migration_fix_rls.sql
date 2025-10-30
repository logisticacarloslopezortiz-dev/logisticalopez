-- =============================================================
-- MIGRACIÓN: Parche de RLS y consistencia para base existente
-- Objetivo: corregir error "new row violates row-level security policy for table 'orders'"
-- y alinear policies/índices/constraints sin perder datos.
-- =============================================================

-- 1) Asegurar RLS habilitado en tablas relevantes
ALTER TABLE IF NOT EXISTS public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.matriculas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.business ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF NOT EXISTS public.business_settings ENABLE ROW LEVEL SECURITY;

-- 2) Policies de ORDERS: insertar público en estado Pendiente
DROP POLICY IF EXISTS "public_insert_pending_orders" ON public.orders;
CREATE POLICY "public_insert_pending_orders" ON public.orders
FOR INSERT
WITH CHECK (
  status = 'Pendiente' AND (client_id IS NULL OR client_id = auth.uid())
);

-- Lecturas/updates existentes (idempotente)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='clients_read_own_orders'
  ) THEN
    EXECUTE $$CREATE POLICY "clients_read_own_orders" ON public.orders FOR SELECT USING (client_id = auth.uid())$$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='collaborator_read_pending_orders'
  ) THEN
    EXECUTE $$CREATE POLICY "collaborator_read_pending_orders" ON public.orders FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.collaborators c
        WHERE c.id = auth.uid() AND c.status = 'activo'
      ) AND status = 'Pendiente'
    )$$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='collaborator_read_assigned_orders'
  ) THEN
    EXECUTE $$CREATE POLICY "collaborator_read_assigned_orders" ON public.orders FOR SELECT USING (assigned_to = auth.uid())$$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='collaborator_update_own_orders'
  ) THEN
    EXECUTE $$CREATE POLICY "collaborator_update_own_orders" ON public.orders FOR UPDATE USING (assigned_to = auth.uid())$$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='owner_admin_all_orders'
  ) THEN
    EXECUTE $$CREATE POLICY "owner_admin_all_orders" ON public.orders FOR ALL USING (
      public.is_owner(auth.uid()) OR public.is_admin(auth.uid())
    )$$;
  END IF;
END $$;

-- 3) Notifications: índice y policy de manejo por usuario
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
DROP POLICY IF EXISTS "user_read_own_notifications" ON public.notifications;
DROP POLICY IF EXISTS "user_manage_own_notifications" ON public.notifications;
CREATE POLICY "user_manage_own_notifications" ON public.notifications
FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4) Push subscriptions: asegurar policy de manejo por usuario
DROP POLICY IF EXISTS "user_manage_own_push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "user_manage_own_push_subscriptions" ON public.push_subscriptions
FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5) Consistencia de RNC en business_settings
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_settings_rnc_check'
  ) THEN
    ALTER TABLE public.business_settings
      ADD CONSTRAINT business_settings_rnc_check
      CHECK (rnc ~ '^[0-9]{9,11}$' OR rnc IS NULL);
  END IF;
END $$;

-- 6) Constraint de estado permitido en orders (opcional pero recomendado)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_status_check
      CHECK (status IN ('Pendiente','Aceptada','En curso','Completada','Cancelada'));
  END IF;
END $$;

-- 7) Triggers updated_at para collaborators y orders (idempotente)
DO $$ BEGIN
  -- función touch/updated ya debería existir; crear si falta
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    EXECUTE $$CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;$$;
  END IF;

  -- columna updated_at si falta
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collaborators' AND column_name='updated_at'
  ) THEN
    ALTER TABLE public.collaborators ADD COLUMN updated_at timestamptz not null default now();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='updated_at'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN updated_at timestamptz not null default now();
  END IF;

  -- triggers
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_collaborators_touch_updated'
  ) THEN
    EXECUTE $$CREATE TRIGGER trg_collaborators_touch_updated BEFORE UPDATE ON public.collaborators FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();$$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_orders_touch_updated'
  ) THEN
    EXECUTE $$CREATE TRIGGER trg_orders_touch_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();$$;
  END IF;
END $$;

-- 8) Índices útiles adicionales (idempotentes)
CREATE INDEX IF NOT EXISTS idx_collaborators_email ON public.collaborators(email);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- 9) Nota: si insertas órdenes desde cliente anónimo, asegúrate de enviar status='Pendiente'
-- y NO enviar client_id (o que client_id = auth.uid() si autenticado). Además, revisa tu API call:
-- - Usa la URL https://<project>.supabase.co/rest/v1/orders y el apikey anon
-- - Incluye el header Prefer: return=representation si necesitas el registro devuelto
-- - No incluyas columnas no permitidas por RLS en insert

-- FIN MIGRACIÓN
