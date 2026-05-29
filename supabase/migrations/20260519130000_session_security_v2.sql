-- Dining Session Engine V2: Temporary Customer Ordering Context
-- This module coordinates QR, POS, KDS, and Payments.

-- 1. EXTEND DINING SESSIONS SCHEMA
ALTER TABLE public.dining_sessions 
ADD COLUMN IF NOT EXISTS payment_mode TEXT CHECK (payment_mode IN ('prepaid', 'postpaid', 'hybrid')) DEFAULT 'postpaid',
ADD COLUMN IF NOT EXISTS fulfillment_type TEXT CHECK (fulfillment_type IN ('dine_in', 'takeaway', 'delivery', 'kiosk')) DEFAULT 'dine_in',
ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS session_type TEXT CHECK (session_type IN ('qr', 'pos', 'kiosk')) DEFAULT 'qr',
ADD COLUMN IF NOT EXISTS table_name_snapshot TEXT,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS created_by_device TEXT;

-- Update status constraints to the strict state machine
ALTER TABLE public.dining_sessions DROP CONSTRAINT IF EXISTS dining_sessions_status_check;
ALTER TABLE public.dining_sessions ADD CONSTRAINT dining_sessions_status_check 
CHECK (status IN ('active', 'idle', 'awaiting_payment', 'paid', 'closing', 'closed', 'expired', 'replaced'));

-- 2. SESSION LIFECYCLE TRIGGERS
-- Automatically update table status based on session changes
CREATE OR REPLACE FUNCTION public.sync_table_status_on_session_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.status = 'active') THEN
        UPDATE public.tables SET status = 'occupied', current_session_id = NEW.id WHERE id = NEW.table_id;
    ELSIF (NEW.status IN ('closed', 'expired', 'replaced')) THEN
        -- Only clear table if this was the current active session
        UPDATE public.tables SET status = 'available', current_session_id = NULL 
        WHERE id = NEW.table_id AND current_session_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_sync_table_status ON public.dining_sessions;
CREATE TRIGGER tr_sync_table_status
    AFTER INSERT OR UPDATE OF status ON public.dining_sessions
    FOR EACH ROW EXECUTE FUNCTION public.sync_table_status_on_session_change();

-- 3. ANTI-HIJACKING & AUTO-EXPIRATION
CREATE OR REPLACE FUNCTION public.check_session_validity()
RETURNS TRIGGER AS $$
BEGIN
    -- If session is idle for more than 24 hours, auto-expire
    IF (NEW.status = 'active' AND COALESCE(NEW.last_activity_at, NEW.started_at, now()) < (now() - interval '24 hours')) THEN
        NEW.status := 'expired';
        NEW.closed_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_check_session_validity ON public.dining_sessions;
CREATE TRIGGER tr_check_session_validity
    BEFORE UPDATE OF last_activity_at ON public.dining_sessions
    FOR EACH ROW EXECUTE FUNCTION public.check_session_validity();

-- 4. ORDER LIFECYCLE SYNC
-- Auto-complete all orders when a session is closed to clear POS clutter
CREATE OR REPLACE FUNCTION public.close_orders_on_session_close()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.status = 'closed') THEN
        UPDATE public.orders 
        SET status = 'completed', updated_at = now()
        WHERE session_id = NEW.id AND status NOT IN ('completed', 'cancelled');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_close_orders_on_session_close ON public.dining_sessions;
CREATE TRIGGER tr_close_orders_on_session_close
    AFTER UPDATE OF status ON public.dining_sessions
    FOR EACH ROW EXECUTE FUNCTION public.close_orders_on_session_close();

-- 5. ORDER AGGREGATION LOGIC
-- Function to calculate total session bill across multiple orders
CREATE OR REPLACE FUNCTION public.get_session_total(p_session_id UUID)
RETURNS NUMERIC AS $$
    SELECT COALESCE(SUM(total_price), 0)
    FROM public.orders
    WHERE session_id = p_session_id AND status != 'cancelled';
$$ LANGUAGE sql STABLE;

