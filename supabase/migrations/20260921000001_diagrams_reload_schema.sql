-- Force PostgREST schema cache reload for diagrams table
-- This migration adds a comment to trigger PostgREST schema reload

COMMENT ON TABLE public.diagrams IS 'AI-generated diagrams for study materials';

NOTIFY pgrst, 'reload schema';