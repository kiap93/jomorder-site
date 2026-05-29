-- ==========================================
-- SERVER-SIDE BASKET ARCHITECTURE (SUPABASE)
-- Multi-tenant, Collaborative, Real-time
-- ==========================================

-- 1. TABLES
CREATE TABLE IF NOT EXISTS public.baskets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.dining_sessions(id) ON DELETE CASCADE,
    status TEXT CHECK (status IN ('active', 'locked', 'submitted', 'abandoned', 'expired', 'merged')) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.basket_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    basket_id UUID NOT NULL REFERENCES public.baskets(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.menu_items(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    configuration JSONB DEFAULT '{}'::jsonb, -- Store choices like modifiers, combos
    special_instructions TEXT,
    created_by_device TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. INDEXING
CREATE INDEX IF NOT EXISTS idx_baskets_session ON public.baskets(session_id);
CREATE INDEX IF NOT EXISTS idx_basket_items_basket ON public.basket_items(basket_id);

-- 3. RLS POLICIES
ALTER TABLE public.baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basket_items ENABLE ROW LEVEL SECURITY;

-- Baskets access: via session token in headers or auth for staff
DROP POLICY IF EXISTS "Anyone with session access can read basket" ON public.baskets;
CREATE POLICY "Anyone with session access can read basket"
ON public.baskets FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.dining_sessions
        WHERE id = public.baskets.session_id
        AND (
            -- Simplified for this environment: allow if session exists and is not closed
            status NOT IN ('closed', 'replaced')
        )
    )
);

DROP POLICY IF EXISTS "Anyone with session access can read basket items" ON public.basket_items;
CREATE POLICY "Anyone with session access can read basket items"
ON public.basket_items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.baskets b
        JOIN public.dining_sessions s ON s.id = b.session_id
        WHERE b.id = public.basket_items.basket_id
        AND s.status NOT IN ('closed', 'replaced')
    )
);

-- 4. ATOMIC BASKET OPERATIONS (RPC)

-- Function: sync_basket_item
-- Purpose: Add/Update/Delete item from basket with concurrency safety
CREATE OR REPLACE FUNCTION public.sync_basket_item(
    p_session_id UUID,
    p_product_id UUID,
    p_quantity INTEGER DEFAULT NULL, -- Absolute quantity to set
    p_configuration JSONB DEFAULT '{}'::jsonb,
    p_special_instructions TEXT DEFAULT NULL,
    p_device_info TEXT DEFAULT NULL,
    p_delta INTEGER DEFAULT NULL -- Relative change (e.g. +1, -1)
) RETURNS public.basket_items AS $$
DECLARE
    v_basket_id UUID;
    v_item public.basket_items;
    v_new_qty INTEGER;
BEGIN
    -- Use advisory lock to prevent race conditions on the same session's basket
    PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text));

    -- 1. Ensure active basket exists for session
    SELECT id INTO v_basket_id FROM public.baskets 
    WHERE session_id = p_session_id AND status = 'active'
    LIMIT 1;

    IF v_basket_id IS NULL THEN
        INSERT INTO public.baskets (restaurant_id, session_id, status)
        SELECT restaurant_id, id, 'active'
        FROM public.dining_sessions WHERE id = p_session_id
        RETURNING id INTO v_basket_id;
    END IF;

    -- 2. Find existing item if any
    SELECT * INTO v_item FROM public.basket_items
    WHERE basket_id = v_basket_id
      AND product_id = p_product_id
      AND configuration = p_configuration
    FOR UPDATE;

    -- 3. Determine new quantity
    IF p_delta IS NOT NULL THEN
        v_new_qty := COALESCE(v_item.quantity, 0) + p_delta;
    ELSE
        v_new_qty := p_quantity;
    END IF;

    -- 4. Process deletion if quantity becomes 0 or less
    IF v_new_qty <= 0 THEN
        IF v_item.id IS NOT NULL THEN
            DELETE FROM public.basket_items WHERE id = v_item.id;
        END IF;
        RETURN NULL;
    END IF;

    -- 5. Insert or Update
    IF v_item.id IS NOT NULL THEN
        UPDATE public.basket_items
        SET quantity = v_new_qty, 
            special_instructions = COALESCE(p_special_instructions, v_item.special_instructions),
            created_at = now()
        WHERE id = v_item.id
        RETURNING * INTO v_item;
    ELSE
        INSERT INTO public.basket_items (
            basket_id, product_id, quantity, configuration, special_instructions, created_by_device
        )
        VALUES (
            v_basket_id, p_product_id, v_new_qty, p_configuration, p_special_instructions, p_device_info
        )
        RETURNING * INTO v_item;
    END IF;

    RETURN v_item;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: submit_basket
CREATE OR REPLACE FUNCTION public.submit_basket(p_basket_id UUID) 
RETURNS VOID AS $$
BEGIN
    UPDATE public.baskets SET status = 'submitted', updated_at = now() WHERE id = p_basket_id AND status = 'active';
    -- The next call to sync_basket_item will automatically create a new active basket for the session.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: clear_session_basket
CREATE OR REPLACE FUNCTION public.clear_session_basket(p_session_id UUID) 
RETURNS VOID AS $$
BEGIN
    DELETE FROM public.basket_items
    WHERE basket_id IN (SELECT id FROM public.baskets WHERE session_id = p_session_id AND status = 'active');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
