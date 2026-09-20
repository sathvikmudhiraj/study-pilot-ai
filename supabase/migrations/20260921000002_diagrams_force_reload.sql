-- Force PostgREST schema cache reload for diagrams table
-- Add a harmless column to trigger schema reload

ALTER TABLE public.diagrams ADD COLUMN IF NOT EXISTS cache_buster integer DEFAULT 0;

NOTIFY pgrst, 'reload schema';