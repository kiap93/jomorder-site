import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getSupabase, logToAuditDb } from '../services/db_service';
import { authenticate, requireTenantIsolation } from '../middleware/auth';
import { PaymentsSchema } from '../../src/lib/validation';
import { 
  getPaymentProviderForRestaurant,
  decryptConfig,
  encryptConfig,
  scrubSensitiveConfig 
} from '../../src/server/services/payments';

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

// --- COMPATIBILITY & ADMIN PAYMENT SETTINGS MIDDLEWARES & ENDPOINTS ---

const ensureEnv = (c: any) => {
  if (typeof process !== 'undefined') {
    if (c.env?.SUPABASE_URL && !process.env.SUPABASE_URL) {
      process.env.SUPABASE_URL = c.env.SUPABASE_URL;
    }
    if (c.env?.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = c.env.SUPABASE_SERVICE_ROLE_KEY;
    }
    if (c.env?.PAYMENT_ENCRYPTION_KEY && !process.env.PAYMENT_ENCRYPTION_KEY) {
      process.env.PAYMENT_ENCRYPTION_KEY = c.env.PAYMENT_ENCRYPTION_KEY;
    }
  }
};

const requireOwnerOrManager = async (c: any, next: any) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: "Unauthorized: User session not found" }, 401);
  }
  const role = (user.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin' || role === 'manager' || user.platform_role === 'superadmin' || user.is_platform_admin === true) {
    await next();
  } else {
    return c.json({ error: "Forbidden: You do not have permission to manage payment settings." }, 403);
  }
};

async function processPaymentPaidInWorker(
  supabase: any,
  paymentId: string,
  referenceId: string,
  amount: number,
  providerName: string,
  rawPayload: any
) {
  console.log(`[processPaymentPaid worker] Processing successful payment. ID: ${paymentId}, Ref: ${referenceId}, Amount: ${amount}`);
  
  let { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .maybeSingle();

  if (!payment && referenceId) {
    const { data: pByRef } = await supabase
      .from('payments')
      .select('*')
      .eq('idempotency_key', referenceId)
      .maybeSingle();
    payment = pByRef;
  }

  if (!payment) {
    throw new Error(`Unassociated payment transaction. Re-routing failed for reference: ${referenceId}`);
  }

  if (payment.status === 'completed') {
    return { success: true, alreadyCompleted: true, payment };
  }

  // Upgrade status to completed
  const { data: updatedPayment, error: uError } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      metadata: {
        ...(payment.metadata || {}),
        webhook_processed_at: new Date().toISOString(),
        webhook_payload: rawPayload
      }
    })
    .eq('id', payment.id)
    .select()
    .single();

  if (uError) throw uError;

  // Transition Order status to confirmed (paid) and set paid_at
  if (payment.order_id) {
    const { error: oError } = await supabase
      .from('orders')
      .update({
        status: 'confirmed',
        paid_at: new Date().toISOString()
      })
      .eq('id', payment.order_id);

    if (oError) {
      console.error(`[Webhook Process Worker] Order update failed for order ${payment.order_id}:`, oError);
    } else {
      console.log(`[Webhook Process Worker] Order ${payment.order_id} successfully marked as PAID/CONFIRMED.`);
    }
  }

  return { success: true, payment: updatedPayment };
}

