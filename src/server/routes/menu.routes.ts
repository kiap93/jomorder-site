import { Router } from "express";
import { supabaseAdmin, getStaffSettings } from "../services/dbService";
import { detectLanguageAndTranslate } from "../services/translationService";
import { logToAudit } from "../services/auditService";
import { authenticateJWT } from "../middleware/authMiddleware";

const router = Router();

// Categories
router.get("/restaurants/:restId/categories", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('restaurant_id', req.params.restId)
    .order('sort_order', { ascending: true });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/categories", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert(req.body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/categories/:id", authenticateJWT, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('categories')
    .delete()
    .eq('id', req.params.id);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Menu Items
router.get("/restaurants/:restId/menu-items", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('menu_items')
    .select(`
      *,
      display_behavior,
      combo_groups (
        *,
        combo_group_items (
          *,
          child_product:menu_items (
            id,
            name,
            base_price,
            product_type
          )
        )
      ),
      modifier_groups (
        *,
        modifiers!modifiers_group_id_fkey (*)
      )
    `)
    .eq('restaurant_id', req.params.restId);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/menu-items", authenticateJWT, async (req, res) => {
  const caller = (req as any).user;
  if (caller && caller.is_platform_admin !== true) {
    const settings = getStaffSettings(caller.id, caller.role);
    if (!settings.permissions.can_edit_menu) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to manage the menu." });
    }
  }

  const body = req.body;
  const originalNames: { lang: string; text: string }[] = [];
  const originalDescs: { lang: string; text: string }[] = [];

  if (body.name && body.name.trim()) {
    const result = await detectLanguageAndTranslate(body.name.trim());
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalNames.push({ lang: result.languageCode, text: body.name.trim() });
      body.name = result.englishTranslation;
    }
  }

  if (body.description && body.description.trim()) {
    const result = await detectLanguageAndTranslate(body.description.trim());
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalDescs.push({ lang: result.languageCode, text: body.description.trim() });
      body.description = result.englishTranslation;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('menu_items')
    .insert(body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });

  if (data && data.id) {
    for (const item of originalNames) {
      await supabaseAdmin.from('tenant_translations').upsert({
        restaurant_id: data.restaurant_id || caller.restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'name',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }
    for (const item of originalDescs) {
      await supabaseAdmin.from('tenant_translations').upsert({
        restaurant_id: data.restaurant_id || caller.restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'description',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }
  }

  if (caller && caller.email) {
    logToAudit(caller.id, caller.email, caller.role, `Added menu item: ${data?.name || 'Dish'}`, data?.restaurant_id || caller.restaurantId);
  }

  res.json(data);
});

router.patch("/menu-items/:id", authenticateJWT, async (req, res) => {
  const caller = (req as any).user;
  if (caller && caller.is_platform_admin !== true) {
    const settings = getStaffSettings(caller.id, caller.role);
    if (!settings.permissions.can_edit_menu) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to manage the menu." });
    }
  }

  const body = req.body;
  const originalNames: { lang: string; text: string }[] = [];
  const originalDescs: { lang: string; text: string }[] = [];

  if (body.name && body.name.trim()) {
    const result = await detectLanguageAndTranslate(body.name.trim());
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalNames.push({ lang: result.languageCode, text: body.name.trim() });
      body.name = result.englishTranslation;
    }
  }

  if (body.description && body.description.trim()) {
    const result = await detectLanguageAndTranslate(body.description.trim());
    if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
      originalDescs.push({ lang: result.languageCode, text: body.description.trim() });
      body.description = result.englishTranslation;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('menu_items')
    .update(body)
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });

  if (data && data.id) {
    for (const item of originalNames) {
      await supabaseAdmin.from('tenant_translations').upsert({
        restaurant_id: data.restaurant_id || caller.restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'name',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }
    for (const item of originalDescs) {
      await supabaseAdmin.from('tenant_translations').upsert({
        restaurant_id: data.restaurant_id || caller.restaurantId,
        entity_type: 'menu_item',
        entity_id: data.id,
        field_name: 'description',
        language_code: item.lang,
        translated_text: item.text,
        override_global: true
      }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });
    }
  }

  if (caller && caller.email) {
    logToAudit(caller.id, caller.email, caller.role, `Updated menu item: ${data?.name || req.params.id}`, data?.restaurant_id || caller.restaurantId);
  }

  res.json(data);
});

router.delete("/menu-items/:id", authenticateJWT, async (req, res) => {
  const caller = (req as any).user;
  if (caller && caller.is_platform_admin !== true) {
    const settings = getStaffSettings(caller.id, caller.role);
    if (!settings.permissions.can_edit_menu) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to manage the menu." });
    }
  }

  const { data: item } = await supabaseAdmin.from('menu_items').select('name, restaurant_id').eq('id', req.params.id).maybeSingle();

  const { error } = await supabaseAdmin
    .from('menu_items')
    .delete()
    .eq('id', req.params.id);
  
  if (error) return res.status(500).json({ error: error.message });

  if (caller && caller.email && item) {
    logToAudit(caller.id, caller.email, caller.role, `Deleted menu item: ${item.name}`, item.restaurant_id || caller.restaurantId);
  }

  res.json({ success: true });
});

// Sub-collections sync (Combo/Modifier groups)
router.post("/batch-sync", authenticateJWT, async (req, res) => {
  const { entity, productId, data } = req.body;
  try {
    if (entity === 'combo_groups') {
      await supabaseAdmin.from('combo_groups').delete().eq('combo_product_id', productId);
      if (data && data.length > 0) {
        for (const group of data) {
          const { data: newGroup, error: groupError } = await supabaseAdmin
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
            await supabaseAdmin.from('combo_group_items').insert(items);
          }
        }
      }
    } else if (entity === 'modifier_groups') {
      await supabaseAdmin.from('modifier_groups').delete().eq('product_id', productId);
      if (data && data.length > 0) {
        for (const group of data) {
          const { data: newGroup, error: groupError } = await supabaseAdmin
            .from('modifier_groups')
            .insert({
              product_id: productId,
              parent_modifier_id: group.parent_modifier_id,
              name: group.name,
              required: group.required,
              min_select: group.min_select,
              max_select: group.max_select,
              display_behavior: group.display_behavior,
              sort_order: group.sort_order
            })
            .select().single();
          
          if (groupError) throw groupError;
          if (group.modifiers && group.modifiers.length > 0) {
            const modifiers = group.modifiers.map((m: any) => ({ ...m, group_id: newGroup.id }));
            await supabaseAdmin.from('modifiers').insert(modifiers);
          }
        }
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
