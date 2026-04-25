-- ============================================================
-- SUPER ADMIN SCHEMA — Logística López Ortiz
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla de logs de auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  action      TEXT NOT NULL,
  detail      TEXT,
  user_id     UUID,
  user_email  TEXT,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- Solo el super-admin puede leer/escribir
CREATE POLICY "super_admin_audit" ON audit_logs
  USING (auth.uid() = '93b6577f-69ee-4cbd-9f4c-54dabf75920f');

-- 2. Tabla de pagos del 5%
CREATE TABLE IF NOT EXISTS fee_payments (
  id           BIGSERIAL PRIMARY KEY,
  period       TEXT,           -- 'YYYY-MM'
  amount       NUMERIC(12,2),
  voucher_url  TEXT,
  note         TEXT,
  status       TEXT DEFAULT 'pending_review', -- pending_review | approved | rejected
  paid_at      TIMESTAMPTZ,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;
-- Admin puede insertar, super-admin puede todo
CREATE POLICY "admin_insert_fee" ON fee_payments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "super_admin_fee" ON fee_payments
  USING (auth.uid() = '93b6577f-69ee-4cbd-9f4c-54dabf75920f');

-- 3. Columna feature_flags en business (si no existe)
ALTER TABLE business ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';

-- 4. Marcar al super-admin en app_metadata (ejecutar como service_role)
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}'::jsonb
-- WHERE id = '93b6577f-69ee-4cbd-9f4c-54dabf75920f';

-- 5. Función RPC para verificar si es super-admin
CREATE OR REPLACE FUNCTION is_super_admin(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT uid = '93b6577f-69ee-4cbd-9f4c-54dabf75920f';
$$ LANGUAGE SQL SECURITY DEFINER;

-- 6. Índices para performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_payments_status ON fee_payments(status);
CREATE INDEX IF NOT EXISTS idx_fee_payments_period ON fee_payments(period);
