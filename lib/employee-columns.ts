/**
 * Columns of public.employees that a signed-in (browser or user-scoped API) session may read.
 *
 * Since sql/100-security-role-hardening.sql, `pin_code` is write-only: SELECT is granted per
 * column and excludes it, so `select("*")` on employees is refused for user sessions. Read
 * `pin_configured` to know whether a PIN is set. Verify PINs with the
 * `vyron_verify_employee_pin` function, never in the browser.
 *
 * If a column is added to employees, add it here AND grant SELECT on it (see migration 100).
 */
// A single string literal (not a joined array) so supabase-js can type the selected row.
export const EMPLOYEE_READABLE_COLUMNS =
  "id,company_id,auth_user_id,employee_number,first_name,last_name,email,phone,job_title,default_store_id,employment_type,hourly_rate,active,start_date,created_at,updated_at,kiosk_access_enabled,last_pin_login_at,pin_login_attempts,pin_locked_until,record_status,pin_configured" as const;
