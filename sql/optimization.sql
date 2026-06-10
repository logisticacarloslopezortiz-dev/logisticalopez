-- =============================================================
--        OPTIMIZACIÓN DE BASE DE DATOS - TLC
-- =============================================================

-- 1. Índices B-Tree para consultas rápidas
-- Ya existen algunos, pero aseguramos los más críticos con ordenamiento específico
CREATE INDEX IF NOT EXISTS idx_orders_status_btree ON public.orders USING btree (status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to_btree ON public.orders USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_short_id_unique_idx ON public.orders (short_id);

-- 2. Índice compuesto para el tablero (Filtro por estado + Orden por fecha)
CREATE INDEX IF NOT EXISTS idx_orders_dashboard_status_date ON public.orders (status, created_at DESC);

-- 3. Nuevos campos para gestión de disponibilidad en Collaborators
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();

-- 4. Índice para disponibilidad
CREATE INDEX IF NOT EXISTS idx_collaborators_is_online ON public.collaborators (is_online);

-- 5. Políticas RLS reforzadas para Administradores
-- (Asumiendo que ya existen las políticas básicas, estas aseguran acceso total)

DO $$ 
BEGIN
    -- Política de lectura total para administradores en orders
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_full_access_orders') THEN
        CREATE POLICY admin_full_access_orders ON public.orders
        FOR ALL USING (
            EXISTS (
                SELECT 1 FROM public.collaborators
                WHERE id = auth.uid() AND lower(role) = 'administrador'
            )
        );
    END IF;

    -- Política de lectura total para administradores en collaborators
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_full_access_collaborators') THEN
        CREATE POLICY admin_full_access_collaborators ON public.collaborators
        FOR ALL USING (
            EXISTS (
                SELECT 1 FROM public.collaborators
                WHERE id = auth.uid() AND lower(role) = 'administrador'
            )
        );
    END IF;
END $$;

-- Función para actualización de ubicación ultra-rápida
CREATE OR REPLACE FUNCTION public.update_collaborator_location_atomic(p_lat double precision, p_lng double precision)
RETURNS void AS $$
BEGIN
  INSERT INTO public.collaborator_locations (collaborator_id, lat, lng, updated_at)
  VALUES (auth.uid(), p_lat, p_lng, now())
  ON CONFLICT (collaborator_id) 
  DO UPDATE SET 
    lat = EXCLUDED.lat, 
    lng = EXCLUDED.lng, 
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
