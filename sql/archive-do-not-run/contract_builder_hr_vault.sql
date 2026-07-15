-- VYRON CORE CONTRACT BUILDER + HR VAULT SQL
-- Safe to run more than once.

insert into storage.buckets (id, name, public)
values ('hr-signed-documents', 'hr-signed-documents', false)
on conflict (id) do nothing;

alter table public.hr_documents
add column if not exists document_category text,
add column if not exists expiry_date date,
add column if not exists review_date date,
add column if not exists file_bucket text,
add column if not exists file_path text,
add column if not exists file_name text,
add column if not exists file_url text,
add column if not exists document_notes text,
add column if not exists uploaded_by text,
add column if not exists status text default 'active',
add column if not exists document_content text;

drop policy if exists "DEV allow all hr documents" on public.hr_documents;
create policy "DEV allow all hr documents"
on public.hr_documents
for all
to public
using (true)
with check (true);

grant all on public.hr_documents to anon, authenticated;

drop policy if exists "DEV allow all storage objects" on storage.objects;
create policy "DEV allow all storage objects"
on storage.objects
for all
to public
using (true)
with check (true);