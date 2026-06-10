-- =============================================================
--        GESTIÓN DE PAGOS A COLABORADORES
-- =============================================================

-- 1. Tabla de Registro de Pagos
CREATE TABLE IF NOT EXISTS public.collaborator_payments (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    collaborator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL, -- 'Efectivo', 'Transferencia', 'Cheque', etc.
    payment_month INT NOT NULL CHECK (payment_month BETWEEN 1 AND 12),
    payment_year INT NOT NULL,
    notes TEXT,
    receipt_url TEXT, -- URL opcional de archivo de comprobante
    processed_by UUID REFERENCES public.profiles(id) -- Admin que registró el pago
);

-- 2. Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_payments_collaborator ON public.collaborator_payments(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.collaborator_payments(payment_year, payment_month);

-- 3. Políticas RLS
ALTER TABLE public.collaborator_payments ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_manage_payments') THEN
        CREATE POLICY admin_manage_payments ON public.collaborator_payments
        FOR ALL USING (
            EXISTS (
                SELECT 1 FROM public.collaborators
                WHERE id = auth.uid() AND lower(role) = 'administrador'
            )
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'collaborator_view_own_payments') THEN
        CREATE POLICY collaborator_view_own_payments ON public.collaborator_payments
        FOR SELECT USING (collaborator_id = auth.uid());
    END IF;
END $$;

-- 4. Comentarios
COMMENT ON TABLE public.collaborator_payments IS 'Historial de pagos de comisiones realizados a los colaboradores.';
