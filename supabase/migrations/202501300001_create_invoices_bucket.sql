-- Create Storage bucket 'invoices' (public read) to fix 400 Bucket not found
DO $$
BEGIN
  PERFORM 1 FROM storage.buckets WHERE name = 'invoices';
  IF NOT FOUND THEN
    PERFORM storage.create_bucket('invoices', public := true);
  END IF;
END $$;

-- Optional: basic RLS policies for storage.objects are managed by Supabase defaults
-- Service Role bypasses RLS; clients should use public URLs or signed URLs