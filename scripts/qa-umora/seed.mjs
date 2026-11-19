// Deterministic QA seed for the two isolated test tenants. LOCAL REPLICA ONLY.
// Keeps the 3-year synthetic history (source='seed') used by the volume tests.
import { CEC, OTHER, STORE, OTHER_STORE, ensureUser, sql } from "./lib.mjs";

export const USERS = {
  owner: "owner@cec-qa.test",
  admin: "admin@cec-qa.test",
  manager: "manager@cec-qa.test",
  payroll: "payroll@cec-qa.test",
  employee1: "employee1@cec-qa.test",
  employee2: "employee2@cec-qa.test",
  otherAdmin: "admin@other-qa.test",
  kiosk: "kiosk@cec-qa.test",
  outsider: "outsider@nowhere-qa.test",
};

export async function seed({ minSecondsBetweenEvents = 0 } = {}) {
  const ids = {};
  for (const [key, email] of Object.entries(USERS)) ids[key] = await ensureUser(email);

  sql(`
begin;
insert into companies(id,name,status,subscription_status,timezone,country) values
  ('${CEC}','CEC QA (local replica)','active','active','Africa/Johannesburg','ZA'),
  ('${OTHER}','OTHER QA (local replica)','active','active','Africa/Johannesburg','ZA')
on conflict (id) do nothing;
insert into stores(id,company_id,name,city,latitude,longitude,gps_radius_meters,status) values
  ('${STORE}','${CEC}','CEC Kitchen Sandton','Johannesburg',-26.1076,28.0567,150,'active'),
  ('${OTHER_STORE}','${OTHER}','Other Store','Cape Town',-33.92,18.42,150,'active')
on conflict (id) do update set latitude=excluded.latitude, longitude=excluded.longitude, gps_radius_meters=excluded.gps_radius_meters;

-- QA-tenant cleanup only: skip triggers (the payroll export lock and audit triggers would
-- rightly refuse deleting exported test rows). Never used outside this local test seed.
set local session_replication_role = replica;
-- Operational data of the QA tenants (history rows from the volume seed are kept).
delete from attendance_correction_audit where company_id in ('${CEC}','${OTHER}');
delete from attendance_corrections where company_id in ('${CEC}','${OTHER}');
delete from time_exceptions where company_id in ('${CEC}','${OTHER}');
delete from clock_events where company_id in ('${CEC}','${OTHER}') and source <> 'seed';
-- Functional tests use CEC001..CEC030 with no history; CEC031..060 keep the volume history.
delete from clock_events where company_id='${CEC}' and source='seed'
  and employee_id in (select id from employees where company_id='${CEC}' and employee_number <= 'CEC030');
delete from clock_event_audit where company_id in ('${CEC}','${OTHER}');
delete from employee_notifications where employee_id in (select id::text from employees where company_id in ('${CEC}','${OTHER}'));
delete from leave_decision_audit where employee_id in (select id::text from employees where company_id in ('${CEC}','${OTHER}'));
delete from leave_requests where company_id in ('${CEC}','${OTHER}');
delete from roster_shifts where company_id in ('${CEC}','${OTHER}');
delete from attendance_pin_failures where company_id in ('${CEC}','${OTHER}');
do $$ begin
  if to_regclass('public.leave_public_holidays') is not null then delete from leave_public_holidays where company_id in ('${CEC}','${OTHER}'); end if;
  if to_regclass('public.hr_change_audit') is not null then delete from hr_change_audit where company_id in ('${CEC}','${OTHER}'); end if;
end $$;
delete from vyron_user_sessions where company_id in ('${CEC}','${OTHER}') or user_email like '%-qa.test';
do $$ begin
  if to_regclass('public.payroll_hours') is not null then
    delete from payroll_hours where company_id in ('${CEC}','${OTHER}');
  end if;
  if to_regclass('public.payroll_period_locks') is not null then
    delete from payroll_period_locks where company_id in ('${CEC}','${OTHER}');
  end if;
end $$;

delete from employee_pin_credentials where employee_id in (select id from employees where company_id='${CEC}' and employee_number !~ '^CEC[0-9]{3}$');
delete from employees where company_id='${CEC}' and employee_number !~ '^CEC[0-9]{3}$';
set local session_replication_role = origin;
-- Memberships (deterministic roles; the guard trigger is bypassed for SQL run as postgres).
delete from company_users where company_id in ('${CEC}','${OTHER}');
insert into company_users(company_id,user_id,auth_user_id,user_email,role,status) values
  ('${CEC}','${ids.owner}','${ids.owner}','${USERS.owner}','owner','active'),
  ('${CEC}','${ids.admin}','${ids.admin}','${USERS.admin}','admin','active'),
  ('${CEC}','${ids.manager}','${ids.manager}','${USERS.manager}','manager','active'),
  ('${CEC}','${ids.payroll}','${ids.payroll}','${USERS.payroll}','payroll','active'),
  ('${CEC}','${ids.employee1}','${ids.employee1}','${USERS.employee1}','employee','active'),
  ('${CEC}','${ids.employee2}','${ids.employee2}','${USERS.employee2}','employee','active'),
  ('${CEC}','${ids.kiosk}','${ids.kiosk}','${USERS.kiosk}','kiosk','active'),
  ('${OTHER}','${ids.otherAdmin}','${ids.otherAdmin}','${USERS.otherAdmin}','admin','active');

-- 60 CEC employees (CEC001..CEC060, PIN = 1000+n), one OTHER employee (PIN 9999).
insert into employees(company_id,employee_number,first_name,last_name,default_store_id,active,record_status,pin_code,hourly_rate,kiosk_access_enabled)
select '${CEC}','CEC'||lpad(g::text,3,'0'),'Qa'||g,'Cook','${STORE}',true,'active',(1000+g)::text,45.00,true
from generate_series(1,60) g
where not exists (select 1 from employees e where e.company_id='${CEC}' and e.employee_number='CEC'||lpad(g::text,3,'0'));
update employees set active=true, record_status='active', kiosk_access_enabled=true, hourly_rate=45.00,
       pin_code=(1000+substr(employee_number,4)::int)::text, pin_login_attempts=0, pin_locked_until=null,
       default_store_id='${STORE}', auth_user_id=null, email=null
 where company_id='${CEC}' and employee_number ~ '^CEC[0-9]{3}$';
update employees set auth_user_id='${ids.employee1}', email='${USERS.employee1}' where company_id='${CEC}' and employee_number='CEC001';
update employees set auth_user_id='${ids.employee2}', email='${USERS.employee2}' where company_id='${CEC}' and employee_number='CEC002';
update employees set auth_user_id='${ids.manager}', email='${USERS.manager}' where company_id='${CEC}' and employee_number='CEC060';
insert into employees(company_id,employee_number,first_name,last_name,default_store_id,active,pin_code,hourly_rate)
select '${OTHER}','OTH001','Other','Person','${OTHER_STORE}',true,'9999',60
where not exists (select 1 from employees where company_id='${OTHER}' and employee_number='OTH001');
update employees set pin_code='9999', pin_login_attempts=0, pin_locked_until=null, active=true where company_id='${OTHER}';

delete from attendance_settings where company_id in ('${CEC}','${OTHER}');
insert into attendance_settings(company_id, min_seconds_between_events, geofence_mode)
values ('${CEC}', ${minSecondsBetweenEvents}, 'flag'), ('${OTHER}', ${minSecondsBetweenEvents}, 'flag');
commit;
`);

  // Volume history for CEC031..CEC060 (3 years, 06:00–15:00 SAST daily), created once. Inserted
  // with triggers off (bulk test data), then given shift sessions and attendance dates.
  if (sql(`select count(*) from clock_events where company_id='${CEC}' and source='seed'`) === "0") {
    sql(`
begin;
set local session_replication_role = replica;
insert into clock_events(company_id,employee_id,store_id,event_type,event_time,source)
select e.company_id,e.id,e.default_store_id,t.typ,
       (d + case t.typ when 'clock_in' then interval '6 hours' else interval '15 hours' end) at time zone 'Africa/Johannesburg','seed'
from employees e cross join generate_series(current_date - 1095, current_date - 1, interval '1 day') d
cross join (values ('clock_in'),('clock_out')) t(typ)
where e.company_id='${CEC}' and e.employee_number >= 'CEC031';
update clock_events set shift_session_id = id, attendance_date = (event_time at time zone 'Africa/Johannesburg')::date
 where company_id='${CEC}' and source='seed' and event_type='clock_in';
update clock_events o set shift_session_id = i.id, attendance_date = i.attendance_date
  from clock_events i
 where o.company_id='${CEC}' and o.source='seed' and o.event_type='clock_out'
   and i.employee_id = o.employee_id and i.source='seed' and i.event_type='clock_in'
   and i.attendance_date = (o.event_time at time zone 'Africa/Johannesburg')::date;
commit;
analyze clock_events;`);
  }

  const map = {};
  for (const line of sql(`select employee_number||'|'||id from employees where company_id in ('${CEC}','${OTHER}')`).split("\n")) {
    const [number, id] = line.split("|");
    map[number] = id;
  }
  return { userIds: ids, employees: map };
}
