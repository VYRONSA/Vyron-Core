-- VYRON CORE NEXT HR PACK SQL
-- Run only if needed. This is safe to run more than once.

-- Optional helper fields for HR document vault consistency
alter table public.hr_documents
add column if not exists document_category text,
add column if not exists expiry_date date,
add column if not exists review_date date;

-- Development access for hr_documents if RLS blocks inserts/reads.
drop policy if exists "DEV allow all hr documents" on public.hr_documents;
create policy "DEV allow all hr documents"
on public.hr_documents
for all
to public
using (true)
with check (true);

grant all on public.hr_documents to anon, authenticated;

-- Development access for leave requests/balances if RLS blocks leave control.
drop policy if exists "DEV allow all leave requests" on public.leave_requests;
create policy "DEV allow all leave requests"
on public.leave_requests
for all
to public
using (true)
with check (true);

grant all on public.leave_requests to anon, authenticated;

-- Views cannot always receive policies. If leave_balances_live is a table in your project, this helps.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
    and table_name = 'leave_balances_live'
    and table_type = 'BASE TABLE'
  ) then
    execute 'drop policy if exists "DEV allow all leave balances live" on public.leave_balances_live';
    execute 'create policy "DEV allow all leave balances live" on public.leave_balances_live for all to public using (true) with check (true)';
    execute 'grant all on public.leave_balances_live to anon, authenticated';
  end if;
end $$;