-- Crear bucket para evidencias de órdenes (si no existe)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-evidence',
  'order-evidence',
  true,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Eliminar políticas existentes si existen
DROP POLICY IF EXISTS "Authenticated users can upload evidence" ON storage.objects;
DROP POLICY IF EXISTS "Public can view evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own evidence" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own evidence" ON storage.objects;

-- Crear política para permitir subida de archivos autenticados
CREATE POLICY "Authenticated users can upload evidence" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'order-evidence' AND
  auth.role() = 'authenticated'
);

-- Crear política para permitir lectura pública
CREATE POLICY "Public can view evidence" ON storage.objects
FOR SELECT USING (bucket_id = 'order-evidence');

-- Crear política para permitir actualización por el propietario
CREATE POLICY "Users can update their own evidence" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'order-evidence' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Crear política para permitir eliminación por el propietario
CREATE POLICY "Users can delete their own evidence" ON storage.objects
FOR DELETE USING (
  bucket_id = 'order-evidence' AND
  auth.uid()::text = (storage.foldername(name))[1]
);