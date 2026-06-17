import { Hono } from 'hono';
import { GoogleGenAI } from '@google/genai';
import { Bindings, Variables } from '../types';
import { getSupabase, getStaffSettingsFromDb, logToAuditDb, getUserSupabaseClient } from '../services/db_service';
import { detectLanguageAndTranslate, runBackgroundTranslationJob, sanitizeTranslationOutput } from '../services/ai_service';
import { authenticate } from '../middleware/auth';

const menuRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// --- PUBLIC READ CATALOG ENDPOINTS ---

menuRoutes.get('/api/public/restaurants/:id', async (c) => {
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

menuRoutes.get('/api/public/restaurants/:restId/categories', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', c.req.param('restId'))
    .order('sort_order', { ascending: true });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

menuRoutes.get('/api/public/restaurants/:restId/menu-items', async (c) => {
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

// Admin View Restaurant Details
menuRoutes.get("/api/restaurants/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const id = c.req.param('id');
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Restaurant not found' }, 404);

  // Fetch or initialize business_settings
  let { data: bSettingsList, error: bsError } = await supabase
    .from('business_settings')
    .select('*')
    .eq('restaurant_id', id)
    .limit(1);

  let bSettings = bSettingsList && bSettingsList[0] ? bSettingsList[0] : null;

  if (!bSettings || bsError) {
    // Auto-migrate standard Malaysia or fallback values
    const initialTaxRate = data.sst !== undefined ? Number(data.sst) : 6;
    const initialCurrency = data.currency || 'MYR';
    const initialPaymentMode = data.payment_mode || 'both';

    const preset = {
      business_id: id,
      restaurant_id: id,
      country_code: initialCurrency === 'MYR' ? 'MY' : (initialCurrency === 'SGD' ? 'SG' : (initialCurrency === 'THB' ? 'TH' : 'US')),
      currency_code: initialCurrency,
      timezone: initialCurrency === 'MYR' ? 'Asia/Kuala_Lumpur' : (initialCurrency === 'SGD' ? 'Asia/Singapore' : (initialCurrency === 'THB' ? 'Asia/Bangkok' : 'America/New_York')),
      language: 'en',
      tax_type: initialCurrency === 'MYR' ? 'SST' : (initialCurrency === 'SGD' ? 'GST' : (initialCurrency === 'THB' ? 'VAT' : 'Sales Tax')),
      tax_rate: initialTaxRate,
      date_format: initialCurrency === 'USD' ? 'MM/DD/YYYY' : 'DD/MM/YYYY',
      payment_mode: initialPaymentMode
    };

    const { data: newBSList } = await supabase
      .from('business_settings')
      .insert([preset])
      .select()
      .limit(1);
    
    bSettings = (newBSList && newBSList[0]) || preset;
  }

  // Attach business_settings to restaurant payload
  data.business_settings = {
    country: bSettings.country_code || 'MY',
    currency: bSettings.currency_code || 'MYR',
    timezone: bSettings.timezone || 'Asia/Kuala_Lumpur',
    language: bSettings.language || 'en',
    tax_type: bSettings.tax_type || 'SST',
    tax_rate: Number(bSettings.tax_rate !== undefined ? bSettings.tax_rate : 10),
    date_format: bSettings.date_format || 'DD/MM/YYYY',
    payment_mode: bSettings.payment_mode || 'both'
  };

  // Attach custom database-driven tax profiles
  const { data: taxProfiles } = await supabase
    .from('tax_profiles')
    .select('*')
    .eq('business_id', id);
  data.tax_profiles = taxProfiles || [];

  // Flatten for absolute backward compatibility
  data.currency = bSettings.currency_code || data.currency || 'MYR';
  data.sst = Number(bSettings.tax_rate !== undefined ? bSettings.tax_rate : data.sst);
  data.payment_mode = bSettings.payment_mode || data.payment_mode || 'both';

  return c.json(data);
});

// Admin Update Restaurant Details
menuRoutes.patch("/api/restaurants/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { business_settings, ...dbBody } = body;

  if (business_settings) {
    const bsPayload: any = {
      country_code: business_settings.country,
      currency_code: business_settings.currency,
      timezone: business_settings.timezone,
      language: business_settings.language,
      tax_type: business_settings.tax_type,
      tax_rate: business_settings.tax_rate,
      date_format: business_settings.date_format,
      payment_mode: business_settings.payment_mode,
      updated_at: new Date().toISOString()
    };

    const { data: existingBSList } = await supabase
      .from('business_settings')
      .select('*')
      .eq('restaurant_id', id)
      .limit(1);

    const existingBS = existingBSList && existingBSList[0] ? existingBSList[0] : null;

    if (existingBS) {
      await supabase
        .from('business_settings')
        .update(bsPayload)
        .eq('id', existingBS.id);
    } else {
      await supabase
        .from('business_settings')
        .insert([{
          business_id: id,
          restaurant_id: id,
          ...bsPayload
        }]);
    }

    // Synchronize with active tax profiles
    const targetCountry = business_settings.country || 'MY';
    const targetRate = Number(business_settings.tax_rate !== undefined ? business_settings.tax_rate : 6);
    const targetType = business_settings.tax_type || 'SST';

    const { data: activeTPs } = await supabase
      .from('tax_profiles')
      .select('*')
      .eq('business_id', id)
      .eq('is_active', true);

    if (activeTPs && activeTPs.length > 0) {
      await supabase
        .from('tax_profiles')
        .update({
          country_code: targetCountry,
          tax_rate: targetRate,
          tax_type: targetType,
          name: `${targetCountry === 'MY' ? 'Malaysia' : (targetCountry === 'SG' ? 'Singapore' : (targetCountry === 'AU' ? 'Australia' : 'UK'))} ${targetType}`
        })
        .eq('business_id', id)
        .eq('is_active', true);
    } else {
      await supabase
        .from('tax_profiles')
        .insert([{
          business_id: id,
          country_code: targetCountry,
          tax_rate: targetRate,
          tax_type: targetType,
          name: `${targetCountry === 'MY' ? 'Malaysia' : (targetCountry === 'SG' ? 'Singapore' : (targetCountry === 'AU' ? 'Australia' : 'UK'))} ${targetType}`,
          is_inclusive: false,
          is_active: true
        }]);
    }

    if (business_settings.currency) {
      dbBody.currency = business_settings.currency;
    }
    if (business_settings.tax_rate !== undefined) {
      dbBody.sst = business_settings.tax_rate;
    }
    if (business_settings.payment_mode) {
      dbBody.payment_mode = business_settings.payment_mode;
    }
  }

  const { data, error } = await supabase
    .from('restaurants')
    .update(dbBody)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Restaurant not found' }, 404);

  // Fetch updated business settings to include in response
  const { data: finalBSList } = await supabase
    .from('business_settings')
    .select('*')
    .eq('restaurant_id', id)
    .limit(1);

  const finalBS = finalBSList && finalBSList[0] ? finalBSList[0] : null;

  if (finalBS) {
    data.business_settings = {
      country: finalBS.country_code,
      currency: finalBS.currency_code,
      timezone: finalBS.timezone,
      language: finalBS.language,
      tax_type: finalBS.tax_type,
      tax_rate: Number(finalBS.tax_rate),
      date_format: finalBS.date_format,
      payment_mode: finalBS.payment_mode
    };
    data.currency = finalBS.currency_code || data.currency || 'MYR';
    data.sst = Number(finalBS.tax_rate !== undefined ? finalBS.tax_rate : data.sst);
    data.payment_mode = finalBS.payment_mode || data.payment_mode || 'both';
  }

  // Attach custom database-driven tax profiles
  const { data: taxProfiles } = await supabase
    .from('tax_profiles')
    .select('*')
    .eq('business_id', id);
  data.tax_profiles = taxProfiles || [];

  return c.json(data);
});

// --- CATEGORIES (ADMIN) ---

menuRoutes.get("/api/restaurants/:restId/categories", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', c.req.param('restId'))
    .order('sort_order', { ascending: true });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

menuRoutes.post("/api/categories", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('categories')
    .insert(body)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

menuRoutes.delete("/api/categories/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', c.req.param('id'));
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

// --- MENU ITEMS (ADMIN) ---

menuRoutes.get("/api/restaurants/:restId/menu-items", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
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

menuRoutes.patch("/api/menu-items/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const body = await c.req.json();
  const caller = c.get('user');

  if (caller && caller.is_platform_admin !== true) {
    const checkRestId = body.restaurant_id || caller.restaurantId || caller.restaurant_id;
    const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, checkRestId);
    if (!settings.permissions.can_edit_menu) {
      return c.json({ error: "Forbidden: You do not have permission to manage the menu." }, 403);
    }
  }

  const originalNames: { lang: string; text: string }[] = [];
  const originalDescs: { lang: string; text: string }[] = [];

  if (body.name && body.name.trim()) {
    const result = await detectLanguageAndTranslate(body.name.trim(), c.env.GEMINI_API_KEY);
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalNames.push({ lang: result.languageCode, text: body.name.trim() });
      body.name = result.englishTranslation;
    }
  }

  if (body.description && body.description.trim()) {
    const result = await detectLanguageAndTranslate(body.description.trim(), c.env.GEMINI_API_KEY);
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalDescs.push({ lang: result.languageCode, text: body.description.trim() });
      body.description = result.englishTranslation;
    }
  }

  const { data, error } = await supabase
    .from('menu_items')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);

  if (data && data.id) {
    const restaurantId = data.restaurant_id || caller.restaurantId;
    for (const item of originalNames) {
      await supabase.from('tenant_translations').upsert({
        restaurant_id: restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'name',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }
    for (const item of originalDescs) {
      await supabase.from('tenant_translations').upsert({
        restaurant_id: restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'description',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }

    // Queue translation jobs for target languages (zh, ms, th, ja, ko) in worker PATCH list
    const targetLangs = ['zh', 'ms', 'th', 'ja', 'ko'];
    for (const lang of targetLangs) {
      if (body.name || (originalNames.length > 0)) {
        await supabase.from('translation_jobs').upsert({
          restaurant_id: restaurantId,
          entity_type: 'menu_item',
          entity_id: data.id,
          field_name: 'name',
          source_language: 'en',
          target_language: lang,
          status: 'pending',
          review_status: 'draft'
        }, { onConflict: 'restaurant_id,entity_id,target_language,field_name' });
      }

      if (body.description || (originalDescs.length > 0)) {
        await supabase.from('translation_jobs').upsert({
          restaurant_id: restaurantId,
          entity_type: 'menu_item',
          entity_id: data.id,
          field_name: 'description',
          source_language: 'en',
          target_language: lang,
          status: 'pending',
          review_status: 'draft'
        }, { onConflict: 'restaurant_id,entity_id,target_language,field_name' });
      }
    }
  }

  if (caller && caller.email) {
    await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Updated menu item: ${data?.name || c.req.param('id')}`, data?.restaurant_id || caller.restaurantId);
  }

  if (c.executionCtx) {
    c.executionCtx.waitUntil(runBackgroundTranslationJob(c.env));
  } else {
    runBackgroundTranslationJob(c.env).catch(err => console.error('[Worker] Local background sync failed:', err));
  }

  return c.json(data);
});

menuRoutes.post("/api/menu-items", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const body = await c.req.json();
  const caller = c.get('user');

  if (caller && caller.is_platform_admin !== true) {
    const checkRestId = body.restaurant_id || caller.restaurantId || caller.restaurant_id;
    const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, checkRestId);
    if (!settings.permissions.can_edit_menu) {
      return c.json({ error: "Forbidden: You do not have permission to manage the menu." }, 403);
    }
  }

  const originalNames: { lang: string; text: string }[] = [];
  const originalDescs: { lang: string; text: string }[] = [];

  if (body.name && body.name.trim()) {
    const result = await detectLanguageAndTranslate(body.name.trim(), c.env.GEMINI_API_KEY);
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalNames.push({ lang: result.languageCode, text: body.name.trim() });
      body.name = result.englishTranslation;
    }
  }

  if (body.description && body.description.trim()) {
    const result = await detectLanguageAndTranslate(body.description.trim(), c.env.GEMINI_API_KEY);
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalDescs.push({ lang: result.languageCode, text: body.description.trim() });
      body.description = result.englishTranslation;
    }
  }

  const { data, error } = await supabase
    .from('menu_items')
    .insert(body)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);

  if (data && data.id) {
    const restaurantId = data.restaurant_id || caller.restaurantId;
    for (const item of originalNames) {
      await supabase.from('tenant_translations').upsert({
        restaurant_id: restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'name',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }
    for (const item of originalDescs) {
      await supabase.from('tenant_translations').upsert({
        restaurant_id: restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'description',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }

    // Queue translation jobs for target languages (zh, ms, th, ja, ko) in worker POST list
    const targetLangs = ['zh', 'ms', 'th', 'ja', 'ko'];
    for (const lang of targetLangs) {
      if (body.name || (originalNames.length > 0)) {
        await supabase.from('translation_jobs').upsert({
          restaurant_id: restaurantId,
          entity_type: 'menu_item',
          entity_id: data.id,
          field_name: 'name',
          source_language: 'en',
          target_language: lang,
          status: 'pending',
          review_status: 'draft'
        }, { onConflict: 'restaurant_id,entity_id,target_language,field_name' });
      }

      if (body.description || (originalDescs.length > 0)) {
        await supabase.from('translation_jobs').upsert({
          restaurant_id: restaurantId,
          entity_type: 'menu_item',
          entity_id: data.id,
          field_name: 'description',
          source_language: 'en',
          target_language: lang,
          status: 'pending',
          review_status: 'draft'
        }, { onConflict: 'restaurant_id,entity_id,target_language,field_name' });
      }
    }
  }

  if (caller && caller.email) {
    await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Added menu item: ${data?.name || 'Dish'}`, data?.restaurant_id || caller.restaurantId);
  }

  if (c.executionCtx) {
    c.executionCtx.waitUntil(runBackgroundTranslationJob(c.env));
  } else {
    runBackgroundTranslationJob(c.env).catch(err => console.error('[Worker] Local background sync failed:', err));
  }

  return c.json(data);
});

menuRoutes.delete("/api/menu-items/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const caller = c.get('user');

  if (caller && caller.is_platform_admin !== true) {
    const checkRestId = caller.restaurantId || caller.restaurant_id;
    const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, checkRestId);
    if (!settings.permissions.can_edit_menu) {
      return c.json({ error: "Forbidden: You do not have permission to manage the menu." }, 403);
    }
  }

  const { data: item } = await supabase.from('menu_items').select('name, restaurant_id').eq('id', c.req.param('id')).maybeSingle();

  const { error } = await supabase
    .from('menu_items')
    .delete()
    .eq('id', c.req.param('id'));
  
  if (error) return c.json({ error: error.message }, 500);

  if (caller && caller.email && item) {
    await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Deleted menu item: ${item.name}`, item.restaurant_id || caller.restaurantId);
  }

  return c.json({ success: true });
});

// --- COMBOS & MODIFIERS BATCH SYNC ---

menuRoutes.post("/api/batch-sync", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
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

// --- TRANSLATION ENDPOINTS ---

menuRoutes.post('/api/translate', authenticate, async (c) => {
  const { text, targetLang, restaurantContext } = await c.req.json();
  
  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: 'GEMINI_API_KEY is not configured.' }, 500);
  }

  try {
    const ai = new GoogleGenAI({ 
      apiKey: c.env.GEMINI_API_KEY!,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `
      You are a professional culinary translator.
      Translate the following food term or description from English to ${targetLang}.
      
      Term: "${text}"
      Restaurant Type: ${restaurantContext || 'General'}
      
      CRITICAL: Do NOT append any definitions, descriptions, ingredients, transliterations, or alternative/literal names in parentheses or brackets (for example: do NOT translate "Nasi Lemak" into "Nasi Lemak (Fragrant Coconut Rice)" or "椰浆饭（椰香米饭）"). Keep the translation completely concise, authentic, and direct, containing ONLY the item name itself without any parenthetical clarifications or extra comments.

      Return ONLY the translated text.
      `
    });
    
    const preText = (response.text || "").trim();
    const translatedText = sanitizeTranslationOutput(preText);
    return c.json({ translatedText });
  } catch (error: any) {
    console.error("Worker translation error:", error);
    return c.json({ error: `Translation failed: ${error?.message || error}` }, 500);
  }
});

menuRoutes.get("/api/translation-jobs", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
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

menuRoutes.patch("/api/translation-jobs/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
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

menuRoutes.patch("/api/tenant-translations", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const body = await c.req.json();
  const { restaurantId, entityId, fieldName, languageCode, translatedText } = body;
  const { data, error } = await supabase
    .from('tenant_translations')
    .update({ translated_text: translatedText })
    .eq('restaurant_id', restaurantId)
    .eq('entity_id', entityId)
    .eq('field_name', fieldName)
    .eq('language_code', languageCode)
    .select();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

menuRoutes.post("/api/public/run-background-translation", async (c) => {
  if (c.executionCtx) {
    c.executionCtx.waitUntil(runBackgroundTranslationJob(c.env));
    return c.json({ success: true, message: "Background translation job queued." });
  } else {
    await runBackgroundTranslationJob(c.env);
    return c.json({ success: true, message: "Translation job executed synchronously." });
  }
});

// Batch Translate (Public)
menuRoutes.post("/api/public/batch-translate", async (c) => {
  const supabase = getSupabase(c.env);
  const { items, categories, context } = await c.req.json();
  const { restaurantId, franchiseId, targetLanguage } = context;

  if (targetLanguage === 'en') {
    return c.json({ items, categories });
  }

  try {
    const { data: restSetting } = await supabase
      .from('restaurants')
      .select('fallback_to_original')
      .eq('id', restaurantId)
      .maybeSingle();

    const fallbackToOriginalSetting = restSetting?.fallback_to_original !== false;

    const isValidTranslation = (text: any): boolean => {
      if (text === null || text === undefined) return false;
      if (typeof text !== 'string') return false;
      const trimmed = text.trim();
      if (trimmed === '') return false;
      if (trimmed === 'null' || trimmed === 'undefined') return false;
      if (trimmed.toLowerCase() === '[translation failed]' || trimmed.toLowerCase().includes('translation failed')) return false;
      return true;
    };

    const resolveSingle = async (entityId: string, entityType: string, fieldName: string, defaultText: string) => {
      const originalText = (defaultText || '').trim();

      try {
        // 1. Branch Override
        const { data: branchData } = await supabase
          .from('branch_translations')
          .select('translated_text')
          .eq('restaurant_id', restaurantId)
          .eq('entity_id', entityId)
          .eq('language_code', targetLanguage)
          .maybeSingle();
        if (branchData && isValidTranslation(branchData.translated_text)) {
          return branchData.translated_text.trim();
        }

        // 2. Franchise
        if (franchiseId) {
          const { data: franchiseData } = await supabase
            .from('franchise_translations')
            .select('translated_text')
            .eq('franchise_id', franchiseId)
            .eq('entity_id', entityId)
            .eq('language_code', targetLanguage)
            .maybeSingle();
          if (franchiseData && isValidTranslation(franchiseData.translated_text)) {
            return franchiseData.translated_text.trim();
          }
        }

        // 3. Tenant
        const { data: tenantData } = await supabase
          .from('tenant_translations')
          .select('translated_text')
          .eq('restaurant_id', restaurantId)
          .eq('entity_id', entityId)
          .eq('entity_type', entityType)
          .eq('field_name', fieldName)
          .eq('language_code', targetLanguage)
          .maybeSingle();
        if (tenantData && isValidTranslation(tenantData.translated_text)) {
          return tenantData.translated_text.trim();
        }

        // 4. Global
        const { data: globalData } = await supabase
          .from('global_translations')
          .select('translated_text')
          .eq('term_key', (fieldName === 'name' || fieldName === 'description') ? originalText : `${entityType}_${fieldName}`)
          .eq('language_code', targetLanguage)
          .maybeSingle();
        if (globalData && isValidTranslation(globalData.translated_text)) {
          return globalData.translated_text.trim();
        }
      } catch (err: any) {
        console.warn("Translation fallback applied", {
          sourceText: originalText,
          language: targetLanguage,
          reason: `Database queries failed: ${err?.message || err}`
        });
      }

      if (fallbackToOriginalSetting) {
        console.warn("Translation fallback applied", {
          sourceText: originalText,
          language: targetLanguage,
          reason: "Translation lookup returned no result"
        });
      }
      return originalText;
    };

    const translatedItems = items ? await Promise.all(items.map(async (item: any) => {
      try {
        const name = await resolveSingle(item.id, 'menu_item', 'name', item.name);
        const description = item.description ? await resolveSingle(item.id, 'menu_item', 'description', item.description) : item.description;
        return { ...item, name, description };
      } catch (err: any) {
        console.warn("Batch item translation failed, skipping and continuing:", err);
        return item;
      }
    })) : null;

    const translatedCats = categories ? await Promise.all(categories.map(async (cat: any) => {
      try {
        const name = await resolveSingle(cat.id, 'category', 'name', cat.name);
        return { ...cat, name };
      } catch (err: any) {
        console.warn("Batch category translation failed, skipping and continuing:", err);
        return cat;
      }
    })) : null;

    return c.json({ items: translatedItems, categories: translatedCats });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Kitchen canonical name retriever
menuRoutes.get("/api/public/kitchen-canonical/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('kitchen_canonical_names')
    .select('canonical_name')
    .eq('menu_item_id', c.req.param('id'))
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export default menuRoutes;
