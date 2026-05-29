-- ==========================================
-- ORDER ENGINE RECOVERY SCRIPT
-- Fixes missing columns in orders table
-- Ensures RLS compatibility for guest access
-- ==========================================

-- 1. SCHEMA UPDATES FOR orders TABLE
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.dining_sessions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS order_type TEXT,
ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
ADD COLUMN IF NOT EXISTS session_token TEXT; -- Added for extra verification

-- 2. ADD UNIQUE CONSTRAINT FOR IDEMPOTENCY
-- This prevents accidental double-submission of the same order
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_idempotency_key_key') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);
    END IF;
END $$;

-- 3. HARDEN RLS FOR orders (GUEST ACCESS)
-- Since locking is disabled for guests, we rely on session_token or just open create
-- But for actual security, we should validate the session_id belongs to the table
DROP POLICY IF EXISTS "Everyone can create orders." ON public.orders;
CREATE POLICY "Everyone can create orders." ON public.orders 
FOR INSERT WITH CHECK (
    -- Allow insertion if session_id is provided and valid
    (session_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = session_id AND status NOT IN ('closed', 'replaced', 'expired')
    ))
    OR 
    -- Or if it's a staff member (authenticated)
    auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "Everyone can view orders." ON public.orders;
CREATE POLICY "Everyone can view orders." ON public.orders 
FOR SELECT USING (
    (session_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = session_id AND status NOT IN ('closed', 'replaced', 'expired')
    ))
    OR 
    auth.role() = 'authenticated'
);

-- 4. UTILITY FUNCTION FOR ATOMIC ORDER PLACEMENT
-- This is safer than direct insert for high-concurrency environments
CREATE OR REPLACE FUNCTION public.place_order_v2(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_session_id UUID,
    p_order_type TEXT,
    p_items JSONB,
    p_total_price NUMERIC,
    p_payment_method TEXT,
    p_idempotency_key TEXT,
    p_session_token TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_order_id UUID;
    v_basket_id UUID;
BEGIN
    -- 0. Validate Session
    IF NOT EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = p_session_id 
        AND (p_session_token IS NULL OR session_token = p_session_token)
        AND status NOT IN ('closed', 'replaced', 'expired')
    ) THEN
        RAISE EXCEPTION 'Invalid or expired dining session';
    END IF;

    -- 1. Create the Order
    INSERT INTO public.orders (
        restaurant_id, 
        table_id, 
        session_id, 
        order_type, 
        items, 
        total_price, 
        payment_method, 
        idempotency_key,
        session_token,
        status
    )
    VALUES (
        p_restaurant_id, 
        p_table_id, 
        p_session_id, 
        p_order_type, 
        p_items, 
        p_total_price, 
        p_payment_method, 
        p_idempotency_key,
        p_session_token,
        'pending'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_order_id;

    -- 2. If order created, submit the basket
    IF v_order_id IS NOT NULL THEN
        UPDATE public.baskets 
        SET status = 'submitted', updated_at = now() 
        WHERE session_id = p_session_id AND status = 'active';
    ELSE
        -- Return existing order if it was already created (idempotency)
        SELECT id INTO v_order_id FROM public.orders WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'status', 'success'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
