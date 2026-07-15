-- VYRON CORE SIGNING FIX SQL
-- Run if signing still does not update records due to RLS.

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