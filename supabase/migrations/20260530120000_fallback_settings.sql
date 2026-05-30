-- Support translation fallback setting on restaurants
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS fallback_to_original BOOLEAN DEFAULT TRUE;
