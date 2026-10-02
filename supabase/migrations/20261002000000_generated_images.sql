create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  source_file_id uuid references public.files(id) on delete set null,
  title text not null,
  prompt text not null,
  provider_prompt text not null,
  explanation text not null,
  provider text not null,
  model text not null,
  storage_path text not null unique,
  mime_type text not null,
  width integer not null,
  height integer not null,
  status text not null default 'ready',
  language_code text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generated_images_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint generated_images_status_check check (status in ('ready', 'failed', 'deleted')),
  constraint generated_images_size_check check (width between 256 and 4096 and height between 256 and 4096)
);

create index if not exists generated_images_user_created_idx on public.generated_images(user_id, created_at desc);
create index if not exists generated_images_conversation_idx on public.generated_images(conversation_id, created_at);
alter table public.generated_images enable row level security;

drop policy if exists "generated_images_select_own" on public.generated_images;
create policy "generated_images_select_own" on public.generated_images for select using (auth.uid() = user_id);
drop policy if exists "generated_images_insert_own" on public.generated_images;
create policy "generated_images_insert_own" on public.generated_images for insert with check (auth.uid() = user_id);
drop policy if exists "generated_images_update_own" on public.generated_images;
create policy "generated_images_update_own" on public.generated_images for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "generated_images_delete_own" on public.generated_images;
create policy "generated_images_delete_own" on public.generated_images for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-images', 'generated-images', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "generated_images_objects_select_own" on storage.objects;
create policy "generated_images_objects_select_own" on storage.objects for select using (
  bucket_id = 'generated-images' and auth.uid()::text = (storage.foldername(name))[1]
);
drop policy if exists "generated_images_objects_insert_own" on storage.objects;
create policy "generated_images_objects_insert_own" on storage.objects for insert with check (
  bucket_id = 'generated-images' and auth.uid()::text = (storage.foldername(name))[1]
);
drop policy if exists "generated_images_objects_delete_own" on storage.objects;
create policy "generated_images_objects_delete_own" on storage.objects for delete using (
  bucket_id = 'generated-images' and auth.uid()::text = (storage.foldername(name))[1]
);

notify pgrst, 'reload schema';
