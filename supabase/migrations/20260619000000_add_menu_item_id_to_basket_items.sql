-- Migration: Add menu_item_id to basket_items
-- Created: 2026-06-19

-- 1. Add menu_item_id column referencing public.menu_items(id)
ALTER TABLE public.basket_items 
ADD COLUMN IF NOT EXISTS menu_item_id UUID REFERENCES public.menu_items(id) ON DELETE CASCADE;

-- 2. Backfill existing records from product_id to menu_item_id to prevent any lost relationships
UPDATE public.basket_items 
SET menu_item_id = product_id 
WHERE menu_item_id IS NULL AND product_id IS NOT NULL;

-- 3. Create a performance index on the new column
CREATE INDEX IF NOT EXISTS idx_basket_items_menu_item ON public.basket_items(menu_item_id);

-- 4. Create trigger to keep both columns synchronized automatically (highly recommended for backwards compatibility)
CREATE OR REPLACE FUNCTION public.sync_basket_items_menu_item_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.menu_item_id IS NULL AND NEW.product_id IS NOT NULL THEN
        NEW.menu_item_id := NEW.product_id;
    ELSIF NEW.product_id IS NULL AND NEW.menu_item_id IS NOT NULL THEN
        NEW.product_id := NEW.menu_item_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_basket_items_menu_item_id ON public.basket_items;
CREATE TRIGGER trg_sync_basket_items_menu_item_id
    BEFORE INSERT OR UPDATE ON public.basket_items
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_basket_items_menu_item_id();
