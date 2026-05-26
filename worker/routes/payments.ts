import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getSupabase } from '../services/db_service';
import { authenticate } from '../middleware/auth';
import { PaymentsSchema } from '../../src/lib/validation';

const paymentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// --- PAYMENTS LIST & LOGGING (ADMIN) ---

paymentRoutes.get("/api/orders/:orderId/payments", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const sessionId = c.req.query('sessionId');
  
  if (sessionId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
    if (!isUuid) return c.json([]);

    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('session_id', sessionId);
    
    const orderIds = (orders || []).map(o => o.id);
    if (orderIds.length === 0) return c.json([]);
    
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false });
    
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
  } else {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', c.req.param('orderId'))
      .order('created_at', { ascending: false });
    
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
  }
});

paymentRoutes.post("/api/orders/:orderId/payments", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('payments')
    .insert({
      ...body,
      order_id: c.req.param('orderId')
    })
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

paymentRoutes.post("/api/cash-transactions", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('cash_transactions')
    .insert(body)
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// --- PAYMENTS ENDPOINTS (PUBLIC) ---

paymentRoutes.post("/api/public/payments", async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const body = await c.req.json();
    const parsed = PaymentsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400);
    }
    const { restaurantId, orderId, amount, method, provider, metadata, idempotency_key, idempotencyKey } = parsed.data;
    const idempotencyKeyResolved = idempotency_key || idempotencyKey;

    if (idempotencyKeyResolved) {
      const { data: existing } = await supabase
        .from('payments')
        .select('*')
        .eq('metadata->>idempotency_key', idempotencyKeyResolved)
        .maybeSingle();

      if (existing) {
        return c.json(existing);
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

    const { data, error } = await supabase
      .from('payments')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      if (error.message?.includes('idempotency_key') || error.code === 'PGRST204') {
        const fallbackPayload = {
          restaurant_id: restaurantId,
          order_id: orderId,
          amount: amount,
          payment_method: method,
          provider: provider,
          status: 'pending',
          metadata: newMetadata
        };
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('payments')
          .insert(fallbackPayload)
          .select()
          .single();

        if (fallbackError) return c.json({ error: fallbackError.message }, 500);
        return c.json(fallbackData);
      }
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

paymentRoutes.post("/api/public/payments/:id/initialize", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param('id');
  const { data: payment, error: pError } = await supabase.from('payments').select('*').eq('id', id).single();
  if (pError) return c.json({ error: pError.message }, 500);

  await supabase.from('payment_attempts').insert({
    payment_id: id,
    status: 'initiated'
  });

  switch (payment.payment_method) {
    case 'duitnow':
    case 'tng':
      return c.json({
        paymentId: payment.id,
        provider: payment.provider,
        paymentMethod: payment.payment_method,
        qrData: `00020101021126600010com.paynet.qr0111MY123456780211MY123456780303001520400005303458540${payment.amount.toFixed(2)}5802MY5907POS_SAAS6008Lumpur6105500006304`
      });
    case 'fpx':
    case 'card':
      return c.json({
        paymentId: payment.id,
        provider: payment.provider,
        paymentMethod: payment.payment_method,
        redirectUrl: '/simulated-gateway'
      });
    default:
      return c.json({ error: "Unsupported method" }, 400);
  }
});

paymentRoutes.get("/api/public/payments/:id/status", async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('payments')
    .select('status')
    .eq('id', c.req.param('id'))
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

paymentRoutes.post("/api/public/payments/:id/simulate-success", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param('id');
  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .select('order_id')
    .eq('id', id)
    .single();
  
  if (fetchError) return c.json({ error: fetchError.message }, 500);

  const paidAt = new Date().toISOString();
  await supabase.from('payments').update({ 
    status: 'paid',
    paid_at: paidAt,
    external_id: `SIM_${Math.random().toString(36).substring(7).toUpperCase()}`
  }).eq('id', id);

  await supabase.from('orders').update({ 
    paid_at: paidAt,
    status: 'confirmed'
  }).eq('id', payment.order_id);

  await supabase.from('payment_attempts').insert({
    payment_id: id,
    status: 'success',
    provider_response: { mode: 'simulation', timestamp: paidAt }
  });

  return c.json({ success: true });
});

export default paymentRoutes;
