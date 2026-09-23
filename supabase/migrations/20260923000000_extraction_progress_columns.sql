-- Add extraction_progress and extraction_updated_at columns to files table
-- These columns are used for tracking PDF vision extraction progress for resume capability

alter table public.files
add column if not exists extraction_progress jsonb,
add column if not exists extraction_updated_at timestamptz;

-- Create index for efficient querying of files with extraction progress
create index if not exists files_extraction_progress_idx
on public.files using gin (extraction_progress) where extraction_progress is not null;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';