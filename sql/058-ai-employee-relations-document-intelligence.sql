-- 058-ai-employee-relations-document-intelligence.sql
-- Batch 8: Structured AI Employee Relations & Document Intelligence lifecycle fields.
-- Safe to rerun.

BEGIN;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'draft';

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS prompt_template_snapshot text;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS model_parameters jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS confidence_score numeric(5,2);

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS reviewed_by text;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS finalised_at timestamptz;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS saved_source_table text;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS saved_document_id uuid;

DO $$
BEGIN
  IF to_regclass('public.employee_documents') IS NULL THEN
    RAISE NOTICE 'Prerequisite missing: public.employee_documents. saved_document_id foreign key will be added when employee_documents exists.';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_document_generations_saved_document_id_fkey'
  ) THEN
    ALTER TABLE public.ai_document_generations
      ADD CONSTRAINT ai_document_generations_saved_document_id_fkey
      FOREIGN KEY (saved_document_id)
      REFERENCES public.employee_documents (id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS save_version integer NOT NULL DEFAULT 0;

ALTER TABLE public.ai_document_generations
  ADD COLUMN IF NOT EXISTS error_message text;

CREATE INDEX IF NOT EXISTS ai_document_generations_status_idx
  ON public.ai_document_generations (company_id, generation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_document_generations_case_idx
  ON public.ai_document_generations (company_id, hr_case_id, hearing_case_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
