import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { idempotencyService } from "../services/idempotencyService";
import { 
  ResolveSessionSchema, 
  SyncBasketItemSchema, 
  PlaceOrderSchema, 
  PaymentsSchema 
} from "../../lib/validation";

const router = Router();

// Restaurants (Public details)
router.get("/restaurants/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('restaurants')
    .select('*, franchise_id')
    .eq('id', req.params.id)
    .maybeSingle();
  
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Restaurant not found" });
  return res.json(data || {});
});

// Categories (Public details)
router.get("/restaurants/:restId/categories", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('restaurant_id', req.params.restId)
    .order('sort_order', { ascending: true });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Menu Items (Public details)
router.get("/restaurants/:restId/menu-items", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('menu_items')
    .select(`
      *,
      combo_groups (*, items:combo_group_items (*, child_product:menu_items (*, combo_groups (*, items:combo_group_items (*)), modifier_groups (*, modifiers!modifiers_group_id_fkey (*))))),
      modifier_groups (*, modifiers!modifiers_group_id_fkey (*))
    `)
    .eq('restaurant_id', req.params.restId)
    .eq('is_active', true);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Tables (Public details)
router.get("/tables/:tableId", async (req, res) => {
  const { restId } = req.query;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.tableId);
  
  let query = supabaseAdmin.from('tables').select('*');
  if (isUuid) {
    query = query.eq('id', req.params.tableId);
  } else {
    query = query.eq('restaurant_id', restId).eq('name', req.params.tableId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || {});
});

// Resolve Session
router.post("/resolve-session", async (req, res) => {
  const parsed = ResolveSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { restaurantId, tableId, deviceInfo, clientToken, fulfillment } = parsed.data;
  const { data, error } = await supabaseAdmin.rpc('resolve_dining_session_v2', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
    p_device_info: deviceInfo,
    p_client_token: clientToken,
    p_fulfillment: fulfillment
  });

  if (error && (error.code === 'PGRST202' || error.message.includes('p_fulfillment'))) {
     const retry = await supabaseAdmin.rpc('resolve_dining_session_v2', {
        p_restaurant_id: restaurantId,
        p_table_id: tableId,
        p_device_info: deviceInfo,
        p_client_token: clientToken
     });
     if (retry.error) return res.status(500).json({ error: retry.error.message });
     return res.json(retry.data);
  }

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Orders Check
router.get("/orders/check", async (req, res) => {
  const { sessionId } = req.query;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
  const cleanSessionId = isUuid ? String(sessionId) : '00000000-0000-0000-0000-000000000000';

  const { data, error, count } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact' })
    .eq('session_id', cleanSessionId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders: data, count });
});

// Baskets
router.get("/baskets", async (req, res) => {
  const { sessionId } = req.query;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
  const cleanSessionId = isUuid ? String(sessionId) : '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabaseAdmin
    .from('baskets')
    .select('id, basket_version')
    .eq('session_id', cleanSessionId)
    .eq('status', 'active')
    .maybeSingle();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Basket Items
router.get("/baskets/:basketId/items", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('basket_items')
    .select('*')
    .eq('basket_id', req.params.basketId);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Sync Basket Items (multiplayer live update)
router.post("/sync-basket-item", async (req, res) => {
  try {
    const parsed = SyncBasketItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { p_session_id, p_session_token, p_product_id, p_delta, p_configuration, p_device_info } = parsed.data;

    const { data: sessionData, error: sessionErr } = await supabaseAdmin
      .from('dining_sessions')
      .select('id, restaurant_id')
      .eq('id', p_session_id)
      .eq('session_token', p_session_token)
      .in('status', ['active', 'awaiting_payment', 'paid'])
      .maybeSingle();

    if (sessionErr || !sessionData) {
      return res.status(400).json({ error: "Invalid dining session token or inactive session" });
    }

    const restaurantId = sessionData.restaurant_id;

    const { data: basket, error: basketErr } = await supabaseAdmin
      .from('baskets')
      .select('id, basket_version')
      .eq('session_id', p_session_id)
      .eq('status', 'active')
      .maybeSingle();

    if (basketErr) return res.status(500).json({ error: basketErr.message });

    let basketId = basket?.id;
    let basketVersion = basket?.basket_version || 1;

    if (!basketId) {
      const { data: newBasket, error: newBasketErr } = await supabaseAdmin
        .from('baskets')
        .insert({
          restaurant_id: restaurantId,
          session_id: p_session_id,
          status: 'active',
          basket_version: 1
        })
        .select('id')
        .single();

      if (newBasketErr) return res.status(500).json({ error: newBasketErr.message });
      basketId = newBasket.id;
      basketVersion = 1;
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('basket_items')
      .select('*')
      .eq('basket_id', basketId);

    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    const existingItem = items?.find(item => {
      const matchId = item.product_id === p_product_id || item.menu_item_id === p_product_id;
      const matchConfig = JSON.stringify(item.configuration || {}) === JSON.stringify(p_configuration || {});
      return matchId && matchConfig;
    });

    const currentQty = existingItem ? existingItem.quantity : 0;
    const newQty = Math.max(0, currentQty + (p_delta || 0));

    if (newQty === 0) {
      if (existingItem) {
        const { error: delErr } = await supabaseAdmin
          .from('basket_items')
          .delete()
          .eq('id', existingItem.id);
        if (delErr) return res.status(500).json({ error: delErr.message });
      }
    } else {
      if (existingItem) {
        const { error: updErr } = await supabaseAdmin
          .from('basket_items')
          .update({ quantity: newQty })
          .eq('id', existingItem.id);
        if (updErr) return res.status(500).json({ error: updErr.message });
      } else {
        const insertPayload: any = {
          basket_id: basketId,
          quantity: newQty,
          configuration: p_configuration || {},
          created_by_device: p_device_info || null
        };

        let useMenuItemId = false;
        if (items && items.length > 0 && 'menu_item_id' in items[0]) {
          useMenuItemId = true;
        }

        if (useMenuItemId) {
          insertPayload.menu_item_id = p_product_id;
        } else {
          insertPayload.product_id = p_product_id;
        }

        const { error: insErr } = await supabaseAdmin
          .from('basket_items')
          .insert(insertPayload);

        if (insErr) {
          if (useMenuItemId) {
            delete insertPayload.menu_item_id;
            insertPayload.product_id = p_product_id;
          } else {
            delete insertPayload.product_id;
            insertPayload.menu_item_id = p_product_id;
          }
          const { error: insErr2 } = await supabaseAdmin
            .from('basket_items')
            .insert(insertPayload);
          if (insErr2) return res.status(500).json({ error: insErr2.message });
        }
      }
    }

    // 4. Bump Basket Version with Optimistic Lock retry loop
    let currentVer = basketVersion;
    let success = false;
    for (let attempts = 0; attempts < 5; attempts++) {
      const { data, error } = await supabaseAdmin
        .from('baskets')
        .update({ basket_version: currentVer + 1, updated_at: new Date().toISOString() })
        .eq('id', basketId)
        .eq('basket_version', currentVer)
        .select('basket_version');

      if (!error && data && data.length > 0) {
        success = true;
        break;
      }

      // Fetch the latest version and retry
      const { data: latestBasket } = await supabaseAdmin
        .from('baskets')
        .select('basket_version')
        .eq('id', basketId)
        .maybeSingle();

      if (latestBasket) {
        currentVer = latestBasket.basket_version || 1;
      } else {
        break;
      }
    }

    // Fallback if loop didn't succeed to update with lock
    if (!success) {
      await supabaseAdmin
        .from('baskets')
        .update({ basket_version: currentVer + 1, updated_at: new Date().toISOString() })
        .eq('id', basketId);
    }

    res.json({ basket_id: basketId, new_quantity: newQty });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Place Order (Guest Checkout)
router.post("/place-order", async (req, res) => {
  const parsed = PlaceOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { data, error } = await supabaseAdmin.rpc('place_order_v3', parsed.data);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get Order Details (Guest Checkout)
router.get("/orders/:id", async (req, res) => {
  const { sessionId } = req.query;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));

  let query = supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', req.params.id);

  if (isUuid) {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query.single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get Session Orders (Guest Checkout)
router.get("/dining-sessions/:sessionId/orders", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('session_id', req.params.sessionId)
    .neq('status', 'cancelled');
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Mark order paid (Guest Session integration callback)
router.post("/orders/:id/mark-paid", async (req, res) => {
  const { sessionToken } = req.body;
  const { data: session } = await supabaseAdmin
    .from('dining_sessions')
    .select('id')
    .eq('token', sessionToken)
    .single();
  
  if (!session) return res.status(401).json({ error: "Invalid session token" });

  const { data: existingOrder } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', req.params.id)
    .eq('session_id', session.id)
    .single();

  if (existingOrder && existingOrder.paid_at) {
    return res.json(existingOrder);
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ 
      paid_at: new Date().toISOString(), 
      status: 'confirmed', 
      payment_method: 'online' 
    })
    .eq('id', req.params.id)
    .eq('session_id', session.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Remove order due to failed payment (Guest Session prepaid cleanup callback)
router.post("/orders/:id/payment-failed", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .delete()
    .eq('id', req.params.id);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: "Order deleted due to failed payment." });
});

// Mark dining session paid (Guest Session integration callback)
router.post("/dining-sessions/:id/mark-paid", async (req, res) => {
  const { sessionToken } = req.body;
  const { data: session } = await supabaseAdmin
    .from('dining_sessions')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('token', sessionToken)
    .single();
  
  if (!session) return res.status(401).json({ error: "Invalid session token" });

  if (session.status === 'paid') {
    const { data: fullSession } = await supabaseAdmin
      .from('dining_sessions')
      .select('*')
      .eq('id', session.id)
      .single();
    return res.json(fullSession || session);
  }

  const now = new Date().toISOString();
  await supabaseAdmin.from('orders')
    .update({ 
      paid_at: now, 
      status: 'confirmed', 
      payment_method: 'online' 
    })
    .eq('session_id', session.id)
    .is('paid_at', null)
    .neq('status', 'cancelled');

  const { data, error } = await supabaseAdmin.from('dining_sessions')
    .update({
      status: 'paid',
      closed_at: now
    })
    .eq('id', session.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Manage digital payments creation
router.post("/payments", async (req, res) => {
  try {
    const parsed = PaymentsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { restaurantId, orderId, amount, method, provider, metadata, idempotency_key, idempotencyKey } = parsed.data;
    const idempotencyKeyResolved = idempotency_key || idempotencyKey;

    if (idempotencyKeyResolved) {
      // 1. Concurrency Check & Lock utilizing high-quality idempotencyService
      const lockAcquired = await idempotencyService.acquireLock(idempotencyKeyResolved);
      if (!lockAcquired.success) {
        const record = lockAcquired.record;
        if (record?.status === 'completed') {
          return res.json(record.result);
        }
        return res.status(409).json({ error: "Another payment with this transaction id is currently processing. Please wait or retry." });
      }

      // 2. DB Replay Check (existing column lookup or metadata lookup)
      const { data: existingCol } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('idempotency_key', idempotencyKeyResolved)
        .maybeSingle();

      if (existingCol) {
        idempotencyService.set(idempotencyKeyResolved, {
          status: 'completed',
          result: existingCol,
          createdAt: Date.now()
        });
        return res.json(existingCol);
      }

      const { data: existingMeta } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('metadata->>idempotency_key', idempotencyKeyResolved)
        .maybeSingle();

      if (existingMeta) {
        idempotencyService.set(idempotencyKeyResolved, {
          status: 'completed',
          result: existingMeta,
          createdAt: Date.now()
        });
        return res.json(existingMeta);
      }
    }

    const newMetadata = {
      ...(metadata || {}),
      idempotency_key: idempotencyKeyResolved
    };

    const insertPayload: any = {
      restaurant_id: restaurantId,
      order_id: orderId,
      amount: amount,
      payment_method: method,
      provider: provider,
      status: 'pending',
      metadata: newMetadata,
      idempotency_key: idempotencyKeyResolved
    };

    // 3. Unique SQL-level attempt with duplicate key catching fallback
    const { data: successData, error: dbError } = await supabaseAdmin
      .from('payments')
      .insert(insertPayload)
      .select()
      .single();

    if (dbError) {
      // Catch unique database constraint violations (pg code 23505) or custom unique errors
      if (dbError.code === '23505' || dbError.message?.toLowerCase().includes('unique') || dbError.message?.toLowerCase().includes('duplicate')) {
        // Retrieve the duplicate row and return it as standard replay protection
        const { data: reloadedCol } = await supabaseAdmin
          .from('payments')
          .select('*')
          .eq('idempotency_key', idempotencyKeyResolved)
          .maybeSingle();

        const reloaded = reloadedCol || (await supabaseAdmin
          .from('payments')
          .select('*')
          .eq('metadata->>idempotency_key', idempotencyKeyResolved)
          .maybeSingle()).data;

        if (reloaded) {
          if (idempotencyKeyResolved) {
            idempotencyService.set(idempotencyKeyResolved, {
              status: 'completed',
              result: reloaded,
              createdAt: Date.now()
            });
          }
          return res.json(reloaded);
        }
      }

      // If schema error because column doesn't exist yet (PGRST204) or missing, fallback to inserting without the column
      if (dbError.message?.includes('idempotency_key') || dbError.code === 'PGRST204') {
        const fallbackPayload = {
          restaurant_id: restaurantId,
          order_id: orderId,
          amount: amount,
          payment_method: method,
          provider: provider,
          status: 'pending',
          metadata: newMetadata
        };
        const { data: fallbackData, error: fallbackError } = await supabaseAdmin
          .from('payments')
          .insert(fallbackPayload)
          .select()
          .single();

        if (fallbackError) {
          if (idempotencyKeyResolved) {
            idempotencyService.set(idempotencyKeyResolved, {
              status: 'failed',
              error: fallbackError.message,
              createdAt: Date.now()
            });
          }
          return res.status(500).json({ error: fallbackError.message });
        }

        if (idempotencyKeyResolved) {
          idempotencyService.set(idempotencyKeyResolved, {
            status: 'completed',
            result: fallbackData,
            createdAt: Date.now()
          });
        }
        return res.json(fallbackData);
      }

      if (idempotencyKeyResolved) {
        idempotencyService.set(idempotencyKeyResolved, {
          status: 'failed',
          error: dbError.message,
          createdAt: Date.now()
        });
      }
      return res.status(500).json({ error: dbError.message });
    }

    if (idempotencyKeyResolved) {
      idempotencyService.set(idempotencyKeyResolved, {
        status: 'completed',
        result: successData,
        createdAt: Date.now()
      });
    }
    return res.json(successData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize digital payment qr triggers
router.post("/payments/:id/initialize", async (req, res) => {
  const { id } = req.params;
  const { data: payment, error: pError } = await supabaseAdmin.from('payments').select('*').eq('id', id).single();
  if (pError) return res.status(500).json({ error: pError.message });

  await supabaseAdmin.from('payment_attempts').insert({
    payment_id: id,
    status: 'initiated'
  });

  switch (payment.payment_method) {
    case 'duitnow':
    case 'tng':
      return res.json({
        paymentId: payment.id,
        provider: payment.provider,
        paymentMethod: payment.payment_method,
        qrData: `00020101021126600010com.paynet.qr0111MY123456780211MY123456780303001520400005303458540${payment.amount.toFixed(2)}5802MY5907POS_SAAS6008Lumpur6105500006304`
      });
    case 'fpx':
    case 'card':
      return res.json({
        paymentId: payment.id,
        provider: payment.provider,
        paymentMethod: payment.payment_method,
        redirectUrl: '/simulated-gateway'
      });
    default:
      res.status(400).json({ error: "Unsupported method" });
  }
});

// Check digital payment statuses
router.get("/payments/:id/status", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('status')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Simulate checkout simulation successes
router.post("/payments/:id/simulate-success", async (req, res) => {
  const { id } = req.params;
  const { data: payment, error: fetchError } = await supabaseAdmin
    .from('payments')
    .select('order_id')
    .eq('id', id)
    .single();
  
  if (fetchError) return res.status(500).json({ error: fetchError.message });

  const paidAt = new Date().toISOString();
  await supabaseAdmin.from('payments').update({ 
    status: 'paid',
    paid_at: paidAt,
    external_id: `SIM_${Math.random().toString(36).substring(7).toUpperCase()}`
  }).eq('id', id);

  await supabaseAdmin.from('orders').update({ 
    paid_at: paidAt,
    status: 'confirmed'
  }).eq('id', payment.order_id);

  await supabaseAdmin.from('payment_attempts').insert({
    payment_id: id,
    status: 'success',
    provider_response: { mode: 'simulation', timestamp: paidAt }
  });

  res.json({ success: true });
});

// Batch translate menus for specific guests languages
router.post("/batch-translate", async (req, res) => {
  const { items, categories, context } = req.body;
  const { restaurantId, franchiseId, targetLanguage } = context;

  if (targetLanguage === 'en') {
    return res.json({ items, categories });
  }

  try {
    const { data: restSetting } = await supabaseAdmin
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
        const { data: branchData } = await supabaseAdmin
          .from('branch_translations')
          .select('translated_text')
          .eq('restaurant_id', restaurantId)
          .eq('entity_id', entityId)
          .eq('language_code', targetLanguage)
          .maybeSingle();
        if (branchData && isValidTranslation(branchData.translated_text)) {
          return branchData.translated_text.trim();
        }

        if (franchiseId) {
          const { data: franchiseData } = await supabaseAdmin
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

        const { data: tenantData } = await supabaseAdmin
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

        const { data: globalData } = await supabaseAdmin
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

      const reasonStr = "Translation lookup returned no result";
      if (fallbackToOriginalSetting) {
        console.warn("Translation fallback applied", {
          sourceText: originalText,
          language: targetLanguage,
          reason: reasonStr
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

    res.json({ items: translatedItems, categories: translatedCats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Canonical print helpers
router.get("/kitchen-canonical/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('kitchen_canonical_names')
    .select('canonical_name')
    .eq('menu_item_id', req.params.id)
    .maybeSingle();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
