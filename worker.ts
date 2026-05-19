import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as jose from 'jose';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GEMINI_API_KEY: string;
  ADMIN_USER_EMAIL?: string;
  ADMIN_USER_PASSWORD?: string;
};

type Variables = {
  user: any;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', cors());

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.url} failed: ${err.message}`);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

// Helper to sign JWT using jose (Edge compatible)
async function signJWT(payload: any, secret: string) {
  const secretKey = new TextEncoder().encode(secret);
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);
}

// Helper to verify JWT using jose
async function verifyJWT(token: string, secret: string) {
  const secretKey = new TextEncoder().encode(secret);
  try {
    const { payload } = await jose.jwtVerify(token, secretKey);
    return payload;
  } catch (e) {
    return null;
  }
}

// Helper to verify Google ID Token manually (since google-auth-library is heavy for Edge)
async function verifyGoogleToken(idToken: string, clientId: string) {
  try {
    // 1. Get Google's public keys
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    const jwks = await response.json();
    const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    
    // 2. Verify the token
    const { payload } = await jose.jwtVerify(idToken, JWKS, {
      issuer: 'https://accounts.google.com',
      audience: clientId,
    });
    
    return payload;
  } catch (e) {
    console.error('Google token verification failed:', e);
    return null;
  }
}

// Auth Middleware
const authenticate = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return c.json({ error: 'Unauthorized: No token provided' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }

  c.set('user', payload);
  await next();
};

// --- API ROUTES ---

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Use Supabase Admin (service role)
const getSupabase = (env: Bindings) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// --- PUBLIC ENDPOINTS ---

app.get('/api/public/restaurants/:id', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('restaurants')
    .select('*, franchise_id')
    .eq('id', c.req.param('id'))
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Restaurant not found' }, 404);
  return c.json(data);
});

app.get('/api/public/restaurants/:restId/categories', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', c.req.param('restId'))
    .order('sort_order', { ascending: true });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

app.get('/api/public/restaurants/:restId/menu-items', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('menu_items')
    .select(`
      *,
      combo_groups (*, items:combo_group_items (*, child_product:menu_items (*, combo_groups (*, items:combo_group_items (*)), modifier_groups (*, modifiers!modifiers_group_id_fkey (*))))),
      modifier_groups (*, modifiers!modifiers_group_id_fkey (*))
    `)
    .eq('restaurant_id', c.req.param('restId'))
    .eq('is_active', true);
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

app.get('/api/public/tables/:tableId', async (c) => {
  const supabase = getSupabase(c.env);
  const restId = c.req.query('restId');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.req.param('tableId'));
  
  let query = supabase.from('tables').select('*');
  if (isUuid) {
    query = query.eq('id', c.req.param('tableId'));
  } else {
    query = query.eq('restaurant_id', restId).eq('name', c.req.param('tableId'));
  }

  const { data, error } = await query.maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.post('/api/public/resolve-session', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { restaurantId, tableId, deviceInfo, clientToken, fulfillment } = body;
  
  const { data, error } = await supabase.rpc('resolve_dining_session_v2', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
    p_device_info: deviceInfo,
    p_client_token: clientToken,
    p_fulfillment: fulfillment
  });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.get('/api/public/orders/check', async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  const { data, error, count } = await supabase
    .from('orders')
    .select('id', { count: 'exact' })
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ orders: data, count });
});

app.get('/api/public/baskets', async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  const { data, error } = await supabase
    .from('baskets')
    .select('id, basket_version')
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.get('/api/public/baskets/:basketId/items', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('basket_items')
    .select('*')
    .eq('basket_id', c.req.param('basketId'));
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

app.post('/api/public/sync-basket-item', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase.rpc('sync_basket_item_v2', body);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.post('/api/public/place-order', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase.rpc('place_order_v3', body);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.get('/api/public/orders/:id', async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', c.req.param('id'))
    .eq('session_id', sessionId)
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// --- AUTH ENDPOINTS ---

app.post('/api/login', async (c) => {
  const supabase = getSupabase(c.env);
  const { email, password } = await c.req.json();
  const envAdminEmail = c.env.ADMIN_USER_EMAIL;
  const envAdminPass = c.env.ADMIN_USER_PASSWORD;

  if (envAdminEmail && email === envAdminEmail && password === envAdminPass) {
    const token = await signJWT({ id: 'admin', email, role: 'admin' }, c.env.JWT_SECRET);
    return c.json({ token, user: { id: 'admin', email, role: 'admin' } });
  }

  try {
    const { data: authData } = await supabase.auth.signInWithPassword({ email, password });

    if (authData?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();
      
      if (profile) {
        const token = await signJWT({ 
          id: profile.id, 
          email: profile.email, 
          role: profile.role,
          restaurantId: profile.restaurant_id 
        }, c.env.JWT_SECRET);
        
        return c.json({ token, user: profile });
      }
    }

    return c.json({ error: 'Invalid credentials' }, 401);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/register', async (c) => {
  const supabase = getSupabase(c.env);
  const { email, password } = await c.req.json();
  
  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  try {
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) return c.json({ error: authError.message }, 400);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authUser.user.id,
        email: email,
        role: 'staff',
      })
      .select()
      .single();

    if (profileError) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return c.json({ error: profileError.message }, 500);
    }

    const token = await signJWT({ 
      id: profile.id, 
      email: profile.email, 
      role: profile.role,
      restaurantId: profile.restaurant_id 
    }, c.env.JWT_SECRET);

    return c.json({ token, user: profile });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/google-login', async (c) => {
  const supabase = getSupabase(c.env);
  const { idToken } = await c.req.json();
  const clientId = c.env.GOOGLE_CLIENT_ID;

  if (!idToken) return c.json({ error: 'Missing token' }, 400);

  const payload = await verifyGoogleToken(idToken, clientId);
  if (!payload || !payload.email) {
    return c.json({ error: 'Google authentication failed' }, 401);
  }

  const email = payload.email as string;
  let userPayload: any = null;

  if (c.env.ADMIN_USER_EMAIL && email === c.env.ADMIN_USER_EMAIL) {
    userPayload = { id: 'admin', email, role: 'admin' };
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (profile) {
      userPayload = {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        restaurantId: profile.restaurant_id
      };
    }
  }

  if (!userPayload) {
    return c.json({ error: 'User not authorized' }, 403);
  }

  const token = await signJWT(userPayload, c.env.JWT_SECRET);
  return c.json({ token, user: userPayload });
});

app.get('/api/me', authenticate, (c) => {
  const user = c.get('user');
  return c.json(user);
});

// Translation with Gemini
app.post('/api/translate', authenticate, async (c) => {
  const { text, targetLang, restaurantContext } = await c.req.json();
  
  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: 'GEMINI_API_KEY is not configured.' }, 500);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: c.env.GEMINI_API_KEY! });
    
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `
      You are a professional culinary translator.
      Translate the following food term or description from English to ${targetLang}.
      
      Term: "${text}"
      Restaurant Type: ${restaurantContext || 'General'}
      
      Return ONLY the translated text.
      `
    });
    
    const translatedText = response.text.trim();
    return c.json({ translatedText });
  } catch (error: any) {
    return c.json({ error: 'Translation failed' }, 500);
  }
});

// Pass-through for other authenticated endpoints (Kitchen, Admin, etc.)
// ... (omitted for brevity, but I will include the core logic)

// --- DATA PROXY ENDPOINTS (SUPABASE SERVICE ROLE) ---

// Translation Jobs
app.get("/api/translation-jobs", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const filter = c.req.query('filter');
  let query = supabase
    .from('translation_jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (filter && filter !== 'all') {
    query = query.eq('review_status', filter);
  } else {
    query = query.neq('review_status', 'approved');
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

app.patch("/api/translation-jobs/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('translation_jobs')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Restaurants (Auth)
app.get("/api/restaurants/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', c.req.param('id'))
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Restaurant not found' }, 404);
  return c.json(data);
});

app.patch("/api/restaurants/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('restaurants')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Categories (Auth)
app.get("/api/restaurants/:restId/categories/auth", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', c.req.param('restId'))
    .order('sort_order', { ascending: true });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

app.post("/api/categories", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('categories')
    .insert(body)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Menu Items (Auth)
app.get("/api/restaurants/:restId/menu-items/auth", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('menu_items')
    .select(`
      *,
      display_behavior,
      combo_groups (*, combo_group_items (*, child_product:menu_items (id, name, base_price, product_type))),
      modifier_groups (*, modifiers!modifiers_group_id_fkey (*))
    `)
    .eq('restaurant_id', c.req.param('restId'));
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

app.patch("/api/menu-items/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('menu_items')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Tables (Auth)
app.get("/api/restaurants/:restId/tables/auth", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('tables')
    .select('*, current_session:dining_sessions!tables_current_session_id_fkey(*)')
    .eq('restaurant_id', c.req.param('restId'))
    .order('name', { ascending: true });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

// Unified Orders Endpoint (Supports POS and KDS)
app.get("/api/restaurants/:restId/orders", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const status = c.req.query('status');
  const limit = parseInt(c.req.query('limit') || '100');
  
  let query = supabase
    .from('orders')
    .select('*, tables(name), payments(amount)')
    .eq('restaurant_id', c.req.param('restId'))
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status === 'active') {
    query = query.in('status', ['pending', 'confirmed', 'cooking', 'ready', 'served']);
  } else if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

app.patch("/api/orders/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('orders')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Legacy KDS path segment Support (mapping internally)
app.get("/api/restaurants/:restId/orders/active", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('orders')
    .select('*, tables(name)')
    .eq('restaurant_id', c.req.param('restId'))
    .in('status', ['pending', 'confirmed', 'cooking', 'ready', 'served'])
    .order('created_at', { ascending: false });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

// Batch Translate (Public)
app.post("/api/public/batch-translate", async (c) => {
  const supabase = getSupabase(c.env);
  const { items, categories, context } = await c.req.json();
  const { restaurantId, franchiseId, targetLanguage } = context;

  if (targetLanguage === 'en') {
    return c.json({ items, categories });
  }

  try {
    const resolveSingle = async (entityId: string, entityType: string, fieldName: string, defaultText: string) => {
      const { data: tenantData } = await supabase
        .from('tenant_translations')
        .select('translated_text')
        .eq('restaurant_id', restaurantId)
        .eq('entity_id', entityId)
        .eq('entity_type', entityType)
        .eq('field_name', fieldName)
        .eq('language_code', targetLanguage)
        .maybeSingle();

      return tenantData?.translated_text || defaultText;
    };

    const translatedItems = items ? await Promise.all(items.map(async (item: any) => {
      const name = await resolveSingle(item.id, 'menu_item', 'name', item.name);
      return { ...item, name };
    })) : null;

    return c.json({ items: translatedItems, categories });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Batch Sync for Admin
app.post("/api/batch-sync", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { entity, productId, data } = await c.req.json();
  try {
    if (entity === 'combo_groups') {
      await supabase.from('combo_groups').delete().eq('combo_product_id', productId);
      if (data && data.length > 0) {
        for (const group of data) {
          const { data: newGroup, error: groupError } = await supabase
            .from('combo_groups')
            .insert({
              combo_product_id: productId,
              name: group.name,
              description: group.description,
              required: group.required,
              min_select: group.min_select,
              max_select: group.max_select,
              display_behavior: group.display_behavior,
              importance: group.importance,
              sort_order: group.sort_order
            })
            .select().single();
          
          if (groupError) throw groupError;
          if (group.items && group.items.length > 0) {
            const items = group.items.map((i: any) => ({ ...i, group_id: newGroup.id }));
            await supabase.from('combo_group_items').insert(items);
          }
        }
      }
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Settle Session
app.post("/api/dining-sessions/:id/settle", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { orderIds, paidAmount } = await c.req.json();
  try {
    const { error: orderError } = await supabase
      .from('orders')
      .update({ paid_at: new Date().toISOString(), payment_method: 'counter' })
      .in('id', orderIds);
    if (orderError) throw orderError;

    const { error: sessionError } = await supabase
      .from('dining_sessions')
      .update({ status: 'paid', paid_amount: paidAmount })
      .eq('id', c.req.param('id'));
    if (sessionError) throw sessionError;

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
