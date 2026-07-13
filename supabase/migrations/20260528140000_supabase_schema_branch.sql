-- Sikmatye: Enterprise Multi-Tenant Restaurant Hub Schema
-- Full Idempotent Version

-- 1. CORE ARCHITECTURE
CREATE TABLE IF NOT EXISTS franchises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    franchise_id UUID REFERENCES franchises(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    currency TEXT DEFAULT 'RM',
    service_charge DECIMAL(5,4) DEFAULT 0.1000,
    sst DECIMAL(5,4) DEFAULT 0.0600,
    owner_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure owner_id exists if table already existed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='restaurants' AND column_name='owner_id') THEN
        ALTER TABLE restaurants ADD COLUMN owner_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    email TEXT,
    role TEXT CHECK (role IN ('admin', 'staff', 'kitchen')) DEFAULT 'staff',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(12,2) DEFAULT 0.00,
    base_price DECIMAL(12,2) DEFAULT 0.00,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'Available',
    product_type TEXT CHECK (product_type IN ('single', 'combo', 'configurable')) DEFAULT 'single',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CONFIGURATION ENGINE (MODIFIERS / COMBOS)
CREATE TABLE IF NOT EXISTS product_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    group_type TEXT CHECK (group_type IN ('required', 'optional', 'nested')) DEFAULT 'required',
    required BOOLEAN DEFAULT true,
    min_select INTEGER DEFAULT 1,
    max_select INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_group_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES product_groups(id) ON DELETE CASCADE,
    child_product_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
    price_delta DECIMAL(12,2) DEFAULT 0.00,
    default_selected BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. LOCALIZATION ENGINE
CREATE TABLE IF NOT EXISTS global_translations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term_key TEXT NOT NULL,
    language_code TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    confidence_score DECIMAL(3,2) DEFAULT 1.00,
    approved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(term_key, language_code)
);

CREATE TABLE IF NOT EXISTS tenant_translations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT DEFAULT 'name',
    language_code TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    review_status TEXT CHECK (review_status IN ('draft', 'reviewed', 'approved', 'rejected')) DEFAULT 'approved',
    override_global BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, entity_id, language_code, field_name)
);

-- Ensure field_name exists and update unique constraint if table already existed
DO $$
BEGIN
    -- 1. Add field_name if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenant_translations' AND column_name='field_name') THEN
        ALTER TABLE tenant_translations ADD COLUMN field_name TEXT DEFAULT 'name';
    END IF;

    -- 2. Drop the old 3-column unique constraint if it exists
    ALTER TABLE tenant_translations DROP CONSTRAINT IF EXISTS tenant_translations_restaurant_id_entity_id_language_code_key;
    
    -- 3. Drop the new one if it exists to ensure we re-apply it correctly
    ALTER TABLE tenant_translations DROP CONSTRAINT IF EXISTS tenant_translations_unique_field;
    
    -- 4. Add the 4-column unique constraint
    ALTER TABLE tenant_translations ADD CONSTRAINT tenant_translations_unique_field UNIQUE(restaurant_id, entity_id, language_code, field_name);
END $$;

CREATE TABLE IF NOT EXISTS franchise_translations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    franchise_id UUID REFERENCES franchises(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT DEFAULT 'name',
    language_code TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(franchise_id, entity_id, language_code, field_name)
);

CREATE TABLE IF NOT EXISTS branch_translations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT DEFAULT 'name',
    language_code TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, entity_id, language_code, field_name)
);

CREATE TABLE IF NOT EXISTS kitchen_canonical_names (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    kitchen_language TEXT DEFAULT 'zh',
    canonical_name TEXT NOT NULL,
    UNIQUE(menu_item_id)
);

-- 4. AI WORKFLOW & AUDIT
CREATE TABLE IF NOT EXISTS translation_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    field_name TEXT DEFAULT 'name',
    source_language TEXT NOT NULL,
    target_language TEXT NOT NULL,
    status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
    ai_generated_text TEXT,
    reviewed_text TEXT,
    review_status TEXT CHECK (review_status IN ('draft', 'reviewed', 'approved', 'rejected')) DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, entity_id, target_language, field_name)
);

-- Fix: Remove problematic ghost constraint if it exists from previous attempts
ALTER TABLE translation_versions DROP CONSTRAINT IF EXISTS fk_translation_id;

CREATE TABLE IF NOT EXISTS translation_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    translation_type TEXT NOT NULL,
    translation_id UUID NOT NULL,
    field_name TEXT DEFAULT 'name',
    language_code TEXT,
    previous_text TEXT,
    new_text TEXT,
    edited_by UUID REFERENCES auth.users(id),
    change_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure language_code and field_name exists if table already existed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='translation_versions' AND column_name='language_code') THEN
        ALTER TABLE translation_versions ADD COLUMN language_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='translation_versions' AND column_name='field_name') THEN
        ALTER TABLE translation_versions ADD COLUMN field_name TEXT DEFAULT 'name';
    END IF;
END $$;

-- 5. ACCESS CONTROL (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_group_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_versions ENABLE ROW LEVEL SECURITY;

-- 5.1 User Profile Policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT
WITH CHECK (auth.uid() = id);

-- 5.2 Basic Multi-tenant Security
DROP POLICY IF EXISTS "Public read common" ON restaurants;
CREATE POLICY "Public read common" ON restaurants FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owners can manage rest" ON restaurants;
CREATE POLICY "Owners can manage rest" ON restaurants FOR ALL
USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Public read categories" ON categories;
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin manage categories" ON categories;
CREATE POLICY "Admin manage categories" ON categories FOR ALL
USING (restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Public read items" ON menu_items;
CREATE POLICY "Public read items" ON menu_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read groups" ON product_groups;
CREATE POLICY "Public read groups" ON product_groups FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read group items" ON product_group_items;
CREATE POLICY "Public read group items" ON product_group_items FOR SELECT USING (true);

-- 5.3 Admin Write Permissions
DROP POLICY IF EXISTS "Admin manage items" ON menu_items;
CREATE POLICY "Admin manage items" ON menu_items FOR ALL
USING (restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin manage groups" ON product_groups;
CREATE POLICY "Admin manage groups" ON product_groups FOR ALL
USING (product_id IN (SELECT id FROM menu_items WHERE restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin')));

DROP POLICY IF EXISTS "Admin manage group items" ON product_group_items;
CREATE POLICY "Admin manage group items" ON product_group_items FOR ALL
USING (group_id IN (SELECT id FROM product_groups WHERE product_id IN (SELECT id FROM menu_items WHERE restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin'))));

-- 5.4 Localization Security
DROP POLICY IF EXISTS "Public read translations" ON tenant_translations;
CREATE POLICY "Public read translations" ON tenant_translations FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin manage translations" ON tenant_translations;
CREATE POLICY "Admin manage translations" ON tenant_translations FOR ALL
USING (restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin'))
WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin manage translation versions" ON translation_versions;
CREATE POLICY "Admin manage translation versions" ON translation_versions FOR ALL
USING (true); --