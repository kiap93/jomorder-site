-- Enterprise Refactor: Separation of Combo Engine and Configurator Engine

-- 1. MODIFIER ENGINE (Configurable Product Engine)
-- Represents options that are NOT sellable products (e.g. Sugar Level, No Ice)
CREATE TABLE IF NOT EXISTS modifier_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    parent_modifier_id UUID NULL, -- For Nested Modifiers
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

-- 2. COMBO ENGINE (Product Composition Engine)
-- Represents combinations of real sellable products (e.g. Burger Set = Burger + Drink)
-- We rename existing generic tables to be more semantic
ALTER TABLE product_groups RENAME TO combo_groups;
ALTER TABLE product_group_items RENAME TO combo_group_items;
ALTER TABLE combo_groups RENAME COLUMN product_id TO combo_product_id;

-- 3. RLS POLICIES FOR NEW TABLES
ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read modifier groups" ON modifier_groups FOR SELECT USING (true);
CREATE POLICY "Public read modifiers" ON modifiers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin manage modifier groups" ON modifier_groups;
CREATE POLICY "Admin manage modifier groups" ON modifier_groups FOR ALL
USING (product_id IN (SELECT id FROM menu_items WHERE restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin')));

DROP POLICY IF EXISTS "Admin manage modifiers" ON modifiers;
CREATE POLICY "Admin manage modifiers" ON modifiers FOR ALL
USING (group_id IN (SELECT id FROM modifier_groups WHERE product_id IN (SELECT id FROM menu_items WHERE restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin'))));

-- 4. NESTED MODIFIER SUPPORT (Recursive Cleanup & Relationship)
-- Modifier groups can now belong to a parent modifier
ALTER TABLE modifier_groups 
ADD CONSTRAINT fk_parent_modifier 
FOREIGN KEY (parent_modifier_id) 
REFERENCES modifiers(id) ON DELETE CASCADE;
