-- Add commission rate to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2) DEFAULT 0.00;

COMMENT ON COLUMN public.profiles.commission_rate IS 'The commission percentage for the collaborator.';
