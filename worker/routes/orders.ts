import { Hono } from 'hono';
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
    .select('*')
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
      .select('*')
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
    .select('*')
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
    .select('*')
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
    .select('*')
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
      .select('*')
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
      .select('restaurant_id, status')
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

    const { data, error } = await supabase
      .from('orders')
      .update(body)
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
    query = query.neq('status', 'paid').neq('status', 'expired');
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

export default orderRoutes;
