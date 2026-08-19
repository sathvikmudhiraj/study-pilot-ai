insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'study-files',
  'study-files',
  false,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "study_files_select_own" on storage.objects;
create policy "study_files_select_own"
on storage.objects
for select
using (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "study_files_insert_own" on storage.objects;
create policy "study_files_insert_own"
on storage.objects
for insert
with check (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "study_files_update_own" on storage.objects;
create policy "study_files_update_own"
on storage.objects
for update
using (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "study_files_delete_own" on storage.objects;
create policy "study_files_delete_own"
on storage.objects
for delete
using (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

notify pgrst, 'reload schema';
