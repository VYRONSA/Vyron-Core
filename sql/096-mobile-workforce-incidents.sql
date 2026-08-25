-- ============================================================================
-- sql/096-mobile-workforce-incidents.sql
--
-- GATE D — the fields an employee incident report actually needs.
--
-- WHY THE EXISTING TABLE IS NOT ENOUGH
--
--   mobile_workforce_incidents already carries who, where, a title, a free-text
--   description and a status. That is enough to record that SOMETHING happened.
--   It is not enough to triage it. A control room reading a list of incidents
--   cannot currently tell an injury from a near miss, cannot sort by severity,
--   cannot see whether anybody is still in danger, and cannot tell whether the
--   employee needs emergency services RIGHT NOW.
--
--   Those are the four facts that decide what happens in the next sixty seconds,
--   so they become columns rather than prose somebody has to read and interpret.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   No photos table. mobile_workforce_evidence already stores captured media
--   with a storage path, GPS, accuracy and a capture time, and its
--   evidence_type CHECK already permits 'incident'. Incident photographs are
--   therefore evidence rows carrying metadata.incidentId — the same pattern the
--   Road & Recovery notifications use to ride an existing CHECK rather than
--   widening one. One evidence store, one upload lifecycle, one set of rules.
--
-- TWO CLOCKS, DELIBERATELY
--
--   created_at is SERVER time: when the report reached us. It is authoritative
--   and nothing the device says can move it.
--
--   occurred_at is the EMPLOYEE'S assertion of when the incident happened. It
--   has to be client-supplied, because only the person who was there knows —
--   and an incident reported from a dead zone two hours later must not be
--   recorded as having happened when the signal returned. It is kept separate
--   from created_at precisely so nobody can mistake an assertion for a
--   measurement. See the same distinction in the Road & Recovery outbox, where
--   operational timestamps are server-stamped and clientReportedAt is telemetry.
--
-- Additive only: every column is nullable or defaulted, so existing rows and
-- every existing reader keep working untouched.
--
-- Idempotent and transactional: safe to re-run, all-or-nothing.
-- Rollback: sql/096-rollback.sql
-- ============================================================================

BEGIN;

ALTER TABLE public.mobile_workforce_incidents
  -- What kind of incident. Drives triage, routing and reporting.
  ADD COLUMN IF NOT EXISTS category text,

  -- How bad. Drives the order a control room works the list in.
  ADD COLUMN IF NOT EXISTS severity text,

  -- Metres of uncertainty on the recorded position. Null when the device could
  -- not produce a fix at all — never zero, which would read as pinpoint accuracy.
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric(10,2),

  -- When the employee says it happened. See "two clocks" above.
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,

  -- Who else was there, in the employee's own words. Free text on purpose: at a
  -- scene, forcing a structured person-picker costs time nobody has.
  ADD COLUMN IF NOT EXISTS people_involved text,

  -- Is anybody still at risk right now?
  ADD COLUMN IF NOT EXISTS immediate_danger boolean NOT NULL DEFAULT false,

  -- Does this need emergency services dispatched?
  ADD COLUMN IF NOT EXISTS emergency_required boolean NOT NULL DEFAULT false,

  -- Room for device and app context (app version, platform, draft id) without
  -- another migration every time the app learns to record one more thing.
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Constraints ─────────────────────────────────────────────────────────────
--
-- Both are NULL-tolerant. An incident reported before the app offered a
-- category must still be storable, and a half-finished draft must not be
-- rejected by the database when the employee is standing in the rain.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mobile_workforce_incidents'::regclass
      AND conname = 'mobile_workforce_incidents_category_check'
  ) THEN
    ALTER TABLE public.mobile_workforce_incidents
      ADD CONSTRAINT mobile_workforce_incidents_category_check
      CHECK (category IS NULL OR category IN (
        'accident','injury','near_miss','vehicle','equipment_damage',
        'unsafe_condition','security','environmental','customer','other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mobile_workforce_incidents'::regclass
      AND conname = 'mobile_workforce_incidents_severity_check'
  ) THEN
    ALTER TABLE public.mobile_workforce_incidents
      ADD CONSTRAINT mobile_workforce_incidents_severity_check
      CHECK (severity IS NULL OR severity IN ('low','medium','high','critical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mobile_workforce_incidents'::regclass
      AND conname = 'mobile_workforce_incidents_gps_accuracy_check'
  ) THEN
    ALTER TABLE public.mobile_workforce_incidents
      ADD CONSTRAINT mobile_workforce_incidents_gps_accuracy_check
      CHECK (gps_accuracy IS NULL OR gps_accuracy >= 0);
  END IF;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The control room's working view: this company's incidents that still need
-- somebody, worst first. Partial, because closed incidents are history and do
-- not belong in an operational index.
CREATE INDEX IF NOT EXISTS idx_mobile_incidents_triage
  ON public.mobile_workforce_incidents (company_id, severity, created_at DESC)
  WHERE status IN ('submitted', 'reviewing');

-- "Show me my incidents" on the employee's own phone.
CREATE INDEX IF NOT EXISTS idx_mobile_incidents_employee
  ON public.mobile_workforce_incidents (company_id, employee_id, created_at DESC);

-- The two flags that mean somebody may still be in danger. Tiny partial index;
-- this is the query a supervisor runs when they walk in and ask "anything live?"
CREATE INDEX IF NOT EXISTS idx_mobile_incidents_urgent
  ON public.mobile_workforce_incidents (company_id, created_at DESC)
  WHERE immediate_danger OR emergency_required;

-- ── Finding an incident's photographs ───────────────────────────────────────
--
-- Evidence rows carry metadata.incidentId. Without this the lookup is a
-- sequential scan of every evidence row the company has ever captured.
CREATE INDEX IF NOT EXISTS idx_mobile_evidence_incident
  ON public.mobile_workforce_evidence ((metadata ->> 'incidentId'))
  WHERE metadata ? 'incidentId';

COMMENT ON COLUMN public.mobile_workforce_incidents.occurred_at IS
  'When the EMPLOYEE says the incident happened. Client-asserted by necessity; '
  'created_at remains the authoritative server record of when it was reported.';

COMMENT ON COLUMN public.mobile_workforce_incidents.gps_accuracy IS
  'Metres of uncertainty. NULL when no fix was available — never 0, which would '
  'read as a perfect position.';

COMMIT;

NOTIFY pgrst, 'reload schema';
