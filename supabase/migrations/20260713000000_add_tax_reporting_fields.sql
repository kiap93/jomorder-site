-- Migration: Add F&B tax reporting fields to business_settings
-- Created at: 2026-07-13

ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS business_day_close_time VARCHAR(10) DEFAULT '04:00';