// 1. PUBLIC ENDPOINT: Load Restaurant Payment Settings
paymentRoutes.get("/api/restaurants/:restaurantId/public-payment-settings", async (c) => {
  ensureEnv(c);
  const restaurantId = c.req.param('restaurantId');
  const supabase = getSupabase(c.env);
  try {
    const { data: settings, error } = await supabase
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    if (!settings) {
      // Return beautiful defaults so guest checkout doesn't crash
      return c.json({
        provider: "none",
        account_type: "owner",
        enabled_methods: ["cash"],
        public_config: {}
      });
    }

    const decConfig = decryptConfig(settings.merchant_config || {}, c.env.PAYMENT_ENCRYPTION_KEY);
    // Extract only non-sensitive config keys like publishableKey or merchantId
    const publicConfig: Record<string, any> = {};
    if (decConfig.publishableKey) publicConfig.publishableKey = decConfig.publishableKey;
    if (decConfig.merchantId) publicConfig.merchantId = decConfig.merchantId;
    if (decConfig.collectionId) publicConfig.collectionId = decConfig.collectionId;

    return c.json({
      provider: settings.provider,
      account_type: settings.account_type,
      enabled_methods: Array.isArray(settings.enabled_methods) ? settings.enabled_methods : [],
      public_config: publicConfig
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 2. ADMIN ENDPOINTS: GET Payment Settings
paymentRoutes.get("/api/restaurants/:restId/payment-settings", authenticate, requireTenantIsolation('restId'), requireOwnerOrManager, async (c) => {
  ensureEnv(c);
  const restId = c.req.param('restId');
  const supabase = getSupabase(c.env);
  try {
    const { data: settingsList, error } = await supabase
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restId);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    // Scrub confidential credentials before presenting them
    const sanitizedList = (settingsList || []).map(setting => ({
      ...setting,
      merchant_config: scrubSensitiveConfig(setting.merchant_config || {})
    }));

    return c.json(sanitizedList);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 3. ADMIN ENDPOINTS: POST (Save/Upsert) Payment Settings
paymentRoutes.post("/api/restaurants/:restId/payment-settings", authenticate, requireTenantIsolation('restId'), requireOwnerOrManager, async (c) => {
  ensureEnv(c);
  const restId = c.req.param('restId');
  const supabase = getSupabase(c.env);
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const { provider, account_type, enabled_methods, merchant_config, is_active } = body;

    if (!provider) {
      return c.json({ error: "Missing required parameter 'provider'" }, 400);
    }

    // 1. Fetch existing settings for this provider to merge masked values properly
    const { data: existingRecord } = await supabase
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restId)
      .eq('provider', provider.toLowerCase())
      .maybeSingle();

    let decryptedExisting: Record<string, any> = {};
    if (existingRecord && existingRecord.merchant_config) {
      decryptedExisting = decryptConfig(existingRecord.merchant_config, c.env.PAYMENT_ENCRYPTION_KEY);
    }

    // 2. Consolidate submitted settings. Replace only if value has actual updates.
    const finalDecryptedConfig: Record<string, any> = { ...decryptedExisting };
    const incomingConfig = merchant_config || {};

    for (const [key, val] of Object.entries(incomingConfig)) {
      if (typeof val === 'string') {
        const isMaskedValue = val.includes('...') || val.includes('***') || val === '********';
        if (!isMaskedValue && val.trim() !== '') {
          finalDecryptedConfig[key] = val.trim();
        }
      } else {
        finalDecryptedConfig[key] = val;
      }
    }

    // 3. Encrypt the consolidated config keys
    const encryptedConfig = encryptConfig(finalDecryptedConfig, c.env.PAYMENT_ENCRYPTION_KEY);

    // 4. Update other providers' active is_active mapping to false if saving this provider as active
    if (is_active === true) {
      await supabase
        .from('payment_settings')
        .update({ is_active: false })
        .eq('restaurant_id', restId)
        .neq('provider', provider.toLowerCase());
    }

    // 5. Upsert this payment credentials row
    const upsertPayload = {
      restaurant_id: restId,
      provider: provider.toLowerCase(),
      account_type: account_type || 'owner',
      enabled_methods: Array.isArray(enabled_methods) ? enabled_methods : [],
      merchant_config: encryptedConfig,
      is_active: is_active ?? true,
      updated_at: new Date().toISOString()
    };

    let resultRecord;
    if (existingRecord) {
      const { data, error } = await supabase
        .from('payment_settings')
        .update(upsertPayload)
        .eq('id', existingRecord.id)
        .select()
        .single();
      if (error) throw error;
      resultRecord = data;
    } else {
      const { data, error } = await supabase
        .from('payment_settings')
        .insert({
          ...upsertPayload,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      if (error) throw error;
      resultRecord = data;
    }

    // 6. Audit Logging the updates
    try {
      const hasProviderChanged = existingRecord ? (existingRecord.provider !== provider.toLowerCase()) : true;
      if (hasProviderChanged) {
        await logToAuditDb(supabase, user.id, user.email, user.role, `Changed active payment provider to: ${provider}`, restId);
      } else {
        await logToAuditDb(supabase, user.id, user.email, user.role, `Credentials updated for provider: ${provider}`, restId);
      }
    } catch (_) {}

    return c.json({
      ...resultRecord,
      merchant_config: scrubSensitiveConfig(resultRecord.merchant_config)
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. ADMIN ENDPOINTS: Test Connection
paymentRoutes.post("/api/restaurants/:restId/payment-settings/test-connection", authenticate, requireTenantIsolation('restId'), requireOwnerOrManager, async (c) => {
  ensureEnv(c);
  const restId = c.req.param('restId');
  const supabase = getSupabase(c.env);
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const { provider, merchant_config } = body;
    if (!provider) {
      return c.json({ error: "Missing parameter 'provider'" }, 400);
    }

    // Merge and restore actual keys to test connection accurately
    const { data: existingRecord } = await supabase
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restId)
      .eq('provider', provider.toLowerCase())
      .maybeSingle();

    let decryptedExisting: Record<string, any> = {};
    if (existingRecord && existingRecord.merchant_config) {
      decryptedExisting = decryptConfig(existingRecord.merchant_config, c.env.PAYMENT_ENCRYPTION_KEY);
    }

    const testDecryptedConfig = { ...decryptedExisting };
    const incomingConfig = merchant_config || {};
    for (const [key, val] of Object.entries(incomingConfig)) {
      if (typeof val === 'string' && !val.includes('...') && val !== '********' && val.trim() !== '') {
        testDecryptedConfig[key] = val.trim();
      }
    }

    let connectionLooksValid = false;
    if (provider.toLowerCase() === 'stripe') {
      connectionLooksValid = !!(testDecryptedConfig.secretKey || testDecryptedConfig.publishableKey);
    } else if (provider.toLowerCase() === 'billplz') {
      connectionLooksValid = !!(testDecryptedConfig.apiKey || testDecryptedConfig.collectionId);
    } else if (provider.toLowerCase() === 'senangpay') {
      connectionLooksValid = !!(testDecryptedConfig.merchantId || testDecryptedConfig.secretKey);
    } else if (provider.toLowerCase() === 'curlec') {
      connectionLooksValid = !!(testDecryptedConfig.merchantId);
    }

    try {
      await logToAuditDb(supabase, user.id, user.email, user.role, `Connection tested for provider: ${provider} (Result: ${connectionLooksValid ? 'Success' : 'Incomplete parameters'})`, restId);
    } catch (_) {}

    if (connectionLooksValid) {
      return c.json({ success: true, message: `Successfully connected to ${provider} API gateway interface!` });
    } else {
      return c.json({ error: `Connection failed: Please fill up all credentials required for ${provider}.` }, 400);
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 5. PUBLIC CLIENT ENDPOINT: Check order/payment status
paymentRoutes.get("/api/payments/status/:id", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  const id = c.req.param('id');
  try {
    const { data: payment, error } = await supabase
      .from('payments')
      .select('*, orders(status, paid_at)')
      .eq('id', id)
      .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!payment) return c.json({ error: "Payment record not found" }, 404);

    return c.json({
      id: payment.id,
      order_id: payment.order_id,
      amount: payment.amount,
      status: payment.status,
      payment_method: payment.payment_method,
      provider: payment.provider,
      order_status: (payment.orders as any)?.status,
      paid_at: (payment.orders as any)?.paid_at
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 6. PUBLIC CLIENT ENDPOINT: Initiate Payment checkout link
paymentRoutes.post("/api/payments/create", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  
  try {
    const body = await c.req.json();
    const { order_id, payment_method, customer_email, customer_name } = body;

    if (!order_id || !payment_method) {
      return c.json({ error: "Missing parameters 'order_id' or 'payment_method'" }, 400);
    }

    // 1. Fetch Order Details
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .maybeSingle();

    if (orderErr) return c.json({ error: orderErr.message }, 500);
    if (!order) return c.json({ error: "Requested order not found" }, 404);

    const restaurantId = order.restaurant_id;
    const amount = Number(order.total_price) || 0;

    // 2. Handle CASH payments directly
    if (payment_method.toLowerCase() === 'cash') {
      console.log(`[PaymentsCreate worker] Processing Cash Mode directly for order ${order_id}`);
      
      const { data: updatedOrder, error: updateErr } = await supabase
        .from('orders')
        .update({
          payment_method: 'cash',
          status: 'confirmed', // Cash orders are instantly confirmed for kitchen queueing
          paid_at: new Date().toISOString()
        })
        .eq('id', order_id)
        .select()
        .single();

      if (updateErr) return c.json({ error: updateErr.message }, 500);

      // Create a paid/confirmed cash payment record in payments ledger
      await supabase.from('payments').insert({
        restaurant_id: restaurantId,
        order_id: order_id,
        amount: amount,
        payment_method: 'cash',
        provider: 'cash',
        status: 'completed',
        idempotency_key: `cash_${order_id}`,
        metadata: { instant_cash_checkout: true }
      });

      return c.json({
        success: true,
        method: "cash",
        message: "Order placed successfully! Cash payment chosen.",
        redirect_url: `/checkout/status?order_id=${order_id}`
      });
    }

    // 3. For digital payment, resolve active restaurant payment settings
    const paymentContext = await getPaymentProviderForRestaurant(restaurantId, c.env.PAYMENT_ENCRYPTION_KEY);
    
    // Check if selected payment method is enabled
    const requestedMethod = payment_method.toLowerCase();
    const isMethodAllowed = paymentContext.enabledMethods.includes(requestedMethod) || 
                          requestedMethod === 'online' || 
                          (requestedMethod === 'visa' || requestedMethod === 'mastercard' ? paymentContext.enabledMethods.includes('card') || paymentContext.enabledMethods.includes('visa') || paymentContext.enabledMethods.includes('mastercard') : false);

    if (!isMethodAllowed) {
      return c.json({ error: `Selected payment method "${payment_method}" is not enabled by this restaurant.` }, 400);
    }

    // 4. Create pending payments row context safely
    const paymentId = crypto.randomUUID();
    
    // Create base callback and success parameters
    const origin = c.req.header('origin') || process.env.VITE_API_BASE_URL || `http://${c.req.header('host')}`;
    const redirectUrl = `${origin}/checkout/status`;
    const callbackUrl = `${origin}/api/payment/webhook`;

    // 5. Invoke selected adapter to formulate checkout URLs
    const createReq = {
      payment_id: paymentId,
      order_id,
      restaurant_id: restaurantId,
      amount,
      payment_method: requestedMethod,
      customer_email,
      customer_name,
      callback_url: callbackUrl,
      redirect_url: redirectUrl
    };

    console.log(`[PaymentsCreate worker] Directing to provider adapter "${paymentContext.providerName}":`, JSON.stringify(createReq));
    const providerRes = await paymentContext.provider.createPayment(createReq);

    if (!providerRes.success) {
      return c.json({ error: providerRes.error || "Failed to create transaction checkout connection" }, 400);
    }

    // 6. Persist details inside our Payments table
    const { data: newPayment, error: insertPayErr } = await supabase
      .from('payments')
      .insert({
        id: paymentId,
        restaurant_id: restaurantId,
        order_id: order_id,
        amount: amount,
        payment_method: requestedMethod,
        provider: paymentContext.providerName,
        status: 'pending',
        idempotency_key: providerRes.reference_id,
        metadata: {
          checkout_url: providerRes.payment_url,
          raw_init_response: providerRes.raw_response,
          account_type: paymentContext.accountType
        }
      })
      .select()
      .single();

    if (insertPayErr) {
      console.error("[PaymentsCreate worker] Error writing payment ledger row:", insertPayErr.message);
      return c.json({ error: "Failed to record payment transaction initialization" }, 500);
    }

    return c.json({
      success: true,
      payment_id: newPayment.id,
      reference_id: providerRes.reference_id,
      payment_url: providerRes.payment_url,
      qr_code_data: providerRes.qr_code_data,
      redirect_url: providerRes.payment_url
    });

  } catch (err: any) {
    console.error("[PaymentsCreate worker] Fatal Exception:", err);
    return c.json({ error: err.message }, 500);
  }
});

// 7. MULTIPLEX / DIRECT PAYMENT WEBHOOK HANDLER
paymentRoutes.post("/api/payment/webhook", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  
  try {
    const payload = await c.req.json() || {};
    console.log("[PaymentWebhook worker] General multiplexer webhook endpoint triggered:", JSON.stringify(payload));

    const transactionId = payload.transaction_id || payload.id || payload.payment_id || payload.bill_id || payload.order_id;
    if (!transactionId) {
      return c.json({ error: "Missing trace transaction ID" }, 400);
    }

    const webhookLockKey = `multiplex_webhook:${transactionId}`;
    
    // Inside worker Hono context, check workerIdempotencyRegistry map
    let record = workerIdempotencyRegistry.get(webhookLockKey);
    if (record) {
      if (record.status === 'processing') {
        return c.json({ error: "Event currently being processed. Please retry." }, 409);
      }
      if (record.status === 'completed') {
        return c.json({ success: true, message: "Webhook already processed and finalized.", result: record.result });
      }
    }

    workerIdempotencyRegistry.set(webhookLockKey, { status: 'processing', createdAt: Date.now() });

    const isSuccess = payload.paid === 'true' || payload.paid === true || payload.status === 'success' || payload.status === 'completed' || payload.status === '1';
    
    const result = await processPaymentPaidInWorker(
      supabase,
      payload.payment_id || "",
      transactionId,
      Number(payload.amount || 0),
      payload.provider || "online",
      payload
    );

    workerIdempotencyRegistry.set(webhookLockKey, { status: 'completed', result, createdAt: Date.now() });
    return c.json({ success: true, message: "Webhook successfully registered and finalized.", result });
    
  } catch (err: any) {
    console.error("[PaymentWebhook worker] Multiplexer processing Exception:", err);
    const transactionId = (await c.req.json().catch(() => ({}))).payment_id;
    if (transactionId) {
      workerIdempotencyRegistry.delete(`multiplex_webhook:${transactionId}`);
    }
    return c.json({ error: err.message }, 500);
  }
});

// 8. SPECIFIC PROVIDERS WEBHOOK HANDLERS

// BILLPLZ WEBHOOK
paymentRoutes.post("/api/webhooks/billplz", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  try {
    const payload = await c.req.json() || {};
    console.log("[Webhook worker][Billplz] Triggered with body:", JSON.stringify(payload));
    const isPaid = payload.paid === 'true' || payload.paid === true;
    const refId = payload.id || payload.bill_id;
    
    if (isPaid && refId) {
      await processPaymentPaidInWorker(supabase, "", refId, Number(payload.amount || 0) / 100, "billplz", payload);
    }
    return c.text("OK");
  } catch (err: any) {
    console.error("[Webhook worker][Billplz] Processing Failure:", err.message);
    return c.text("Callback Execution Fail", 500);
  }
});

// STRIPE WEBHOOK
paymentRoutes.post("/api/webhooks/stripe", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  try {
    const payload = await c.req.json() || {};
    console.log("[Webhook worker][Stripe] Triggered:", JSON.stringify(payload));
    const dataObj = payload.data?.object || {};
    const refId = dataObj.id;
    const paymentId = dataObj.metadata?.payment_id;
    const amount = (dataObj.amount_total || dataObj.amount || 0) / 100;
    
    if (payload.type === "checkout.session.completed" && refId) {
      await processPaymentPaidInWorker(supabase, paymentId, refId, amount, "stripe", payload);
    }
    return c.json({ received: true });
  } catch (err: any) {
    console.error("[Webhook worker][Stripe] Processing Failure:", err.message);
    return c.json({ error: err.message }, 500);
  }
});

// SENANGPAY WEBHOOK
paymentRoutes.post("/api/webhooks/senangpay", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  try {
    const payload = { ...await c.req.json().catch(() => ({})), ...c.req.query() };
    console.log("[Webhook worker][SenangPay] Triggered with payload:", JSON.stringify(payload));
    const status = payload.status;
    const refId = payload.order_id;
    const amount = Number(payload.amount || 0);
    
    if (status === '1' && refId) {
      await processPaymentPaidInWorker(supabase, "", refId, amount, "senangpay", payload);
    }
    return c.text("OK");
  } catch (err: any) {
    console.error("[Webhook worker][SenangPay] Processing Failure:", err.message);
    return c.text("OK");
  }
});

// CURLEC WEBHOOK
paymentRoutes.post("/api/webhooks/curlec", async (c) => {
  ensureEnv(c);
  const supabase = getSupabase(c.env);
  try {
    const payload = await c.req.json() || {};
    console.log("[Webhook worker][Curlec] Triggered:", JSON.stringify(payload));
    const status = payload.status || payload.event;
    const refId = payload.reference_id || payload.ref || payload.id;
    
    if ((status === 'success' || status === 'completed' || status === 'payment.captured') && refId) {
      await processPaymentPaidInWorker(supabase, "", refId, Number(payload.amount || 0), "curlec", payload);
    }
    return c.json({ success: true });
  } catch (err: any) {
    console.error("[Webhook worker][Curlec] Processing Failure:", err.message);
    return c.json({ error: err.message }, 500);
  }
});

export default paymentRoutes;
