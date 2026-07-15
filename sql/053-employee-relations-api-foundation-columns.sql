-- 053-employee-relations-api-foundation-columns.sql
-- Batch 3: add supporting columns/constraints for Employee Relations API foundation.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.hr_cases') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.hr_cases. Run 051 first.';
  END IF;

  IF to_regclass('public.hearing_cases') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.hearing_cases. Run 051 first.';
  END IF;
END $$;

ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS incident_date date;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS manager_email text;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS note_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.hr_cases ADD COLUMN IF NOT EXISTS attachment_items jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.hearing_cases ADD COLUMN IF NOT EXISTS initiator_email text;
ALTER TABLE public.hearing_cases ADD COLUMN IF NOT EXISTS appeal_status text NOT NULL DEFAULT 'not_started';
ALTER TABLE public.hearing_cases ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.hearing_cases ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE public.hearing_cases ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.hearing_cases ADD COLUMN IF NOT EXISTS outcome_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.hearing_participants ADD COLUMN IF NOT EXISTS representative_role text;
ALTER TABLE public.hearing_participants ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE public.hearing_participants ADD COLUMN IF NOT EXISTS removed_by text;

DO $notes$
BEGIN
  IF to_regclass('public.employee_notes') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.employee_notes. Skipping employee_notes extensions in migration 053.';
  ELSE
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS deleted_at timestamptz';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS deleted_by text';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS note_status text NOT NULL DEFAULT ''active''';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS attachment_items jsonb NOT NULL DEFAULT ''[]''::jsonb';
    EXECUTE 'ALTER TABLE public.employee_notes ADD COLUMN IF NOT EXISTS audit_metadata jsonb NOT NULL DEFAULT ''{}''::jsonb';
  END IF;
END
$notes$;

CREATE INDEX IF NOT EXISTS hr_cases_incident_date_idx ON public.hr_cases (incident_date);
CREATE INDEX IF NOT EXISTS hr_cases_category_idx ON public.hr_cases (category);
CREATE INDEX IF NOT EXISTS hearing_cases_appeal_status_idx ON public.hearing_cases (appeal_status);
CREATE INDEX IF NOT EXISTS hearing_participants_removed_at_idx ON public.hearing_participants (removed_at);
DO $notes_index$
BEGIN
  IF to_regclass('public.employee_notes') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_notes_deleted_at_idx ON public.employee_notes (deleted_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS employee_notes_note_status_idx ON public.employee_notes (note_status)';
  END IF;
END
$notes_index$;

COMMIT;

NOTIFY pgrst, 'reload schema';
