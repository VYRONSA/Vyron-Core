-- VYRON CORE CONTRACT GENERATION FIX SQL
-- Run this if generated DOCX upload/render is blocked.

insert into storage.buckets (id, name, public)
values
  ('hr-contract-templates', 'hr-contract-templates', false),
  ('hr-signed-documents', 'hr-signed-documents', false),
  ('hr-signatures', 'hr-signatures', false)
on conflict (id) do nothing;

drop policy if exists "DEV allow all storage objects" on storage.objects;
create policy "DEV allow all storage objects"
on storage.objects
for all
to public
using (true)
with check (true);

drop policy if exists "DEV allow all employee generated documents" on public.employee_generated_documents;
create policy "DEV allow all employee generated documents"
on public.employee_generated_documents
for all
to public
using (true)
with check (true);

grant all on public.employee_generated_documents to anon, authenticated;