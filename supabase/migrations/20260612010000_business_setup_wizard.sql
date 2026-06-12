-- Migration to support JomOrder Onboarding Setup Wizard progress persistence

CREATE TABLE IF NOT EXISTS public.business_setup_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    current_step INTEGER NOT NULL DEFAULT 1,
    completed_steps INTEGER[] DEFAULT '{}'::INTEGER[],
    wizard_data JSONB DEFAULT '{}'::jsonb,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_business_setup_progress UNIQUE (business_id)
);

-- Backfill or make sure all existing tenants bypass the setup wizard by creating completed entries if we want, or handle via lazy checks.
-- We can default existing restaurants to "completed: true" so they aren't forced into the wizard retroactively unless they want to.
INSERT INTO public.business_setup_progress (business_id, current_step, completed_steps, completed)
SELECT id, 7, '{1,2,3,4,5,6,7}'::INTEGER[], TRUE
FROM public.restaurants
ON CONFLICT (business_id) DO NOTHING;
