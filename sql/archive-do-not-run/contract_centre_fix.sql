-- VYRON CORE CONTRACT CENTRE FIX SQL
-- Safe to run more than once.

alter table public.contract_templates
add column if not exists template_body text;

alter table public.employee_generated_documents
add column if not exists generated_word_html text;

create table if not exists public.document_signing_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  employee_id uuid not null,
  document_id uuid not null,
  signing_token text not null unique,
  delivery_channel text not null default 'whatsapp',
  recipient_phone text,
  status text not null default 'active',
  expires_at timestamptz,
  opened_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

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

drop policy if exists "DEV allow all digital signatures" on public.digital_signatures;
create policy "DEV allow all digital signatures"
on public.digital_signatures
for all
to public
using (true)
with check (true);
grant all on public.digital_signatures to anon, authenticated;

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