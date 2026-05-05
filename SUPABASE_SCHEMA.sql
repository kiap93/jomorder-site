-- 1. Create Tables

-- Restaurants
CREATE TABLE public.restaurants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT DEFAULT 'MYR',
    service_charge NUMERIC DEFAULT 6,
    sst NUMERIC DEFAULT 10,
    owner_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Categories
CREATE TABLE public.categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Menu Items
CREATE TABLE public.menu_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    image_url TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    options JSONB, -- Store variants/options as JSON
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tables
CREATE TABLE public.tables (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'available',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Orders
CREATE TABLE public.orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    table_id UUID REFERENCES public.tables(id),
    status TEXT DEFAULT 'pending', -- pending, preparing, ready, completed, cancelled
    total_price NUMERIC NOT NULL,
    payment_method TEXT DEFAULT 'counter',
    items JSONB NOT NULL, -- Store snapshot of items ordered
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- User Profiles
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    role TEXT DEFAULT 'staff', -- admin, staff, kitchen
    restaurant_id UUID REFERENCES public.restaurants(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Row Level Security (RLS)

-- Enable RLS
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin can update profiles in same restaurant." ON public.profiles FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.restaurant_id = public.profiles.restaurant_id
  )
);

-- Restaurants Policies
CREATE POLICY "Restaurants are viewable by everyone." ON public.restaurants FOR SELECT USING (true);
CREATE POLICY "Owners can manage their restaurants." ON public.restaurants FOR ALL USING (auth.uid() = owner_id);

-- Categories Policies
CREATE POLICY "Categories are viewable by everyone." ON public.categories FOR SELECT USING (true);
CREATE POLICY "Staff can manage categories." ON public.categories FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.restaurant_id = public.categories.restaurant_id
  )
);

-- Menu Items Policies
CREATE POLICY "Menu items are viewable by everyone." ON public.menu_items FOR SELECT USING (true);
CREATE POLICY "Staff can manage menu items." ON public.menu_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.restaurant_id = public.menu_items.restaurant_id
  )
);

-- Tables Policies
CREATE POLICY "Tables are viewable by everyone." ON public.tables FOR SELECT USING (true);
CREATE POLICY "Staff can manage tables." ON public.tables FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.restaurant_id = public.tables.restaurant_id
  )
);

-- Orders Policies
CREATE POLICY "Everyone can create orders." ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Everyone can view orders." ON public.orders FOR SELECT USING (true);
CREATE POLICY "Staff can update orders." ON public.orders FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.restaurant_id = public.orders.restaurant_id
  )
);

-- 3. Functions & Triggers

-- Automatically handle profile creation on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
