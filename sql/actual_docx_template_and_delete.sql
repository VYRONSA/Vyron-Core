-- VYRON CORE ACTUAL DOCX TEMPLATE PACK SQL
-- Safe to run more than once.

-- Needed for deleting old contract templates / generated contract records.
drop policy if exists "DEV allow delete contract templates" on public.contract_templates;
drop policy if exists "DEV allow delete generated documents" on public.employee_generated_documents;
drop policy if exists "DEV allow delete digital signatures" on public.digital_signatures;
drop policy if exists "DEV allow delete document signing links" on public.document_signing_links;

create policy "DEV allow delete contract templates"
on public.contract_templates
for delete
to public
using (true);

create policy "DEV allow delete generated documents"
on public.employee_generated_documents
for delete
to public
using (true);

create policy "DEV allow delete digital signatures"
on public.digital_signatures
for delete
to public
using (true);

create policy "DEV allow delete document signing links"
on public.document_signing_links
for delete
to public
using (true);

grant all on public.contract_templates to anon, authenticated;
grant all on public.employee_generated_documents to anon, authenticated;
grant all on public.digital_signatures to anon, authenticated;
grant all on public.document_signing_links to anon, authenticated;