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
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', c.req.param('id'))
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'Restaurant not found' }, 404);
  return c.json(data);
});

// Admin Update Restaurant Details
menuRoutes.patch("/api/restaurants/:id", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
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
    const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, caller.restaurantId);
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
    const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, caller.restaurantId);
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
    const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, caller.restaurantId);
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
