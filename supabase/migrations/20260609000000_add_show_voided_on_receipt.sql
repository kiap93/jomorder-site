-- Migration: Add show_voided_on_receipt column to public.restaurants
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS show_voided_on_receipt BOOLEAN DEFAULT TRUE;
