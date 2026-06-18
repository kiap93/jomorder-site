import { Hono } from 'hono';
import crypto from 'crypto';
import { Bindings, Variables } from '../types';
import { getSupabase, getStaffSettingsFromDb, logToAuditDb } from '../services/db_service';
import { authenticate } from '../middleware/auth';
import { ResolveSessionSchema, SyncBasketItemSchema, PlaceOrderSchema } from '../../src/lib/validation';

const orderRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// --- TABLES & CHECK-IN (PUBLIC) ---

orderRoutes.get('/api/public/tables/:tableId', async (c) => {
  const supabase = getSupabase(c.env);
  const restId = c.req.query('restId');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.req.param('tableId'));
  
  let query = supabase.from('tables').select('id,restaurant_id,name,status,created_at');
  if (isUuid) {
    query = query.eq('id', c.req.param('tableId'));
  } else {
    query = query.eq('restaurant_id', restId).eq('name', c.req.param('tableId'));
  }

  const { data, error } = await query.maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.post('/api/public/resolve-session', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const parsed = ResolveSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { restaurantId, tableId, deviceInfo, clientToken, fulfillment } = parsed.data;
  
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

// --- BASKETS (PUBLIC) ---

orderRoutes.get('/api/public/baskets', async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
  const cleanSessionId = isUuid ? String(sessionId) : '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabase
    .from('baskets')
    .select('id, basket_version')
    .eq('session_id', cleanSessionId)
    .eq('status', 'active')
    .maybeSingle();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.get('/api/public/baskets/:basketId/items', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('basket_items')
    .select('id,basket_id,product_id,quantity,configuration,device_info,created_at,updated_at')
    .eq('basket_id', c.req.param('basketId'));
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

orderRoutes.post('/api/public/sync-basket-item', async (c) => {
  const supabase = getSupabase(c.env);
  try {
    const body = await c.req.json();
    const parsed = SyncBasketItemSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const { p_session_id, p_session_token, p_product_id, p_delta, p_configuration, p_device_info } = parsed.data;

    // 1. Session Token Validation
    const { data: sessionData, error: sessionErr } = await supabase
      .from('dining_sessions')
      .select('id, restaurant_id')
      .eq('id', p_session_id)
      .eq('session_token', p_session_token)
      .in('status', ['active', 'awaiting_payment', 'paid'])
      .maybeSingle();

    if (sessionErr || !sessionData) {
      return c.json({ error: "Invalid dining session token or inactive session" }, 400);
    }

    const restaurantId = sessionData.restaurant_id;

    // 2. Resolve Active Basket
    const { data: basket, error: basketErr } = await supabase
      .from('baskets')
      .select('id, basket_version')
      .eq('session_id', p_session_id)
      .eq('status', 'active')
      .maybeSingle();

    if (basketErr) return c.json({ error: basketErr.message }, 500);

    let basketId = basket?.id;
    let basketVersion = basket?.basket_version || 1;

    if (!basketId) {
      const { data: newBasket, error: newBasketErr } = await supabase
        .from('baskets')
        .insert({
          restaurant_id: restaurantId,
          session_id: p_session_id,
          status: 'active',
          basket_version: 1
        })
        .select('id')
        .single();

      if (newBasketErr) return c.json({ error: newBasketErr.message }, 500);
      basketId = newBasket.id;
      basketVersion = 1;
    }

    // 3. Fetch current basket items to handle merge and identify column names
    const { data: items, error: itemsErr } = await supabase
      .from('basket_items')
      .select('id,basket_id,product_id,quantity,configuration,device_info,created_at,updated_at')
      .eq('basket_id', basketId);

    if (itemsErr) return c.json({ error: itemsErr.message }, 500);

    const existingItem = items?.find((item: any) => {
      const matchId = item.product_id === p_product_id || item.menu_item_id === p_product_id;
      const matchConfig = JSON.stringify(item.configuration || {}) === JSON.stringify(p_configuration || {});
      return matchId && matchConfig;
    });

    const currentQty = existingItem ? existingItem.quantity : 0;
    const newQty = Math.max(0, currentQty + (p_delta || 0));

    if (newQty === 0) {
      if (existingItem) {
        const { error: delErr } = await supabase
          .from('basket_items')
          .delete()
          .eq('id', existingItem.id);
        if (delErr) return c.json({ error: delErr.message }, 500);
      }
    } else {
      if (existingItem) {
        const { error: updErr } = await supabase
          .from('basket_items')
          .update({ quantity: newQty })
          .eq('id', existingItem.id);
        if (updErr) return c.json({ error: updErr.message }, 500);
      } else {
        const insertPayload: any = {
          basket_id: basketId,
          quantity: newQty,
          configuration: p_configuration || {},
          created_by_device: p_device_info || null
        };

        // Determine which column name is used
        let useMenuItemId = false;
        if (items && items.length > 0 && 'menu_item_id' in items[0]) {
          useMenuItemId = true;
        }

        if (useMenuItemId) {
          insertPayload.menu_item_id = p_product_id;
        } else {
          insertPayload.product_id = p_product_id;
        }

        const { error: insErr } = await supabase
          .from('basket_items')
          .insert(insertPayload);

        if (insErr) {
          // Retry with alternative column mapping
          if (useMenuItemId) {
            delete insertPayload.menu_item_id;
            insertPayload.product_id = p_product_id;
          } else {
            delete insertPayload.product_id;
            insertPayload.menu_item_id = p_product_id;
          }
          const { error: insErr2 } = await supabase
            .from('basket_items')
            .insert(insertPayload);
          if (insErr2) return c.json({ error: insErr2.message }, 500);
        }
      }
    }

     // 4. Bump Basket Version with Optimistic Lock retry loop
    let currentVer = basketVersion;
    let success = false;
    for (let attempts = 0; attempts < 5; attempts++) {
      const { data, error } = await supabase
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
      const { data: latestBasket } = await supabase
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
      await supabase
        .from('baskets')
        .update({ basket_version: currentVer + 1, updated_at: new Date().toISOString() })
        .eq('id', basketId);
    }

    return c.json({ basket_id: basketId, new_quantity: newQty });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- ORDERS (PUBLIC) ---

orderRoutes.get('/api/public/orders/check', async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
  const cleanSessionId = isUuid ? String(sessionId) : '00000000-0000-0000-0000-000000000000';

  const { data, error, count } = await supabase
    .from('orders')
    .select('id', { count: 'exact' })
    .eq('session_id', cleanSessionId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ orders: data, count });
});

orderRoutes.post('/api/public/place-order', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const parsed = PlaceOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { data, error } = await supabase.rpc('place_order_v3', parsed.data);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.get('/api/public/orders/:id', async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));

  let query = supabase
    .from('orders')
    .select('id,restaurant_id,table_id,session_id,order_type,status,total_price,payment_method,payment_id,paid_at,idempotency_key,session_token,items,created_at,updated_at,tables(name)')
    .eq('id', c.req.param('id'));

  if (isUuid) {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query.single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.get('/api/public/dining-sessions/:sessionId/orders', async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('orders')
    .select('id,restaurant_id,table_id,session_id,order_type,status,total_price,payment_method,payment_id,paid_at,idempotency_key,session_token,items,created_at,updated_at,tables(name)')
    .eq('session_id', c.req.param('sessionId'))
    .neq('status', 'cancelled');
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.post('/api/public/orders/:id/mark-paid', async (c) => {
  const supabase = getSupabase(c.env);
  const { sessionToken } = await c.req.json();
  const { data: session } = await supabase
    .from('dining_sessions')
    .select('id')
    .eq('token', sessionToken)
    .single();
  
  if (!session) return c.json({ error: 'Invalid session token' }, 401);

  // Idempotency check
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id,restaurant_id,table_id,session_id,order_type,status,total_price,payment_method,payment_id,paid_at,idempotency_key,session_token,items,created_at,updated_at')
    .eq('id', c.req.param('id'))
    .eq('session_id', session.id)
    .single();

  if (existingOrder && existingOrder.paid_at) {
    return c.json(existingOrder);
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ 
      paid_at: new Date().toISOString(), 
      status: 'confirmed', 
      payment_method: 'online' 
    })
    .eq('id', c.req.param('id'))
    .eq('session_id', session.id)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.post('/api/public/dining-sessions/:id/mark-paid', async (c) => {
  const supabase = getSupabase(c.env);
  const { sessionToken } = await c.req.json();
  const { data: session } = await supabase
    .from('dining_sessions')
    .select('id, status')
    .eq('id', c.req.param('id'))
    .eq('token', sessionToken)
    .single();
  
  if (!session) return c.json({ error: 'Invalid session token' }, 401);

  if (session.status === 'paid') {
    const { data: fullSession } = await supabase
      .from('dining_sessions')
      .select('id,restaurant_id,table_id,session_token,status,started_at,last_activity_at,closed_at,created_by_device,metadata')
      .eq('id', session.id)
      .single();
    return c.json(fullSession || session);
  }

  const now = new Date().toISOString();
  await supabase.from('orders')
    .update({ 
      paid_at: now, 
      status: 'confirmed', 
      payment_method: 'online' 
    })
    .eq('session_id', session.id)
    .is('paid_at', null)
    .neq('status', 'cancelled');

  const { data, error } = await supabase.from('dining_sessions')
    .update({
      status: 'paid',
      closed_at: now
    })
    .eq('id', session.id)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// --- TABLES & MANAGEMENT (ADMIN) ---

orderRoutes.get("/api/restaurants/:restId/tables", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('tables')
    .select('*, current_session:dining_sessions!tables_current_session_id_fkey(*)')
    .eq('restaurant_id', c.req.param('restId'))
    .order('name', { ascending: true });
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

orderRoutes.post("/api/tables", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('tables')
    .insert(body)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.patch("/api/tables/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('tables')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

orderRoutes.delete("/api/tables/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { error } = await supabase
    .from('tables')
    .delete()
    .eq('id', c.req.param('id'));
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

// --- ORDERS & KITCHEN DISPLAY SYSTEM (ADMIN) ---

orderRoutes.get("/api/restaurants/:restId/orders", authenticate, async (c) => {
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

orderRoutes.patch("/api/orders/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const caller = c.get('user');
  const orderId = c.req.param('id');

  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*, restaurants(*)')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) throw orderErr;
    if (!order) return c.json({ error: "Order not found." }, 404);

    const restId = order.restaurant_id || caller?.restaurantId || "default";

    if (caller && caller.is_platform_admin !== true) {
      const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
      
      if (body.status === 'cancelled' && !settings.permissions.can_cancel_order) {
        return c.json({ error: "Forbidden: You do not have permission to cancel orders." }, 403);
      }

      if (body.status === 'confirmed' && caller.role === 'runner') {
        return c.json({ error: "Forbidden: Runners cannot confirm orders." }, 403);
      }
    }

    const auditAction = body.auditAction;
    delete body.auditAction;

    const allowedColumns = [
      'restaurant_id',
      'table_id',
      'session_id',
      'order_type',
      'status',
      'total_price',
      'payment_method',
      'payment_id',
      'paid_at',
      'idempotency_key',
      'session_token',
      'items',
      'created_at',
      'updated_at',
      'discount',
      'voided',
      'void_reason',
      'voided_by',
      'voided_at',
      'void_approved_by'
    ];

    const camelCaseMap: Record<string, string> = {
      restaurantId: 'restaurant_id',
      tableId: 'table_id',
      sessionId: 'session_id',
      orderType: 'order_type',
      totalPrice: 'total_price',
      paymentMethod: 'payment_method',
      paymentId: 'payment_id',
      paidAt: 'paid_at',
      idempotencyKey: 'idempotency_key',
      sessionToken: 'session_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      voidReason: 'void_reason',
      voidedBy: 'voided_by',
      voidedAt: 'voided_at',
      voidApprovedBy: 'void_approved_by'
    };

    const updatePayload: Record<string, any> = {};
    for (const key of Object.keys(body)) {
      const dbColumn = camelCaseMap[key] || key;
      if (allowedColumns.includes(dbColumn) && body[key] !== undefined) {
        updatePayload[dbColumn] = body[key];
      }
    }

    // Recalculate total_price dynamically if items or discount is being altered
    if (updatePayload['items'] !== undefined || updatePayload['discount'] !== undefined) {
      const items = updatePayload['items'] !== undefined ? updatePayload['items'] : order.items;
      const discount = updatePayload['discount'] !== undefined ? updatePayload['discount'] : order.discount;

      let rawSubtotal = 0;
      if (Array.isArray(items)) {
        items.forEach((item: any) => {
          if (item.voided || item.status === 'voided' || item.status === 'cancelled') {
            return;
          }
          const price = item.price || item.originalUnitPrice || 0;
          const qty = item.quantity || 1;
          const itemTotal = price * qty;

          let itemDiscountAmt = 0;
          if (item.discount) {
            if (item.discount.type === 'percentage') {
              itemDiscountAmt = itemTotal * (item.discount.value / 100);
            } else {
              itemDiscountAmt = Math.min(itemTotal, item.discount.value * qty);
            }
          }
          rawSubtotal += (itemTotal - itemDiscountAmt);
        });
      }

      let orderDiscAmt = 0;
      if (discount) {
        if (discount.type === 'percentage') {
          orderDiscAmt = rawSubtotal * (discount.value / 100);
        } else {
          orderDiscAmt = Math.min(rawSubtotal, discount.value);
        }
      }

      const netSubtotal = Math.max(0, rawSubtotal - orderDiscAmt);

      const restaurant = (order as any).restaurants || {};
      const scRate = (restaurant.service_charge || 0) / 100;

      let sstRate = (restaurant.sst || 0) / 100;
      if (restaurant.id) {
        const { data: activeProfiles } = await supabase
          .from('tax_profiles')
          .select('tax_rate')
          .eq('business_id', restaurant.id)
          .eq('is_active', true);
        if (activeProfiles && activeProfiles.length > 0) {
          sstRate = Number(activeProfiles[0].tax_rate) / 100;
        }
      }

      const scAmount = netSubtotal * scRate;
      const sstAmount = (netSubtotal + scAmount) * sstRate;
      const grandTotal = netSubtotal + scAmount + sstAmount;

      updatePayload['total_price'] = Math.round(grandTotal * 100) / 100;
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select()
      .single();
    
    if (error) return c.json({ error: error.message }, 500);

    if (caller && caller.email) {
      let action = auditAction || `Updated Order ${orderId}`;
      if (body.status && body.status !== order.status) {
        action = `Changed Order ${orderId} status from [${order.status}] to [${body.status}]`;
      }
      await logToAuditDb(supabase, caller.id, caller.email, caller.role, action, restId);
    }

    return c.json(data);
  } catch (err: any) {
    console.error("Error updating order in worker:", err);
    return c.json({ error: err.message }, 500);
  }
});

// Legacy KDS Active Orders Segment
orderRoutes.get("/api/restaurants/:restId/orders/active", authenticate, async (c) => {
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

// --- DINING SESSIONS & BILL DRAWER (ADMIN) ---

orderRoutes.get("/api/restaurants/:restId/dining-sessions", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const status = c.req.query('status');
  let query = supabase
    .from('dining_sessions')
    .select('*, orders(id, total_price, status, paid_at, items, session_id)')
    .eq('restaurant_id', c.req.param('restId'));
  
  if (status === 'active') {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    query = query.in('status', ['active', 'awaiting_payment', 'paid']).gt('started_at', yesterday);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

orderRoutes.get("/api/dining-sessions/:id/orders", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('orders')
    .select('*, payments(amount)')
    .eq('session_id', c.req.param('id'))
    .neq('status', 'cancelled');
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

orderRoutes.patch("/api/dining-sessions/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('dining_sessions')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Settle active cash/card payments at the counter safely
orderRoutes.post("/api/dining-sessions/:id/settle", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { orderIds, paidAmount } = await c.req.json();
  try {
    const { error: orderError } = await supabase
      .from('orders')
      .update({ paid_at: new Date().toISOString(), payment_method: 'counter' })
      .in('id', orderIds);
    if (orderError) throw orderError;

    // Graduating 'pending' orders to 'confirmed' status
    await supabase
      .from('orders')
      .update({ status: 'confirmed' })
      .in('id', orderIds)
      .eq('status', 'pending');

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

// --- ORDER ITEM CANCELLATION ENGINE & ROUTE ---

export interface BusinessSettings {
  allow_customer_cancel: boolean;
  allow_cancel_after_accept: boolean;
  allow_partial_cancel: boolean;
  require_cancel_reason: boolean;
  auto_refund_enabled: boolean;
  cancellation_time_limit_minutes: number;
  notify_staff_on_cancel: boolean;
  notify_customer_on_cancel: boolean;
}

export function canCancelOrderItem(
  userRole: string,
  itemStatus: string,
  businessSettings: BusinessSettings,
  orderCreatedAt?: string
): { allowed: boolean; reason?: string } {
  const role = (userRole || "customer").toLowerCase();
  const status = (itemStatus || "pending").toLowerCase();

  if (status === "cancelled") {
    return { allowed: false, reason: "Item is already cancelled." };
  }

  if (status === "completed") {
    return { allowed: false, reason: "Completed items cannot be cancelled." };
  }

  if (role === "kitchen") {
    return { allowed: false, reason: "Kitchen staff lack cancellation privileges." };
  }

  if (role === "owner" || role === "admin" || role === "manager") {
    return { allowed: true };
  }

  if (role === "cashier" || role === "waiter" || role === "runner") {
    if (status === "pending" || status === "accepted") {
      return { allowed: true };
    }
    return { 
      allowed: false, 
      reason: `Role '${role}' cannot cancel items once kitchen preparation starts (status is '${status}').` 
    };
  }

  if (role === "customer" || !role) {
    if (!businessSettings.allow_customer_cancel) {
      return { allowed: false, reason: "Customer cancellations are disabled by the restaurant." };
    }

    if (orderCreatedAt) {
      const orderTime = new Date(orderCreatedAt).getTime();
      const now = Date.now();
      const limitMinutes = businessSettings.cancellation_time_limit_minutes || 5;
      const elapsedMinutes = (now - orderTime) / (1000 * 60);
      if (elapsedMinutes > limitMinutes) {
        return { 
          allowed: false, 
          reason: `Cancellation request exceeded the restaurant's ${limitMinutes}-minute time limit.` 
        };
      }
    }

    if (status === "pending") {
      return { allowed: true };
    }

    if (status === "accepted") {
      if (businessSettings.allow_cancel_after_accept) {
        return { allowed: true };
      }
      return { allowed: false, reason: "Cancellations after acceptance are disabled for customers." };
    }

    return { allowed: false, reason: `Customers cannot cancel items once active cooking begins (status is '${status}').` };
  }

  return { allowed: false, reason: "Unauthorized role for item cancellation." };
}

async function ensureOrderItemsSynced(supabase: any, orderId: string, orderData?: any) {
  try {
    let order = orderData;
    if (!order) {
      const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (error || !data) return;
      order = data;
    }

    const { data: existingItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (itemsError) {
      console.warn("[CancellationService] Error loading existing order_items:", itemsError.message);
      return;
    }

    const currentExisting = existingItems || [];

    if (Array.isArray(order.items)) {
      let itemsUpdated = false;
      const rowsToInsert: any[] = [];
      const matchedRowIds = new Set<string>();

      const updatedItems = order.items.map((item: any) => {
        let matchedDbRow: any = null;

        // Try matching by orderItemId first
        if (item.orderItemId) {
          matchedDbRow = currentExisting.find((r: any) => r.id === item.orderItemId);
        }

        // Next try matching by item.id if it's a valid UUID
        if (!matchedDbRow && item.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) {
          matchedDbRow = currentExisting.find((r: any) => r.id === item.id);
        }

        // If still not matched, look for database row matching name and price that wasn't matched yet
        if (!matchedDbRow) {
          matchedDbRow = currentExisting.find((r: any) => 
            !matchedRowIds.has(r.id) && 
            r.name === item.name && 
            parseFloat(r.price) === parseFloat(item.price)
          );
        }

        if (matchedDbRow) {
          matchedRowIds.add(matchedDbRow.id);
          if (item.orderItemId !== matchedDbRow.id) {
            item.orderItemId = matchedDbRow.id;
            itemsUpdated = true;
          }
          if (item.id !== matchedDbRow.id) {
            item.id = matchedDbRow.id;
            itemsUpdated = true;
          }
          if (item.quantity !== matchedDbRow.quantity) {
            item.quantity = matchedDbRow.quantity;
            itemsUpdated = true;
          }
          if (item.status !== matchedDbRow.status) {
            item.status = matchedDbRow.status;
            itemsUpdated = true;
          }
          const isDbCancelled = matchedDbRow.status === 'cancelled';
          if (item.voided !== isDbCancelled) {
            item.voided = isDbCancelled;
            itemsUpdated = true;
          }
          if (item.voidedAt !== matchedDbRow.cancelled_at) {
            item.voidedAt = matchedDbRow.cancelled_at;
            itemsUpdated = true;
          }
          if (item.voidedBy !== matchedDbRow.cancelled_by) {
            item.voidedBy = matchedDbRow.cancelled_by;
            itemsUpdated = true;
          }
          if (item.voidReason !== matchedDbRow.cancellation_reason) {
            item.voidReason = matchedDbRow.cancellation_reason;
            itemsUpdated = true;
          }
          return item;
        }

        // Generate ID
        let newUuid = item.id;
        if (!newUuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newUuid)) {
          newUuid = crypto.randomUUID();
        }

        item.orderItemId = newUuid;
        if (item.id !== newUuid) {
          item.id = newUuid;
        }
        itemsUpdated = true;

        rowsToInsert.push({
          id: newUuid,
          order_id: orderId,
          menu_item_id: item.menuItemId || null,
          name: item.name || 'Unknown Item',
          price: item.price || 0,
          quantity: item.quantity || 1,
          options: item.options || [],
          special_instructions: item.specialInstructions || null,
          status: item.status || order.status || 'pending',
          original_quantity: item.quantity || 1,
          cancelled_quantity: 0,
          refund_status: 'none',
          refund_amount: 0.00
        });

        return item;
      });

      // 2. Append any unmatched rows from database (e.g. split cancelled products) to the overall json
      const unmatchedDbRows = currentExisting.filter((r: any) => !matchedRowIds.has(r.id));
      if (unmatchedDbRows.length > 0) {
        unmatchedDbRows.forEach((r: any) => {
          updatedItems.push({
            id: r.id,
            orderItemId: r.id,
            menuItemId: r.menu_item_id,
            name: r.name,
            price: parseFloat(r.price),
            quantity: r.quantity,
            status: r.status,
            options: r.options || [],
            specialInstructions: r.special_instructions || null,
            voided: r.status === 'cancelled',
            voidedAt: r.cancelled_at || null,
            voidedBy: r.cancelled_by || null,
            voidReason: r.cancellation_reason || null
          });
        });
        itemsUpdated = true;
      }

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabase.from('order_items').insert(rowsToInsert);
        if (insertError) {
          console.error("[CancellationService] order_items bulk insert error:", insertError.message);
        } else {
          itemsUpdated = true;
        }
      }

      if (itemsUpdated) {
        order.items = updatedItems;
        await supabase.from('orders').update({ items: updatedItems }).eq('id', orderId);
      }
    }
  } catch (err: any) {
    console.error("[CancellationService] ensureOrderItemsSynced exception:", err);
  }
}

async function logOrderItemEvent(
  supabase: any,
  orderId: string,
  orderItemId: string | null,
  eventType: string,
  createdBy: string | null,
  createdByRole: string,
  oldStatus: string | null,
  newStatus: string | null,
  reason: string | null
) {
  try {
    await supabase
      .from('order_item_events')
      .insert({
        order_id: orderId,
        order_item_id: orderItemId,
        event_type: eventType,
        created_by: createdBy,
        created_by_role: createdByRole,
        old_status: oldStatus,
        new_status: newStatus,
        reason: reason
      });
  } catch (err: any) {
    console.error("[CancellationService] Failed to write order_item_events trail:", err.message);
  }
}

orderRoutes.post("/api/orders/:orderId/items/:itemId/cancel", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { orderId, itemId } = c.req.param();
  const { quantity, reason } = await c.req.json();
  const caller = c.get('user');

  try {
    const cancelQty = parseInt(quantity);
    if (!cancelQty || cancelQty <= 0) {
      return c.json({ error: "Cancel quantity must be at least 1." }, 400);
    }
    if (!reason || reason.trim() === "") {
      return c.json({ error: "Reason for cancellation is required." }, 400);
    }

    await ensureOrderItemsSynced(supabase, orderId);

    // Resolve non-uuid/optimistic itemId to actual UUID in database
    let resolvedItemId = itemId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId);

    if (!isUuid) {
      const { data: orderRow } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (orderRow && Array.isArray(orderRow.items)) {
        const matchedItem = orderRow.items.find((it: any) => it.id === itemId);
        if (matchedItem && matchedItem.orderItemId) {
          resolvedItemId = matchedItem.orderItemId;
        } else {
          await ensureOrderItemsSynced(supabase, orderId, orderRow);
          const { data: refreshedOrder } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
          if (refreshedOrder && Array.isArray(refreshedOrder.items)) {
            const matchedRefreshed = refreshedOrder.items.find((it: any) => it.id === itemId);
            if (matchedRefreshed && matchedRefreshed.orderItemId) {
              resolvedItemId = matchedRefreshed.orderItemId;
            }
          }
        }
      }
    }

    // 1. Load the order item row
    const { data: orderItem, error: oiError } = await supabase
      .from('order_items')
      .select('*')
      .eq('id', resolvedItemId)
      .maybeSingle();

    if (oiError || !orderItem) {
      return c.json({ error: `Order item matches no records/details. Item space not found under resolved ID ${resolvedItemId}` }, 404);
    }

    // 2. Load the order to get the settings and status
    const { data: order, error: oError } = await supabase
      .from('orders')
      .select('*, restaurants(*)')
      .eq('id', orderId)
      .maybeSingle();

    if (oError || !order) {
      return c.json({ error: `Order loading error: ${oError?.message || 'Order not found'}` }, 404);
    }

    // 3. Load configurations or compile fallbacks
    const { data: bizSettings } = await supabase
      .from('business_settings')
      .select('*')
      .eq('restaurant_id', order.restaurant_id)
      .maybeSingle();

    const activeSettings: BusinessSettings = {
      allow_customer_cancel: bizSettings?.allow_customer_cancel !== undefined ? bizSettings.allow_customer_cancel : true,
      allow_cancel_after_accept: bizSettings?.allow_cancel_after_accept !== undefined ? bizSettings.allow_cancel_after_accept : false,
      allow_partial_cancel: bizSettings?.allow_partial_cancel !== undefined ? bizSettings.allow_partial_cancel : true,
      require_cancel_reason: bizSettings?.require_cancel_reason !== undefined ? bizSettings.require_cancel_reason : true,
      auto_refund_enabled: bizSettings?.auto_refund_enabled !== undefined ? bizSettings.auto_refund_enabled : false,
      cancellation_time_limit_minutes: bizSettings?.cancellation_time_limit_minutes !== undefined ? bizSettings.cancellation_time_limit_minutes : 5,
      notify_staff_on_cancel: bizSettings?.notify_staff_on_cancel !== undefined ? bizSettings.notify_staff_on_cancel : true,
      notify_customer_on_cancel: bizSettings?.notify_customer_on_cancel !== undefined ? bizSettings.notify_customer_on_cancel : true,
    };

    // 4. Validate quantity bounds
    if (cancelQty > orderItem.quantity) {
      return c.json({ error: `Cannot cancel quantity ${cancelQty} - only ${orderItem.quantity} active units remain.` }, 400);
    }

    // 5. Check permissions
    const permCheck = canCancelOrderItem(caller?.role || 'cashier', orderItem.status, activeSettings, order.created_at);
    if (!permCheck.allowed) {
      return c.json({ error: permCheck.reason || "Unauthorized cancellation request." }, 403);
    }

    // 6. Execute split or in-place update
    const isPaid = !!order.paid_at;
    const itemPrice = parseFloat(orderItem.price);
    
    // Account for item discount if any
    let unitDiscount = 0;
    const orderItemsJson = order.items || [];
    const foundJsonItem = orderItemsJson.find((it: any) => it.id === itemId);
    if (foundJsonItem && foundJsonItem.discount) {
      const totalItemVal = itemPrice * orderItem.quantity;
      let itemDiscAmt = 0;
      if (foundJsonItem.discount.type === 'percentage') {
        itemDiscAmt = totalItemVal * (foundJsonItem.discount.value / 100);
      } else {
        itemDiscAmt = Math.min(totalItemVal, foundJsonItem.discount.value * orderItem.quantity);
      }
      unitDiscount = itemDiscAmt / orderItem.quantity;
    }

    const pricePerUnitAfterDiscount = Math.max(0, itemPrice - unitDiscount);
    const refundAmtForCancellation = pricePerUnitAfterDiscount * cancelQty;

    const isPartial = cancelQty < orderItem.quantity;
    let targetCancelId = itemId;

    const cancelledBy = caller?.id || null;
    const cancelledByRole = caller?.role || 'cashier';

    if (isPartial) {
      if (!activeSettings.allow_partial_cancel && cancelledByRole === 'customer') {
        return c.json({ error: "Partial cancellations are disabled for customers." }, 400);
      }

      // 1. Split records: create new record for cancelled portion
      const cancelledId = crypto.randomUUID();
      const cancelledRow = {
        id: cancelledId,
        order_id: orderId,
        menu_item_id: orderItem.menu_item_id,
        name: orderItem.name,
        price: orderItem.price,
        quantity: cancelQty,
        options: orderItem.options || [],
        special_instructions: orderItem.special_instructions,
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledBy,
        cancelled_by_type: cancelledByRole === 'customer' ? 'customer' : 'staff',
        cancellation_reason: reason,
        original_quantity: orderItem.original_quantity,
        cancelled_quantity: cancelQty,
        refund_status: isPaid ? 'pending' : 'none',
        refund_amount: isPaid ? refundAmtForCancellation : 0.00,
        created_at: orderItem.created_at,
        updated_at: new Date().toISOString()
      };

      const { error: insertErr } = await supabase.from('order_items').insert(cancelledRow);
      if (insertErr) throw new Error(`Failed to create split cancelled item row: ${insertErr.message}`);

      // 2. Shrink existing row
      const { error: updateErr } = await supabase
        .from('order_items')
        .update({
          quantity: orderItem.quantity - cancelQty,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId);

      if (updateErr) throw new Error(`Failed to shrink active quantity row: ${updateErr.message}`);
      
      targetCancelId = cancelledId;

      await logOrderItemEvent(supabase, orderId, itemId, 'ITEM_PARTIALLY_CANCELLED', cancelledBy, cancelledByRole, orderItem.status, orderItem.status, `${reason} (Split qty ${cancelQty} of ${orderItem.quantity})`);
      await logOrderItemEvent(supabase, orderId, cancelledId, 'ITEM_CANCELLED', cancelledBy, cancelledByRole, orderItem.status, 'cancelled', reason);

    } else {
      // 1. Total cancellation: Update row in place
      const { error: updateErr } = await supabase
        .from('order_items')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: cancelledBy,
          cancelled_by_type: cancelledByRole === 'customer' ? 'customer' : 'staff',
          cancellation_reason: reason,
          cancelled_quantity: cancelQty,
          refund_status: isPaid ? 'pending' : 'none',
          refund_amount: isPaid ? refundAmtForCancellation : 0.00,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId);

      if (updateErr) throw new Error(`Failed to cancel item row: ${updateErr.message}`);

      await logOrderItemEvent(supabase, orderId, itemId, 'ITEM_CANCELLED', cancelledBy, cancelledByRole, orderItem.status, 'cancelled', reason);
    }

    // 7. Manage refunds
    if (isPaid && refundAmtForCancellation > 0) {
      const { error: refundErr } = await supabase
        .from('order_item_refunds')
        .insert({
          order_id: orderId,
          order_item_id: targetCancelId,
          amount: refundAmtForCancellation,
          status: 'pending',
          payment_provider: order.payment_method || 'none',
          provider_refund_id: null
        });

      if (refundErr) {
        console.error("[CancellationService] order_item_refunds insert failed:", refundErr.message);
      }
      await logOrderItemEvent(supabase, orderId, targetCancelId, 'ITEM_REFUNDED', cancelledBy, cancelledByRole, 'cancelled', 'cancelled', `Refund created for RM ${refundAmtForCancellation.toFixed(2)}`);

      // General Audit Log for Refund trigger on Edge/Worker
      try {
        const email = caller?.email || "unknown@restaurant.com";
        await logToAuditDb(
          supabase,
          cancelledBy || caller?.id || "unknown",
          email,
          cancelledByRole,
          `MANUAL REFUND INITIATED: Refund created for RM ${refundAmtForCancellation.toFixed(2)} on Order ${orderId}`,
          order.restaurant_id || "default"
        );
      } catch (err) {
        console.error("Failed to log edge refund trigger:", err);
      }
    }

    // 8. Rebuild the order items JSON and recalculate prices
    const { data: refreshedOrderItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (refreshedOrderItems && refreshedOrderItems.length > 0) {
      const newItemsJson = refreshedOrderItems.map((oi: any) => {
        const orig = orderItemsJson.find((oItem: any) => oItem.id === oi.id) || 
                     orderItemsJson.find((oItem: any) => oItem.name === oi.name && oItem.price === parseFloat(oi.price));
        
        return {
          id: oi.id,
          menuItemId: oi.menu_item_id,
          name: oi.name,
          price: parseFloat(oi.price),
          quantity: oi.quantity,
          status: oi.status,
          options: oi.options || [],
          specialInstructions: oi.special_instructions || orig?.specialInstructions || null,
          selection: orig?.selection || null,
          voided: oi.status === 'cancelled',
          voidedAt: oi.cancelled_at,
          voidedBy: oi.cancelled_by,
          voidReason: oi.cancellation_reason
        };
      });

      // 9. Recalculate bill
      const restaurant = order.restaurants;
      const scRate = (restaurant?.service_charge || 0) / 100;
      
      // Dynamically load active tax profiles from the backend structure
      let sstRate = (restaurant?.sst || 0) / 100;
      if (restaurant?.id) {
        const { data: activeProfiles } = await supabase
          .from('tax_profiles')
          .select('tax_rate')
          .eq('business_id', restaurant.id)
          .eq('is_active', true);
        if (activeProfiles && activeProfiles.length > 0) {
          sstRate = Number(activeProfiles[0].tax_rate) / 100;
        }
      }

      let subtotal = 0;
      newItemsJson.forEach((it: any) => {
        if (it.status !== 'cancelled' && !it.voided) {
          const itemTotal = it.price * it.quantity;
          let itemDiscAmt = 0;
          if (it.discount) {
            if (it.discount.type === 'percentage') {
              itemDiscAmt = itemTotal * (it.discount.value / 100);
            } else {
              itemDiscAmt = Math.min(itemTotal, it.discount.value * it.quantity);
            }
          }
          subtotal += (itemTotal - itemDiscAmt);
        }
      });

      let orderDiscAmt = 0;
      if (order.discount) {
        if (order.discount.type === 'percentage') {
          orderDiscAmt = subtotal * (order.discount.value / 100);
        } else {
          orderDiscAmt = Math.min(subtotal, order.discount.value);
        }
      }

      const netSubtotal = Math.max(0, subtotal - orderDiscAmt);
      const scAmount = netSubtotal * scRate;
      const sstAmount = (netSubtotal + scAmount) * sstRate;
      const grandTotal = netSubtotal + scAmount + sstAmount;

      const activeItemCount = refreshedOrderItems.filter((oi: any) => oi.status !== 'cancelled').reduce((sum: number, oi: any) => sum + oi.quantity, 0);
      const orderStatus = activeItemCount === 0 ? 'cancelled' : order.status;

      const { error: orderUpdErr } = await supabase
        .from('orders')
        .update({
          items: newItemsJson,
          total_price: grandTotal,
          status: orderStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (orderUpdErr) {
        console.error("[CancellationService] Failed to update parent order prices:", orderUpdErr.message);
      }
    }

    if (caller && caller.email) {
      await logToAuditDb(
        supabase,
        caller.id, 
        caller.email, 
        caller.role, 
        `Cancelled ${cancelQty} units of item ${itemId} from order ${orderId}. Reason: ${reason}`, 
        order.restaurant_id || 'default'
      );
    }

    return c.json({ success: true, message: "Order item cancelled successfully." });
  } catch (err: any) {
    console.error("Error in staff cancel item in worker:", err);
    return c.json({ error: err.message }, 500);
  }
});

export default orderRoutes;
