-- 076-road-recovery-custody.sql
-- VYRON CORE — Road & Recovery Phase 4, Step 2: chain of custody.
--
-- ---------------------------------------------------------------------------
-- CUSTODY IS NOT DESTINATION
-- ---------------------------------------------------------------------------
--
--   destination  WHERE is the vehicle supposed to go?      (rr_service_jobs, since Phase 0)
--   custody      WHO legally or physically possesses it?   (this file)
--
-- The two are never merged. A vehicle can sit at its destination while custody has already
-- passed to the owner; it can be in our custody a hundred kilometres from any destination;
-- and a destination change does not move possession. Overloading one field with both
-- questions is how a recovery operator loses a dispute.
--
-- ---------------------------------------------------------------------------
-- THE EVENT LOG IS AUTHORITATIVE
-- ---------------------------------------------------------------------------
--
-- rr_custody_events is APPEND-ONLY and is the only source of truth. rr_custody_holdings is
-- a PROJECTION maintained by trigger from those events — convenient for "who has it right
-- now", never the record of what happened. If the two ever disagree, the events win, and
-- the projection can be rebuilt from them.
--
-- Two-layer enforcement, as established in Phases 0-3:
--   narrow grants (SELECT, INSERT)  +  a BEFORE UPDATE OR DELETE trigger
-- The trigger is bound to the TABLE, so it also stops service_role, which bypasses RLS.
--
-- ON DELETE RESTRICT against rr_service_jobs: a custody chain is a legal record and is
-- never cascaded away, exactly like rr_authorisations (sql/071).
--
-- Idempotent and safe to re-run. Requires sql/070, sql/071 and sql/031 (mobile evidence).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $prereq$
BEGIN
  IF to_regclass('public.rr_service_jobs') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.rr_service_jobs. Run sql/070 before sql/076.';
  END IF;
  IF to_regclass('public.mobile_workforce_evidence') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.mobile_workforce_evidence. Run sql/031 before sql/076.';
  END IF;
END
$prereq$;

