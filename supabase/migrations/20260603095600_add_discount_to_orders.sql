-- Migration: Add discount column to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount JSONB DEFAULT NULL;
