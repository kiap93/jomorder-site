import { Router } from "express";
import { supabaseAdmin, getStaffSettings } from "../services/dbService";
import { detectLanguageAndTranslate } from "../services/translationService";
import { logToAudit } from "../services/auditService";
import { authenticateJWT, requireTenantIsolation, requirePermissions, requireAnyPermission, AuthenticatedRequest } from "../middleware/authMiddleware";

const router = Router();

// Categories
router.get("/restaurants/:restId/categories", authenticateJWT, requireTenantIsolation('restId'), requireAnyPermission('orders.view', 'kitchen.view'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('restaurant_id', req.params.restId)
    .order('sort_order', { ascending: true });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/categories", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert(req.body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete("/categories/:id", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('categories')
    .delete()
    .eq('id', req.params.id);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Menu Items
router.get("/restaurants/:restId/menu-items", authenticateJWT, requireTenantIsolation('restId'), requireAnyPermission('orders.view', 'kitchen.view'), async (req, res) => {
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

router.post("/menu-items", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req: AuthenticatedRequest, res) => {
  const caller = req.user;
  if (!caller) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  if (caller.is_platform_admin !== true) {
    const settings = getStaffSettings(caller.id, caller.role);
    if (!settings.permissions.can_edit_menu) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to manage the menu." });
    }
  }

  const body = req.body;
  const originalNameInput = body.name?.trim();
  const originalDescInput = body.description?.trim();

  const { data, error } = await supabaseAdmin
    .from('menu_items')
    .insert(body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });

  // Fire-and-forget background translations
  if (data && data.id) {
    const restaurantId = data.restaurant_id || caller.restaurantId;
    Promise.resolve().then(async () => {
      try {
        console.log(`[Background AI POST] Translating item ${data.id} in background`);
        
        if (originalNameInput) {
          const result = await detectLanguageAndTranslate(originalNameInput);
          if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
            await supabaseAdmin.from('tenant_translations').upsert({
              restaurant_id: restaurantId,
              entity_type: 'menu_item',
              entity_id: data.id,
              field_name: 'name',
              language_code: result.languageCode,
              translated_text: originalNameInput,
              translation_status: 'translated',
              override_global: true
            }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

            const cleanedName = result.englishTranslation;
            if (cleanedName && cleanedName !== originalNameInput) {
              await supabaseAdmin.from('menu_items').update({ name: cleanedName }).eq('id', data.id);
            }
          }
        }

        if (originalDescInput) {
          const result = await detectLanguageAndTranslate(originalDescInput);
          if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
            await supabaseAdmin.from('tenant_translations').upsert({
              restaurant_id: restaurantId,
              entity_type: 'menu_item',
              entity_id: data.id,
              field_name: 'description',
              language_code: result.languageCode,
              translated_text: originalDescInput,
              translation_status: 'translated',
              override_global: true
            }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

            const cleanedDesc = result.englishTranslation;
            if (cleanedDesc && cleanedDesc !== originalDescInput) {
              await supabaseAdmin.from('menu_items').update({ description: cleanedDesc }).eq('id', data.id);
            }
          }
        }

        // Queue translation jobs for target languages inside translation_jobs
        const targetLangs = ['zh', 'ms', 'th', 'ja', 'ko'];
        for (const lang of targetLangs) {
          if (body.name || originalNameInput) {
            await supabaseAdmin.from('translation_jobs').upsert({
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

          if (body.description || originalDescInput) {
            await supabaseAdmin.from('translation_jobs').upsert({
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
      } catch (err) {
        console.error("[Background AI POST] Error running translation:", err);
      }
    });
  }

  if (caller && caller.email) {
    logToAudit(caller.id, caller.email, caller.role, `Added menu item: ${data?.name || 'Dish'}`, data?.restaurant_id || caller.restaurantId);
  }

  res.json(data);
});

router.patch("/menu-items/:id", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req: AuthenticatedRequest, res) => {
  const caller = req.user;
  if (!caller) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  if (caller.is_platform_admin !== true) {
    const settings = getStaffSettings(caller.id, caller.role);
    if (!settings.permissions.can_edit_menu) {
      return res.status(403).json({ error: "Forbidden: You do not have permission to manage the menu." });
    }
  }

  const body = req.body;
  const originalNameInput = body.name?.trim();
  const originalDescInput = body.description?.trim();

  const { data, error } = await supabaseAdmin
    .from('menu_items')
    .update(body)
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });

  // Fire-and-forget background translations
  if (data && data.id) {
    const restaurantId = data.restaurant_id || caller.restaurantId;
    Promise.resolve().then(async () => {
      try {
        console.log(`[Background AI PATCH] Translating item ${data.id} in background`);
        
        if (originalNameInput) {
          const result = await detectLanguageAndTranslate(originalNameInput);
          if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
            await supabaseAdmin.from('tenant_translations').upsert({
              restaurant_id: restaurantId,
              entity_type: 'menu_item',
              entity_id: data.id,
              field_name: 'name',
              language_code: result.languageCode,
              translated_text: originalNameInput,
              translation_status: 'translated',
              override_global: true
            }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

            const cleanedName = result.englishTranslation;
            if (cleanedName && cleanedName !== originalNameInput) {
              await supabaseAdmin.from('menu_items').update({ name: cleanedName }).eq('id', data.id);
            }
          }
        }

        if (originalDescInput) {
          const result = await detectLanguageAndTranslate(originalDescInput);
          if (result && !result.isEnglish && result.languageCode && result.englishTranslation) {
            await supabaseAdmin.from('tenant_translations').upsert({
              restaurant_id: restaurantId,
              entity_type: 'menu_item',
              entity_id: data.id,
              field_name: 'description',
              language_code: result.languageCode,
              translated_text: originalDescInput,
              translation_status: 'translated',
              override_global: true
            }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

            const cleanedDesc = result.englishTranslation;
            if (cleanedDesc && cleanedDesc !== originalDescInput) {
              await supabaseAdmin.from('menu_items').update({ description: cleanedDesc }).eq('id', data.id);
            }
          }
        }

        // Queue translation jobs for target languages inside translation_jobs on update
        const targetLangs = ['zh', 'ms', 'th', 'ja', 'ko'];
        for (const lang of targetLangs) {
          if (body.name || originalNameInput) {
            await supabaseAdmin.from('translation_jobs').upsert({
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

          if (body.description || originalDescInput) {
            await supabaseAdmin.from('translation_jobs').upsert({
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
      } catch (err) {
        console.error("[Background AI PATCH] Error updating translations:", err);
      }
    });
  }

  if (caller && caller.email) {
    logToAudit(caller.id, caller.email, caller.role, `Updated menu item: ${data?.name || req.params.id}`, data?.restaurant_id || caller.restaurantId);
  }

  res.json(data);
});

router.delete("/menu-items/:id", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req: AuthenticatedRequest, res) => {
  const caller = req.user;
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
router.post("/batch-sync", authenticateJWT, requirePermissions('settings.manage'), async (req: AuthenticatedRequest, res) => {
  const caller = req.user;
  const userRestId = caller?.restaurantId || caller?.restaurant_id;

  // Derive tenant ownership check for batch-sync target item
  if (caller && caller.platform_role !== 'superadmin' && caller.is_platform_admin !== true) {
    const { productId } = req.body;
    if (productId) {
      const { data: menuCheck } = await supabaseAdmin
        .from('menu_items')
        .select('restaurant_id')
        .eq('id', productId)
        .maybeSingle();

      if (!menuCheck || menuCheck.restaurant_id !== userRestId) {
        return res.status(403).json({ error: "Forbidden: Multi-tenant isolation violation on target menu item." });
      }
    }
  }

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
