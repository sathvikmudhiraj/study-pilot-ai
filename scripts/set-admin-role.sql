with updated_user as (
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'admin')
  where lower(email) = lower('admin01@gmail.com')
  returning
    email,
    id,
    raw_app_meta_data ->> 'role' as app_metadata_role
)
select
  email,
  id as user_id,
  app_metadata_role as "app_metadata.role"
from updated_user;
