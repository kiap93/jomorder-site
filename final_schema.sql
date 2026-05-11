-- Final Robust Schema for Combo & Modifier Engine
-- This script handles existing tables and creates new ones safely.

-- 1. Create Modifier Tables
CREATE TABLE IF NOT EXISTS modifier_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    parent_modifier_id UUID NULL,
    name TEXT NOT NULL,
    required BOOLEAN DEFAULT false,
    min_select INTEGER DEFAULT 0,
    max_select INTEGER DEFAULT 1,
    display_behavior JSONB DEFAULT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modifiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_delta DECIMAL(12,2) DEFAULT 0.00,
    is_default BOOLEAN DEFAULT false,
    render_importance TEXT DEFAULT 'normal',
    display_behavior JSONB DEFAULT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create/Sync Combo Tables
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'product_groups') THEN
        ALTER TABLE product_groups RENAME TO combo_groups;
        ALTER TABLE combo_groups RENAME COLUMN product_id TO combo_product_id;
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'product_group_items') THEN
        ALTER TABLE product_group_items RENAME TO combo_group_items;
    END IF;
END $$;

-- If tables didn't exist to rename, create them fresh
CREATE TABLE IF NOT EXISTS combo_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    combo_product_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    required BOOLEAN DEFAULT false,
    min_select INTEGER DEFAULT 0,
    max_select INTEGER DEFAULT 1,
    display_behavior JSONB DEFAULT NULL,
    importance TEXT DEFAULT 'normal',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS combo_group_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES combo_groups(id) ON DELETE CASCADE,
    child_product_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    custom_name TEXT,
    price_delta DECIMAL(12,2) DEFAULT 0.00,
    default_selected BOOLEAN DEFAULT false,
    display_behavior JSONB DEFAULT NULL,
    importance TEXT DEFAULT 'normal',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enabling RLS
ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_group_items ENABLE ROW LEVEL SECURITY;

-- 4. Policies (Public Read)
CREATE POLICY IF NOT EXISTS "Public read modifier groups" ON modifier_groups FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Public read modifiers" ON modifiers FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Public read combo groups" ON combo_groups FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Public read combo items" ON combo_group_items FOR SELECT USING (true);
