-- 008: Track when an unlimited Demo workspace started (app enforces 30-day tenant access window).
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS demo_started_at timestamptz;
