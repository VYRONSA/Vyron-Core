-- 059-progressive-discipline-warning-hearing-links.sql
-- Batch 9: Link warnings and hearings to progressive discipline records.
-- Safe to rerun.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.hr_warnings') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.hr_warnings. Run 051 first.';
  END IF;

  IF to_regclass('public.hearing_cases') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.hearing_cases. Run 051 first.';
  END IF;

  IF to_regclass('public.discipline_progressions') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.discipline_progressions. Run 051 first.';
  END IF;

  IF to_regclass('public.discipline_progression_decisions') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.discipline_progression_decisions. Run 054 first.';
  END IF;
END $$;

ALTER TABLE public.hr_warnings
  ADD COLUMN IF NOT EXISTS discipline_progression_id uuid;

ALTER TABLE public.hr_warnings
  ADD COLUMN IF NOT EXISTS discipline_decision_id uuid;

ALTER TABLE public.hearing_cases
  ADD COLUMN IF NOT EXISTS discipline_progression_id uuid;

ALTER TABLE public.hearing_cases
  ADD COLUMN IF NOT EXISTS discipline_decision_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hr_warnings_discipline_progression_id_fkey'
  ) THEN
    ALTER TABLE public.hr_warnings
      ADD CONSTRAINT hr_warnings_discipline_progression_id_fkey
      FOREIGN KEY (discipline_progression_id)
      REFERENCES public.discipline_progressions (id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hr_warnings_discipline_decision_id_fkey'
  ) THEN
    ALTER TABLE public.hr_warnings
      ADD CONSTRAINT hr_warnings_discipline_decision_id_fkey
      FOREIGN KEY (discipline_decision_id)
      REFERENCES public.discipline_progression_decisions (id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hearing_cases_discipline_progression_id_fkey'
  ) THEN
    ALTER TABLE public.hearing_cases
      ADD CONSTRAINT hearing_cases_discipline_progression_id_fkey
      FOREIGN KEY (discipline_progression_id)
      REFERENCES public.discipline_progressions (id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hearing_cases_discipline_decision_id_fkey'
  ) THEN
    ALTER TABLE public.hearing_cases
      ADD CONSTRAINT hearing_cases_discipline_decision_id_fkey
      FOREIGN KEY (discipline_decision_id)
      REFERENCES public.discipline_progression_decisions (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS hr_warnings_discipline_progression_idx
  ON public.hr_warnings (company_id, employee_id, discipline_progression_id);

CREATE INDEX IF NOT EXISTS hr_warnings_discipline_decision_idx
  ON public.hr_warnings (company_id, employee_id, discipline_decision_id);

CREATE INDEX IF NOT EXISTS hearing_cases_discipline_progression_idx
  ON public.hearing_cases (company_id, employee_id, discipline_progression_id);

CREATE INDEX IF NOT EXISTS hearing_cases_discipline_decision_idx
  ON public.hearing_cases (company_id, employee_id, discipline_decision_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