-- ---------------------------------------------------------------------------
-- 1. rr_custody_yards — the facilities
-- ---------------------------------------------------------------------------
--
-- A yard is a place possession can rest. It is deliberately NOT a destination: a job's
-- destination may be a panel beater or an owner's home, neither of which is a yard, and a
-- vehicle may pass through a yard that was never its destination.
CREATE TABLE IF NOT EXISTS public.rr_custody_yards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  yard_code text NOT NULL,
  name text NOT NULL,
  address text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),

  /** Physical protection offered. Drives what a stored vehicle can be charged for. */
  security_level text NOT NULL DEFAULT 'secure',
  covered boolean NOT NULL DEFAULT false,
  capacity integer,
  operating_hours text,

  contact_name text,
  contact_number text,

  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_custody_yards_code_unique UNIQUE (company_id, yard_code),
  CONSTRAINT rr_custody_yards_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_custody_yards_code_format CHECK (yard_code ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT rr_custody_yards_security_check CHECK (
    security_level IN ('open', 'fenced', 'secure', 'high_security')
  ),
  CONSTRAINT rr_custody_yards_capacity_check CHECK (capacity IS NULL OR capacity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rr_custody_yards_active
  ON public.rr_custody_yards (company_id, active, name);

COMMENT ON TABLE public.rr_custody_yards IS
  'Facilities where custody of a vehicle can rest. Distinct from a job destination: a destination says where a vehicle should go, a yard is a place possession is held.';

-- ---------------------------------------------------------------------------
-- 2. rr_custody_events — APPEND-ONLY, the legal spine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rr_custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- RESTRICT: a job with a custody chain cannot be deleted out from under it.
  service_job_id uuid NOT NULL REFERENCES public.rr_service_jobs (id) ON DELETE RESTRICT,

  /** taken = first possession · transferred = possession moved · released = chain ends. */
  event_type text NOT NULL,
  /** Server-stamped. Never supplied by a caller. */
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- --- Who is handing over ------------------------------------------------
  actor_email text NOT NULL,
  actor_employee_id uuid,
  actor_role text NOT NULL DEFAULT 'driver',

  -- --- Who now holds the vehicle -------------------------------------------
  holder_type text NOT NULL,
  holder_name text NOT NULL,
  yard_id uuid,

  -- --- Who physically received it ------------------------------------------
  --
  -- The single most contested fact in a recovery dispute. A release must name a person,
  -- their capacity to receive, and ideally proof of identity.
  receiving_party_name text,
  receiving_party_capacity text,
  receiving_party_id_number text,
  receiving_party_contact text,

  -- --- Where, and on whose authority ---------------------------------------
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  location_label text,
  /** The release/disposal authority this handover was performed under, when there was one. */
  authority_id uuid,

  /** Signature, photograph or handover form in the EXISTING evidence repository. */
  evidence_id uuid REFERENCES public.mobile_workforce_evidence (id) ON DELETE SET NULL,

  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_custody_events_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_custody_events_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_custody_events_yard_fk
    FOREIGN KEY (company_id, yard_id)
    REFERENCES public.rr_custody_yards (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_custody_events_type_check CHECK (
    event_type IN ('taken', 'transferred', 'released', 'disputed')
  ),
  CONSTRAINT rr_custody_events_holder_check CHECK (
    holder_type IN ('operator', 'yard', 'owner', 'insurer', 'finance_house',
                    'fleet_operator', 'saps', 'third_party', 'disposal_agent')
  ),
  CONSTRAINT rr_custody_events_actor_role_check CHECK (
    actor_role IN ('driver', 'controller', 'yard_operator', 'manager', 'system')
  ),
  -- Custody resting at a yard must say WHICH yard.
  CONSTRAINT rr_custody_events_yard_named CHECK (
    holder_type <> 'yard' OR yard_id IS NOT NULL
  ),
  -- A release ends the chain by handing the vehicle to a named person in a stated
  -- capacity. Recording that is the entire purpose of the log.
  CONSTRAINT rr_custody_events_release_recorded CHECK (
    event_type <> 'released'
    OR (receiving_party_name IS NOT NULL AND receiving_party_capacity IS NOT NULL)
  ),
  -- A dispute without a reason is unusable.
  CONSTRAINT rr_custody_events_dispute_explained CHECK (
    event_type <> 'disputed' OR reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_custody_events_job
  ON public.rr_custody_events (company_id, service_job_id, occurred_at);

COMMENT ON TABLE public.rr_custody_events IS
  'APPEND-ONLY chain of custody. The authoritative record of who possessed a vehicle, when, where, received by whom and under what authority. Never edited: a correction is a new event. rr_custody_holdings is a projection of this table, not a substitute for it.';

CREATE OR REPLACE FUNCTION public.rr_custody_events_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $forbid$
BEGIN
  RAISE EXCEPTION
    'public.rr_custody_events is an append-only legal record: % is not permitted. Record a correcting custody event instead.',
    TG_OP;
END
$forbid$;

DROP TRIGGER IF EXISTS rr_custody_events_append_only ON public.rr_custody_events;

CREATE TRIGGER rr_custody_events_append_only
  BEFORE UPDATE OR DELETE ON public.rr_custody_events
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_custody_events_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. rr_custody_holdings — the projection
-- ---------------------------------------------------------------------------
--
-- Maintained BY TRIGGER from the event log, so the two cannot drift through application
-- error. Rebuildable at any time by replaying events; carries no fact of its own.
CREATE TABLE IF NOT EXISTS public.rr_custody_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  holder_type text NOT NULL,
  holder_name text NOT NULL,
  yard_id uuid,
  /** True once a 'released' event has ended the chain. */
  released boolean NOT NULL DEFAULT false,

  since timestamptz NOT NULL,
  last_event_id uuid NOT NULL,
  event_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_custody_holdings_job_unique UNIQUE (company_id, service_job_id),
  CONSTRAINT rr_custody_holdings_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_custody_holdings_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_custody_holdings_yard_fk
    FOREIGN KEY (company_id, yard_id)
    REFERENCES public.rr_custody_yards (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_custody_holdings_event_fk
    FOREIGN KEY (company_id, last_event_id)
    REFERENCES public.rr_custody_events (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_custody_holdings_count_check CHECK (event_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_rr_custody_holdings_holder
  ON public.rr_custody_holdings (company_id, holder_type, released);

COMMENT ON TABLE public.rr_custody_holdings IS
  'PROJECTION of rr_custody_events: who holds each vehicle right now. Maintained by trigger and rebuildable by replaying the event log. The event log is authoritative; this table is a convenience.';

CREATE OR REPLACE FUNCTION public.rr_custody_project_holding()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER because rr_custody_holdings is deliberately NOT writable by a tenant
-- user: the projection must only ever be written by this trigger, from an event that was
-- itself accepted. Without it the trigger would run with the caller's rights and every
-- custody event would fail on "permission denied for table rr_custody_holdings".
--
-- Safe: it takes no arguments, reads only NEW, writes only the projection row for the
-- company_id already on the event, and pins its search_path.
SECURITY DEFINER
SET search_path = public
AS $project$
BEGIN
  -- A dispute records a contested fact; it does not move possession, so the projection
  -- of "who holds it" is unchanged. The event itself remains in the log.
  IF NEW.event_type = 'disputed' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.rr_custody_holdings AS h
    (company_id, service_job_id, holder_type, holder_name, yard_id, released,
     since, last_event_id, event_count)
  VALUES
    (NEW.company_id, NEW.service_job_id, NEW.holder_type, NEW.holder_name, NEW.yard_id,
     NEW.event_type = 'released', NEW.occurred_at, NEW.id, 1)
  ON CONFLICT (company_id, service_job_id) DO UPDATE
    SET holder_type   = EXCLUDED.holder_type,
        holder_name   = EXCLUDED.holder_name,
        yard_id       = EXCLUDED.yard_id,
        released      = EXCLUDED.released,
        since         = EXCLUDED.since,
        last_event_id = EXCLUDED.last_event_id,
        event_count   = h.event_count + 1,
        updated_at    = now();

  RETURN NEW;
END
$project$;

DROP TRIGGER IF EXISTS rr_custody_events_project ON public.rr_custody_events;

CREATE TRIGGER rr_custody_events_project
  AFTER INSERT ON public.rr_custody_events
  FOR EACH ROW
  EXECUTE FUNCTION public.rr_custody_project_holding();

-- ---------------------------------------------------------------------------
-- 4. rr_custody_items — keys, documents, belongings
-- ---------------------------------------------------------------------------
--
-- What came with the vehicle, and what left with it. Recorded against the custody EVENT
-- that received it and, once handed over, against the event that released it — so the
-- question "did we return the spare key" has an answer with a timestamp and a name on it.
CREATE TABLE IF NOT EXISTS public.rr_custody_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  service_job_id uuid NOT NULL,

  item_type text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  item_condition text,

  /** The custody event at which this item came into our possession. */
  received_event_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),

  /** Set when the item was handed over. NULL means we still hold it. */
  handed_over_event_id uuid,
  handed_over_at timestamptz,
  handed_over_to_name text,
  handed_over_to_capacity text,

  evidence_id uuid REFERENCES public.mobile_workforce_evidence (id) ON DELETE SET NULL,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rr_custody_items_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT rr_custody_items_job_fk
    FOREIGN KEY (company_id, service_job_id)
    REFERENCES public.rr_service_jobs (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_custody_items_received_event_fk
    FOREIGN KEY (company_id, received_event_id)
    REFERENCES public.rr_custody_events (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT rr_custody_items_handover_event_fk
    FOREIGN KEY (company_id, handed_over_event_id)
    REFERENCES public.rr_custody_events (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT rr_custody_items_type_check CHECK (
    item_type IN ('key', 'document', 'belonging', 'accessory', 'tools', 'number_plate')
  ),
  CONSTRAINT rr_custody_items_quantity_check CHECK (quantity >= 1),
  CONSTRAINT rr_custody_items_condition_check CHECK (
    item_condition IS NULL
    OR item_condition IN ('good', 'fair', 'poor', 'damaged', 'not_inspected')
  ),
  -- A handover names who took it and when. All three facts, or none of them.
  CONSTRAINT rr_custody_items_handover_recorded CHECK (
    (handed_over_at IS NULL AND handed_over_to_name IS NULL AND handed_over_to_capacity IS NULL)
    OR (handed_over_at IS NOT NULL AND handed_over_to_name IS NOT NULL
        AND handed_over_to_capacity IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rr_custody_items_job
  ON public.rr_custody_items (company_id, service_job_id, item_type);

COMMENT ON TABLE public.rr_custody_items IS
  'Keys, documents and personal belongings received with a vehicle and handed over with it. Linked to the custody events that received and released them, so every item has a named recipient and a timestamp.';

-- ---------------------------------------------------------------------------
-- 5. Row level security + tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.rr_custody_yards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_custody_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rr_custody_items ENABLE ROW LEVEL SECURITY;

DO $tenant$
DECLARE
  tbl text;
BEGIN
  IF to_regprocedure('public.vyron_user_company_ids()') IS NULL
     OR to_regprocedure('public.vyron_is_platform_operator()') IS NULL THEN
    RAISE NOTICE
      'Tenant helper functions missing (sql/030). Phase 4 custody tables have RLS enabled with NO policy, which denies all access until sql/030 and then sql/076 are run.';
    RETURN;
  END IF;

  FOR tbl IN
    SELECT unnest(ARRAY[
      'rr_custody_yards',
      'rr_custody_events',
      'rr_custody_holdings',
      'rr_custody_items'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO authenticated USING (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       ) WITH CHECK (
         public.vyron_is_platform_operator()
         OR EXISTS (
           SELECT 1
           FROM public.vyron_user_company_ids() as c(company_id)
           WHERE c.company_id::text = public.%I.company_id::text
         )
       )',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END
$tenant$;

REVOKE ALL ON public.rr_custody_yards FROM anon;
REVOKE ALL ON public.rr_custody_events FROM anon;
REVOKE ALL ON public.rr_custody_holdings FROM anon;
REVOKE ALL ON public.rr_custody_items FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_custody_yards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rr_custody_items TO authenticated;

-- Append-only. See the trigger above.
GRANT SELECT, INSERT ON public.rr_custody_events TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rr_custody_events FROM authenticated;

-- The projection is written by the trigger, which runs with the table owner's rights.
-- A tenant user reads it and never writes it directly: a hand-edited projection would
-- claim a possession the event log does not support.
GRANT SELECT ON public.rr_custody_holdings TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rr_custody_holdings FROM authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
