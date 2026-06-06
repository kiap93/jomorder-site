-- ==========================================
-- ADD DEVICE_INFO & UPDATED_AT TO BASKET_ITEMS
-- Resolves: "column basket_items.device_info does not exist"
-- ==========================================

-- 1. Ensure columns exist on public.basket_items table
ALTER TABLE public.basket_items 
ADD COLUMN IF NOT EXISTS device_info TEXT;

ALTER TABLE public.basket_items 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Backfill existing row values
UPDATE public.basket_items 
SET device_info = created_by_device 
WHERE device_info IS NULL AND created_by_device IS NOT NULL;

UPDATE public.basket_items 
SET updated_at = created_at 
WHERE updated_at IS NULL AND created_at IS NOT NULL;

-- 3. Maintain compatibility by creating a trigger or updating functions if necessary
-- To ensure any insert targeting either 'created_by_device' or 'device_info' mirrors to both:
CREATE OR REPLACE FUNCTION public.sync_basket_items_device_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.device_info IS NULL AND NEW.created_by_device IS NOT NULL THEN
        NEW.device_info := NEW.created_by_device;
    ELSIF NEW.created_by_device IS NULL AND NEW.device_info IS NOT NULL THEN
        NEW.created_by_device := NEW.device_info;
    END IF;
    
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_basket_items_device_columns ON public.basket_items;
CREATE TRIGGER trg_sync_basket_items_device_columns
    BEFORE INSERT OR UPDATE ON public.basket_items
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_basket_items_device_columns();
