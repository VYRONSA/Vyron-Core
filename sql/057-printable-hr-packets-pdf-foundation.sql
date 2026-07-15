-- 057-printable-hr-packets-pdf-foundation.sql
-- Batch 7: Printable HR packets and PDF export history foundation.
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.hr_packet_exports') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.hr_packet_exports. Run 051 first.';
  END IF;

  IF to_regclass('public.employee_relations_timeline_events') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite missing: public.employee_relations_timeline_events. Run 051 first.';
  END IF;
END $$;

ALTER TABLE public.hr_packet_exports
  ADD COLUMN IF NOT EXISTS export_kind text NOT NULL DEFAULT 'packet',
  ADD COLUMN IF NOT EXISTS generated_by text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS documents_included jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS pdf_file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS packet_reference text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS hr_packet_exports_kind_idx
  ON public.hr_packet_exports (company_id, export_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS hr_packet_exports_status_idx
  ON public.hr_packet_exports (company_id, export_status, created_at DESC);

COMMIT;

NOTIFY pgrst, 'reload schema';
