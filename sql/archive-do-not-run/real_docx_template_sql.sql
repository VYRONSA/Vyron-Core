-- VYRON CORE REAL DOCX TEMPLATE SQL
-- Safe to run more than once.

alter table public.contract_templates
add column if not exists template_body text;

alter table public.employee_generated_documents
add column if not exists generated_word_html text;

insert into storage.buckets (id, name, public)
values
  ('hr-contract-templates', 'hr-contract-templates', false),
  ('hr-signed-documents', 'hr-signed-documents', false),
  ('hr-signatures', 'hr-signatures', false)
on conflict (id) do nothing;

drop policy if exists "DEV allow all contract templates" on public.contract_templates;
create policy "DEV allow all contract templates"
on public.contract_templates
for all
to public
using (true)
with check (true);
grant all on public.contract_templates to anon, authenticated;

drop policy if exists "DEV allow all employee generated documents" on public.employee_generated_documents;
create policy "DEV allow all employee generated documents"
on public.employee_generated_documents
for all
to public
using (true)
with check (true);
grant all on public.employee_generated_documents to anon, authenticated;

drop policy if exists "DEV allow all document signing links" on public.document_signing_links;
create policy "DEV allow all document signing links"
on public.document_signing_links
for all
to public
using (true)
with check (true);
grant all on public.document_signing_links to anon, authenticated;

drop policy if exists "DEV allow all storage objects" on storage.objects;
create policy "DEV allow all storage objects"
on storage.objects
for all
to public
using (true)
with check (true);