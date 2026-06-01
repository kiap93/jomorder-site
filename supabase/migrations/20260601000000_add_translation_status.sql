-- Migration to track translation statuses
ALTER TABLE public.tenant_translations ADD COLUMN IF NOT EXISTS translation_status TEXT DEFAULT 'pending';
