-- Force PostgREST schema cache reload by updating table comment
COMMENT ON TABLE public.diagrams IS 'AI-generated diagrams for study materials - cache reload';

NOTIFY pgrst, 'reload schema';