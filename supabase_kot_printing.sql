-- Kitchen Order Ticket (KOT) Printer Routing & Print Queue Schema
-- Highly performant, multi-tenant scoped, supports offline-first sync.

CREATE TABLE IF NOT EXISTS public.printers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('thermal', 'star', 'browser')) DEFAULT 'browser',
    interface_type TEXT CHECK (interface_type IN ('network', 'usb', 'bluetooth', 'browser')) DEFAULT 'browser',
    connection_address TEXT NOT NULL, -- e.g. "192.168.1.150:9100" or interface identification
    status TEXT CHECK (status IN ('online', 'offline')) DEFAULT 'online',
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.printer_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
    category_id UUID NOT NULL, -- Category from public.categories
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (printer_id, category_id)
);

CREATE TABLE IF NOT EXISTS public.print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    printer_id UUID REFERENCES public.printers(id) ON DELETE CASCADE, -- Can be null for dynamic browser printing
    idempotency_key TEXT UNIQUE NOT NULL,
    type TEXT CHECK (type IN ('kot', 'receipt')) DEFAULT 'kot',
    status TEXT CHECK (status IN ('pending', 'printed', 'failed')) DEFAULT 'pending',
    retries INTEGER DEFAULT 0 NOT NULL,
    error_message TEXT,
    payload JSONB NOT NULL, -- Serialized KOT details: metadata, split items list with modifiers
    reprint_count INTEGER DEFAULT 0 NOT NULL,
    reprinted_by TEXT, -- Email, deviceId, or username of staff who reprinted
    reprinted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexing for speed in high throughput environments (Lunch Rush)
CREATE INDEX IF NOT EXISTS idx_printers_restaurant ON public.printers(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_printer_routes_restaurant ON public.printer_routes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_restaurant_status ON public.print_jobs(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_order ON public.print_jobs(order_id);

-- Enable RLS for all three tables
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printer_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

-- Create Policies (SaaS multi-tenant isolation based on profiles)
CREATE POLICY "SaaS Profiles have full access to printers"
ON public.printers FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND (restaurant_id = public.printers.restaurant_id)
    )
);

CREATE POLICY "SaaS Profiles have full access to printer_routes"
ON public.printer_routes FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND (restaurant_id = public.printer_routes.restaurant_id)
    )
);

CREATE POLICY "SaaS Profiles have full access to print_jobs"
ON public.print_jobs FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND (restaurant_id = public.print_jobs.restaurant_id)
    )
);

-- Guest read access is optional for local printing of QR tickets inside iframe
CREATE POLICY "Guest write and select print_jobs"
ON public.print_jobs FOR ALL TO anon
USING (TRUE)
WITH CHECK (TRUE);

CREATE POLICY "Guest select printers"
ON public.printers FOR SELECT TO anon
USING (TRUE);

CREATE POLICY "Guest select printer_routes"
ON public.printer_routes FOR SELECT TO anon
USING (TRUE);
