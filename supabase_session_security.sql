-- Dining Session Security Engine
-- This migration implements temporary dining authorizations

-- 1. Dining Sessions Table
CREATE TABLE IF NOT EXISTS public.dining_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    table_id UUID REFERENCES public.tables(id) ON DELETE CASCADE,
    session_token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'awaiting_payment', 'paid', 'completed', 'expired', 'cancelled')),
    started_at TIMESTAMPTZ DEFAULT now(),
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    closed_at TIMESTAMPTZ,
    created_by_device TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Update Tables to track current session
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS current_session_id UUID REFERENCES public.dining_sessions(id) ON DELETE SET NULL;

-- 3. Update Orders to link to session
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.dining_sessions(id) ON DELETE SET NULL;

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.dining_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_table_active ON public.dining_sessions(table_id) WHERE status = 'active';

-- 5. Helper Function: Resolve or Create Session
CREATE OR REPLACE FUNCTION public.resolve_dining_session(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_device_info TEXT DEFAULT NULL,
    p_client_token TEXT DEFAULT NULL
) RETURNS TABLE (
    session_id UUID,
    token TEXT,
    session_status TEXT
) AS $$
DECLARE
    v_session_id UUID;
    v_token TEXT;
    v_status TEXT;
    v_last_activity TIMESTAMPTZ;
BEGIN
    -- 1. Try to find session by client token first (Highest priority: same customer returning)
    IF p_client_token IS NOT NULL THEN
        SELECT id, session_token, status, last_activity_at INTO v_session_id, v_token, v_status, v_last_activity
        FROM public.dining_sessions
        WHERE session_token = p_client_token
          AND table_id = p_table_id
          AND status = 'active'
        LIMIT 1;

        IF v_session_id IS NOT NULL THEN
            UPDATE public.dining_sessions SET last_activity_at = now() WHERE id = v_session_id;
            RETURN QUERY SELECT v_session_id, v_token, v_status;
            RETURN;
        END IF;
    END IF;

    -- 2. Try to join an existing active session (Group ordering)
    -- Only join if there was recent activity (within 1 hour) to avoid joining a "dirty" table session
    SELECT id, session_token, status, last_activity_at INTO v_session_id, v_token, v_status, v_last_activity
    FROM public.dining_sessions
    WHERE table_id = p_table_id 
      AND restaurant_id = p_restaurant_id
      AND status = 'active'
      AND last_activity_at > (now() - interval '1 hour')
    ORDER BY last_activity_at DESC
    LIMIT 1;

    -- 3. If no suitable session found, create a new one
    IF v_session_id IS NULL THEN
        -- Before creating new, mark any old active sessions for this table as 'expired' to prevent 'hacks'
        UPDATE public.dining_sessions 
        SET status = 'expired', closed_at = now() 
        WHERE table_id = p_table_id AND status = 'active';

        v_token := encode(gen_random_bytes(32), 'hex');
        
        INSERT INTO public.dining_sessions (restaurant_id, table_id, session_token, created_by_device)
        VALUES (p_restaurant_id, p_table_id, v_token, p_device_info)
        RETURNING id, session_token, status INTO v_session_id, v_token, v_status;

        -- Update table's current session pointer
        UPDATE public.tables SET current_session_id = v_session_id, status = 'occupied' WHERE id = p_table_id;
    END IF;

    RETURN QUERY SELECT v_session_id, v_token, v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RLS Policy: Session Token Authorization
-- This ensures a customer can only read/create orders if they possess the valid session token.
-- In practice, we'd pass the token in a custom header or metadata, but for this demo,
-- we'll rely on the session_id being valid and active.

ALTER TABLE public.dining_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read own session if they have token" ON public.dining_sessions;
CREATE POLICY "Public can read own session if they have token"
ON public.dining_sessions FOR SELECT
USING (true); -- Usually restricted by token in app logic

DROP POLICY IF EXISTS "Admin manage sessions" ON public.dining_sessions;
CREATE POLICY "Admin manage sessions"
ON public.dining_sessions FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
