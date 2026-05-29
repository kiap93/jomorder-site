-- ==========================================
-- BASKET ENGINE RECOVERY SCRIPT
-- Fixes PGRST203 (function overloading conflict)
-- Adds basket_version column
-- ==========================================

-- 1. CLEANUP OVERLOADED FUNCTIONS
-- Postgres requires explicit matches for DROP FUNCTION if overloaded
DO $$ 
BEGIN
    DROP FUNCTION IF EXISTS public.sync_basket_item(UUID, UUID, INTEGER, JSONB, TEXT, TEXT, TEXT);
    DROP FUNCTION IF EXISTS public.sync_basket_item(UUID, UUID, INTEGER, JSONB, TEXT, TEXT, INTEGER, TEXT);
    DROP FUNCTION IF EXISTS public.sync_basket_item(UUID, UUID, INTEGER, JSONB, TEXT, TEXT);
    DROP FUNCTION IF EXISTS public.sync_basket_item(UUID, UUID, INTEGER, JSONB, TEXT, TEXT, INTEGER);
END $$;

-- 2. SCHEMA UPDATE: ADD basket_version
ALTER TABLE public.baskets ADD COLUMN IF NOT EXISTS basket_version INTEGER DEFAULT 0;

-- 3. UNIFIED ATOMIC BASKET OPERATION
CREATE OR REPLACE FUNCTION public.sync_basket_item(
    p_session_id UUID,
    p_product_id UUID,
    p_delta INTEGER DEFAULT NULL,
    p_quantity INTEGER DEFAULT NULL,
    p_configuration JSONB DEFAULT '{}'::jsonb,
    p_special_instructions TEXT DEFAULT NULL,
    p_device_info TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL -- Added for token validation
) RETURNS JSONB AS $$
DECLARE
    v_basket_id UUID;
    v_item RECORD;
    v_new_qty INTEGER;
    v_version INTEGER;
BEGIN
    -- 0. Validate Session Token
    IF NOT EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = p_session_id AND session_token = p_session_token
        AND status IN ('active', 'awaiting_payment', 'paid')
    ) THEN
        RAISE EXCEPTION 'Invalid or expired session token';
    END IF;

    -- Advisory lock for concurrency safety on this session
    PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text));

    -- 1. Find or create active basket for session
    SELECT id, basket_version INTO v_basket_id, v_version 
    FROM public.baskets 
    WHERE session_id = p_session_id AND status = 'active'
    LIMIT 1;

    IF v_basket_id IS NULL THEN
        INSERT INTO public.baskets (restaurant_id, session_id, status, basket_version)
        SELECT restaurant_id, id, 'active', 0
        FROM public.dining_sessions WHERE id = p_session_id
        RETURNING id, basket_version INTO v_basket_id, v_version;
    END IF;

    -- 2. Find existing item if any
    SELECT * INTO v_item FROM public.basket_items
    WHERE basket_id = v_basket_id
      AND product_id = p_product_id
      AND configuration = p_configuration
    FOR UPDATE;

    -- 3. Determine new quantity (Absolute quantity takes precedence if provided)
    IF p_quantity IS NOT NULL THEN
        v_new_qty := p_quantity;
    ELSIF p_delta IS NOT NULL THEN
        v_new_qty := COALESCE(v_item.quantity, 0) + p_delta;
    ELSE
        -- Default: Increment by 1
        v_new_qty := COALESCE(v_item.quantity, 0) + 1;
    END IF;

    -- 4. Process deletion if quantity <= 0
    IF v_new_qty <= 0 THEN
        IF v_item.id IS NOT NULL THEN
            DELETE FROM public.basket_items WHERE id = v_item.id;
        END IF;
    -- 5. Insert or Update
    ELSIF v_item.id IS NOT NULL THEN
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

    -- 6. Increment basket version for synchronization
    UPDATE public.baskets 
    SET basket_version = basket_version + 1, updated_at = now()
    WHERE id = v_basket_id
    RETURNING basket_version INTO v_version;

    -- Return JSON result for UI consumption
    RETURN jsonb_build_object(
        'item', to_jsonb(v_item),
        'basket_version', v_version,
        'basket_id', v_basket_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
