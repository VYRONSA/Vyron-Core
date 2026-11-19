-- =====================================================================================
-- 101 rollback — removes the clocking functions, audit trigger and attendance tables.
-- WARNING: re-opens direct clock-event writes (manager-only, as left by 100) and
-- discards attendance corrections, geofences, review notes, device events, PIN-failure
-- log and the clock audit trail. Export those tables first. Run only with written approval.
-- Columns added to clock_events are kept (they hold history); drop them separately if needed.
-- =====================================================================================
begin;

drop trigger if exists trg_vyron_audit_clock_event on public.clock_events;

drop function if exists public.vyron_flag_stale_open_shifts(uuid);
drop function if exists public.vyron_kiosk_recent_events(uuid, timestamptz);
drop function if exists public.vyron_kiosk_directory(uuid);
drop function if exists public.vyron_review_attendance_correction(uuid, text, text);
drop function if exists public.vyron_manager_record_clock_event(uuid, text, timestamptz, text, uuid, uuid, uuid);
drop function if exists public.vyron_record_clock_event(uuid, uuid, text, uuid, numeric, numeric, numeric, text, text, text, text, text, timestamptz, text);
drop function if exists public.vyron_employee_clock_state(uuid);
drop function if exists public.vyron_employee_clock_state_internal(uuid, timestamptz);
drop function if exists public.vyron_flag_missed_clock_out(public.clock_events);
drop function if exists public.vyron_raise_time_exception(text, uuid, uuid, uuid, uuid, text, text, text);
drop function if exists public.vyron_distance_meters(numeric, numeric, numeric, numeric);
drop function if exists public.vyron_audit_clock_event();

-- Restore the 100 state: managers may write clock events directly.
grant insert, update on public.clock_events to authenticated;
drop policy if exists clock_events_insert_v100 on public.clock_events;
drop policy if exists clock_events_update_v100 on public.clock_events;
create policy clock_events_insert_v100 on public.clock_events for insert to authenticated
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));
create policy clock_events_update_v100 on public.clock_events for update to authenticated
  using ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()))
  with check ((select public.vyron_is_platform_operator()) or company_id in (select public.vyron_manager_company_ids()));

drop index if exists public.clock_events_client_event_id_uidx;

drop table if exists public.clock_event_audit;
drop table if exists public.attendance_pin_failures;
drop table if exists public.attendance_device_events;
drop table if exists public.attendance_review_notes;
drop table if exists public.attendance_correction_audit;
drop table if exists public.attendance_corrections;
drop table if exists public.attendance_geofences;
drop function if exists public.vyron_attendance_settings(uuid);
drop table if exists public.attendance_settings;

notify pgrst, 'reload schema';
commit;