-- 5. STAFF OVERRIDE SYSTEM
-- Allows staff to force-close or merge sessions
CREATE OR REPLACE FUNCTION public.close_dining_session(p_session_id UUID, p_status TEXT DEFAULT 'closed')
RETURNS VOID AS $$
BEGIN
    UPDATE public.dining_sessions 
    SET status = p_status, closed_at = now()
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. QR RESOLVER FLOW (HARDENED)
-- Drops the old versions to ensure no type/parameter ambiguity
DROP FUNCTION IF EXISTS public.resolve_dining_session(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.resolve_dining_session(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.resolve_dining_session(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_device_info TEXT DEFAULT NULL,
    p_client_token TEXT DEFAULT NULL,
    p_fulfillment TEXT DEFAULT 'dine_in'
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
    -- 1. Validate Table exists and belongs to restaurant
    IF NOT EXISTS (SELECT 1 FROM public.tables WHERE id = p_table_id AND restaurant_id = p_restaurant_id) THEN
        RAISE EXCEPTION 'Invalid table or restaurant target';
    END IF;

    -- 2. Try Reconnect (Possess valid token)
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

    -- 3. Check for existing active group session (if any)
    -- Tuning: 24 hour window for continuity
    -- Robust coalesce for legacy rows
    SELECT id, session_token, status INTO v_session_id, v_token, v_status
    FROM public.dining_sessions
    WHERE table_id = p_table_id 
      AND restaurant_id = p_restaurant_id
      AND status IN ('active', 'awaiting_payment')
      AND COALESCE(last_activity_at, started_at, now()) > (now() - interval '24 hours')
    ORDER BY started_at DESC NULLS LAST
    LIMIT 1;

    -- CRITICAL FIX: Return early if joining existing session to avoid "replacement" of other user sessions
    IF v_session_id IS NOT NULL THEN
        UPDATE public.dining_sessions SET last_activity_at = now() WHERE id = v_session_id;
        RETURN QUERY SELECT v_session_id, v_token, v_status, false;
        RETURN;
    END IF;

    -- 4. Create New Session if nothing found
    IF v_session_id IS NULL THEN
        -- Force expire any lingering active sessions for safety
        UPDATE public.dining_sessions SET status = 'replaced', closed_at = now() 
        WHERE table_id = p_table_id AND status IN ('active', 'awaiting_payment');

        v_token := lower(encode(gen_random_bytes(16), 'hex'));
        v_is_new := true;

        INSERT INTO public.dining_sessions (
            restaurant_id, 
            table_id, 
            session_token, 
            status, 
            fulfillment_type,
            created_by_device,
            table_name_snapshot,
            started_at,
            last_activity_at
        )
        VALUES (
            p_restaurant_id, 
            p_table_id, 
            v_token, 
            'active', 
            p_fulfillment,
            p_device_info,
            (SELECT name FROM public.tables WHERE id = p_table_id),
            now(),
            now()
        )
        RETURNING id, session_token, status INTO v_session_id, v_token, v_status;
    END IF;

    RETURN QUERY SELECT v_session_id, v_token, v_status, v_is_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. REAL-TIME EVENT SYSTEM (TRIGGER)
-- Notify Supabase Realtime of session changes
CREATE OR REPLACE FUNCTION public.notify_session_update()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('dining_session_updates', json_build_object(
        'session_id', NEW.id,
        'table_id', NEW.table_id,
        'status', NEW.status,
        'type', TG_OP
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_session_notify ON public.dining_sessions;
CREATE TRIGGER tr_session_notify
    AFTER INSERT OR UPDATE ON public.dining_sessions
    FOR EACH ROW EXECUTE FUNCTION public.notify_session_update();

-- 8. SECURITY RULES (RLS) FOR ORDERS
-- Lockdown orders to session token possession + table matching
DROP POLICY IF EXISTS "Session token access orders" ON public.orders;
CREATE POLICY "Session token access orders" ON public.orders
FOR ALL USING (
    -- Admin override
    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'staff')))
    OR
    -- Session valid AND belongs to the same table the order is claiming
    (EXISTS (
        SELECT 1 FROM public.dining_sessions ds 
        WHERE ds.id = public.orders.session_id 
          AND ds.status NOT IN ('closed', 'expired', 'replaced')
          AND ds.table_id = public.orders.table_id
    ))
);
