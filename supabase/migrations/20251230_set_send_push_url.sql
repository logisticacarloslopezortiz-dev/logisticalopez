-- Set persistent DB GUC for push endpoint
DO $$ BEGIN
  PERFORM set_config('app.settings.send_push_url','https://fkprllkxyjtosjhtikxy.functions.supabase.co/send-push', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM 1;
END $$;

-- Note: service_role_token is a secret; do NOT hardcode it in migrations.
-- Set it manually via SQL Editor:
-- select set_config('app.settings.service_role_token','<SUPABASE_SERVICE_ROLE_KEY>', true);
