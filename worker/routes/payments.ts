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

interface WorkerIdempotencyRecord {
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
}

const workerIdempotencyRegistry = new Map<string, WorkerIdempotencyRecord>();

function cleanWorkerExpiredIdempotencyKeys() {
  const cutoff = Date.now() - 86400000; // 24-hour expiration
  for (const [key, record] of workerIdempotencyRegistry.entries()) {
    if (record.createdAt < cutoff) {
      workerIdempotencyRegistry.delete(key);
    }
  }
}

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

    cleanWorkerExpiredIdempotencyKeys();

    if (idempotencyKeyResolved) {
      // 1. Concurrency Check & Lock
      let record = workerIdempotencyRegistry.get(idempotencyKeyResolved);
      if (record && record.status === 'processing') {
        // Poll briefly to let parallel request finish
        for (let i = 0; i < 50; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          record = workerIdempotencyRegistry.get(idempotencyKeyResolved);
          if (!record || record.status !== 'processing') break;
        }
      }

      if (record) {
        if (record.status === 'completed') {
          return c.json(record.result);
        }
        if (record.status === 'processing') {
          return c.json({ error: "Another payment with this transaction id is currently processing. Please wait or retry." }, 409);
        }
      }

      // Initialize processing lock
      workerIdempotencyRegistry.set(idempotencyKeyResolved, {
        status: 'processing',
        createdAt: Date.now()
      });

      // 2. DB Replay Check (existing column lookup or metadata lookup)
      const { data: existingCol } = await supabase
        .from('payments')
        .select('*')
        .eq('idempotency_key', idempotencyKeyResolved)
        .maybeSingle();

      if (existingCol) {
        workerIdempotencyRegistry.set(idempotencyKeyResolved, {
          status: 'completed',
          result: existingCol,
          createdAt: Date.now()
        });
        return c.json(existingCol);
      }

      const { data: existingMeta } = await supabase
        .from('payments')
        .select('*')
        .eq('metadata->>idempotency_key', idempotencyKeyResolved)
        .maybeSingle();

      if (existingMeta) {
        workerIdempotencyRegistry.set(idempotencyKeyResolved, {
          status: 'completed',
          result: existingMeta,
          createdAt: Date.now()
        });
        return c.json(existingMeta);
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

    // 3. Unique SQL level attempt with duplicate key catching fallback
    const { data: successData, error: dbError } = await supabase
      .from('payments')
      .insert(insertPayload)
      .select()
      .single();

    if (dbError) {
      // Catch unique database constraint error
      if (dbError.code === '23505' || dbError.message?.toLowerCase().includes('unique') || dbError.message?.toLowerCase().includes('duplicate')) {
        const { data: reloadedCol } = await supabase
          .from('payments')
          .select('*')
          .eq('idempotency_key', idempotencyKeyResolved)
          .maybeSingle();

        const reloaded = reloadedCol || (await supabase
          .from('payments')
          .select('*')
          .eq('metadata->>idempotency_key', idempotencyKeyResolved)
          .maybeSingle()).data;

        if (reloaded) {
          if (idempotencyKeyResolved) {
            workerIdempotencyRegistry.set(idempotencyKeyResolved, {
              status: 'completed',
              result: reloaded,
              createdAt: Date.now()
            });
          }
          return c.json(reloaded);
        }
      }

      // If schema error because column doesn't exist yet, fallback to metadata lookup & insert without the DB column
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
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('payments')
          .insert(fallbackPayload)
          .select()
          .single();

        if (fallbackError) {
          if (idempotencyKeyResolved) {
            workerIdempotencyRegistry.set(idempotencyKeyResolved, {
              status: 'failed',
              error: fallbackError.message,
              createdAt: Date.now()
            });
          }
          return c.json({ error: fallbackError.message }, 500);
        }

        if (idempotencyKeyResolved) {
          workerIdempotencyRegistry.set(idempotencyKeyResolved, {
            status: 'completed',
            result: fallbackData,
            createdAt: Date.now()
          });
        }
        return c.json(fallbackData);
      }

      if (idempotencyKeyResolved) {
        workerIdempotencyRegistry.set(idempotencyKeyResolved, {
          status: 'failed',
          error: dbError.message,
          createdAt: Date.now()
        });
      }
      return c.json({ error: dbError.message }, 500);
    }

    if (idempotencyKeyResolved) {
      workerIdempotencyRegistry.set(idempotencyKeyResolved, {
        status: 'completed',
        result: successData,
        createdAt: Date.now()
      });
    }
    return c.json(successData);
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
