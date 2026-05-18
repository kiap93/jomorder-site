-- ==========================================
-- FINAL QR ENGINE (GUEST FOCUS)
-- This script hardens the guest ordering flow
-- ==========================================

-- 1. Hardened Session Resolution
CREATE OR REPLACE FUNCTION public.resolve_dining_session_v2(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_client_token TEXT DEFAULT NULL,
    p_fulfillment TEXT DEFAULT 'dine_in',
    p_device_info TEXT DEFAULT NULL
) RETURNS TABLE (
    session_id UUID,
    token TEXT,
    session_status TEXT,
    is_new BOOLEAN
) AS $$
DECLARE
    v_session_id UUID;
    v_token TEXT;
    v_status TEXT;
    v_is_new BOOLEAN := false;
BEGIN
    -- 1. Validate tokens from client (Reconnection)
    IF p_client_token IS NOT NULL AND p_client_token != '' THEN
        SELECT id, session_token, status INTO v_session_id, v_token, v_status
        FROM public.dining_sessions
        WHERE session_token = p_client_token
          AND table_id = p_table_id
          AND status IN ('active', 'awaiting_payment', 'paid')
        LIMIT 1;
        
        IF v_session_id IS NOT NULL THEN
            UPDATE public.dining_sessions SET last_activity_at = now() WHERE id = v_session_id;
            RETURN QUERY SELECT v_session_id, v_token, v_status, false;
            RETURN;
        END IF;
    END IF;

    -- 2. Validate session by Table (Shared Window)
    -- Look for a session that started within the last 18 hours and is still active
    SELECT id, session_token, status INTO v_session_id, v_token, v_status
    FROM public.dining_sessions
    WHERE table_id = p_table_id 
      AND restaurant_id = p_restaurant_id
      AND status IN ('active', 'awaiting_payment')
      AND (last_activity_at > (now() - interval '18 hours') OR started_at > (now() - interval '18 hours'))
    ORDER BY started_at DESC
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
        UPDATE public.dining_sessions SET last_activity_at = now() WHERE id = v_session_id;
        RETURN QUERY SELECT v_session_id, v_token, v_status, false;
        RETURN;
    END IF;

    -- 3. Create New if nothing matched
    -- Close any truly dangling sessions
    UPDATE public.dining_sessions SET status = 'replaced', closed_at = now() 
    WHERE table_id = p_table_id AND status IN ('active', 'awaiting_payment');

    v_token := lower(encode(gen_random_bytes(16), 'hex'));
    v_is_new := true;

    INSERT INTO public.dining_sessions (
        restaurant_id, table_id, session_token, status, fulfillment_type, 
        created_by_device, started_at, last_activity_at
    )
    VALUES (
        p_restaurant_id, p_table_id, v_token, 'active', p_fulfillment, 
        p_device_info, now(), now()
    )
    RETURNING id, session_token, status INTO v_session_id, v_token, v_status;

    RETURN QUERY SELECT v_session_id, v_token, v_status, v_is_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Hardened Basket Sync
CREATE OR REPLACE FUNCTION public.sync_basket_item_v2(
    p_session_id UUID,
    p_session_token TEXT,
    p_product_id UUID,
    p_delta INTEGER,
    p_configuration JSONB DEFAULT '{}'::jsonb,
    p_device_info TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_basket_id UUID;
    v_new_qty INTEGER;
BEGIN
    -- 0. Token Validation (Mandatory for Guests)
    IF NOT EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = p_session_id AND session_token = p_session_token
        AND status IN ('active', 'awaiting_payment', 'paid')
    ) THEN
        RAISE EXCEPTION 'Invalid dining session token';
    END IF;

    -- Get or Create Basket
    SELECT id INTO v_basket_id FROM public.baskets 
    WHERE session_id = p_session_id AND status = 'active' LIMIT 1;

    IF v_basket_id IS NULL THEN
        INSERT INTO public.baskets (session_id, status, basket_version)
        VALUES (p_session_id, 'active', 1)
        RETURNING id INTO v_basket_id;
    END IF;

    -- Merge Logic
    IF EXISTS (SELECT 1 FROM public.basket_items WHERE basket_id = v_basket_id AND menu_item_id = p_product_id AND configuration = p_configuration) THEN
        UPDATE public.basket_items 
        SET quantity = GREATEST(0, quantity + p_delta), updated_at = now()
        WHERE basket_id = v_basket_id AND menu_item_id = p_product_id AND configuration = p_configuration
        RETURNING quantity INTO v_new_qty;
        
        IF v_new_qty = 0 THEN
            DELETE FROM public.basket_items WHERE basket_id = v_basket_id AND menu_item_id = p_product_id AND configuration = p_configuration;
        END IF;
    ELSIF p_delta > 0 THEN
        INSERT INTO public.basket_items (basket_id, menu_item_id, quantity, configuration)
        VALUES (v_basket_id, p_product_id, p_delta, p_configuration)
        RETURNING quantity INTO v_new_qty;
    END IF;

    -- Bump Version
    UPDATE public.baskets SET basket_version = basket_version + 1, updated_at = now() WHERE id = v_basket_id;

    RETURN jsonb_build_object('basket_id', v_basket_id, 'new_quantity', v_new_qty);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Hardened Order Placement
CREATE OR REPLACE FUNCTION public.place_order_v3(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_session_id UUID,
    p_session_token TEXT,
    p_order_type TEXT,
    p_items JSONB,
    p_total_price NUMERIC,
    p_payment_method TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB AS $$
DECLARE
    v_order_id UUID;
BEGIN
    -- 0. Token Validation
    IF NOT EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = p_session_id AND session_token = p_session_token
        AND status IN ('active', 'awaiting_payment')
    ) THEN
        RAISE EXCEPTION 'Session token invalid or session already completed.';
    END IF;

    -- 1. Insert Order
    INSERT INTO public.orders (
        restaurant_id, table_id, session_id, order_type, items, 
        total_price, payment_method, idempotency_key, session_token, status
    )
    VALUES (
        p_restaurant_id, p_table_id, p_session_id, p_order_type, p_items, 
        p_total_price, p_payment_method, p_idempotency_key, p_session_token, 'pending'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_order_id;

    -- 2. Mark basket as submitted (Atomic)
    IF v_order_id IS NOT NULL THEN
        UPDATE public.baskets 
        SET status = 'submitted', updated_at = now() 
        WHERE session_id = p_session_id AND status = 'active';
        
        -- Optionally update session status to awaiting_payment if dine_in
        IF p_order_type = 'dine_in' THEN
            UPDATE public.dining_sessions SET status = 'awaiting_payment' WHERE id = p_session_id AND status = 'active';
        END IF;
    ELSE
        SELECT id INTO v_order_id FROM public.orders WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN jsonb_build_object('order_id', v_order_id, 'status', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
