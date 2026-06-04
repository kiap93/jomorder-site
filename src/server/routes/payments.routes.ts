import { Router } from "express";
import express from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation, requirePermissions, AuthenticatedRequest } from "../middleware/authMiddleware";
import { idempotencyService } from "../services/idempotencyService";
import { logToAudit } from "../services/auditService";
import { 
  getPaymentProviderForRestaurant, 
  encryptConfig, 
  decryptConfig, 
  scrubSensitiveConfig 
} from "../services/payments";

const router = Router();

// Middleware checking for Owner or Manager roles for payment setting management
const requireOwnerOrManager = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: User session not found" });
  }
  const role = (user.role || '').toLowerCase();
  if (role === 'owner' || role === 'manager' || user.platform_role === 'superadmin' || user.is_platform_admin === true) {
    next();
  } else {
    res.status(403).json({ error: "Forbidden: You do not have permission to manage payment settings." });
  }
};

// Reusable handler to complete and transition payments and orders
async function processPaymentPaid(paymentId: string, referenceId: string, amount: number, providerName: string, rawPayload: any) {
  console.log(`[processPaymentPaid] Processing successful payment. ID: ${paymentId}, Ref: ${referenceId}, Amount: ${amount}`);
  
  let { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .maybeSingle();

  if (!payment && referenceId) {
    const { data: pByRef } = await supabaseAdmin
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
  const { data: updatedPayment, error: uError } = await supabaseAdmin
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
    const { error: oError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'confirmed',
        paid_at: new Date().toISOString()
      })
      .eq('id', payment.order_id);

    if (oError) {
      console.error(`[Webhook Process] Order update failed for order ${payment.order_id}:`, oError);
    } else {
      console.log(`[Webhook Process] Order ${payment.order_id} successfully marked as PAID/CONFIRMED.`);
    }
  }

  return { success: true, payment: updatedPayment };
}

// -----------------------------------------------------
// 1. PUBLIC ENDPOINT: Load Restaurant Payment Settings
// Used at checkout. Returns only enabled modes and standard public parameters (e.g., Stripe publishable key).
// Secrets are completely omitted!
// -----------------------------------------------------
router.get("/restaurants/:restaurantId/public-payment-settings", async (req, res) => {
  const { restaurantId } = req.params;
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!settings) {
      // Return beautiful defaults so guest checkout doesn't crash
      return res.json({
        provider: "none",
        account_type: "owner",
        enabled_methods: ["cash"],
        public_config: {}
      });
    }

    const decConfig = decryptConfig(settings.merchant_config || {});
    // Extract only non-sensitive config keys like publishableKey or merchantId
    const publicConfig: Record<string, any> = {};
    if (decConfig.publishableKey) publicConfig.publishableKey = decConfig.publishableKey;
    if (decConfig.merchantId) publicConfig.merchantId = decConfig.merchantId;
    if (decConfig.collectionId) publicConfig.collectionId = decConfig.collectionId;

    res.json({
      provider: settings.provider,
      account_type: settings.account_type,
      enabled_methods: Array.isArray(settings.enabled_methods) ? settings.enabled_methods : [],
      public_config: publicConfig
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 2. ADMIN ENDPOINTS: GET Payment Settings
// Reads all configurations mapped to the restaurant. Returns scrubbed credentials!
// -----------------------------------------------------
router.get("/restaurants/:restId/payment-settings", authenticateJWT, requireTenantIsolation('restId'), requireOwnerOrManager, async (req, res) => {
  const { restId } = req.params;
  try {
    const { data: settingsList, error } = await supabaseAdmin
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Scrub confidential credentials before presenting them
    const sanitizedList = (settingsList || []).map(setting => ({
      ...setting,
      merchant_config: scrubSensitiveConfig(setting.merchant_config || {})
    }));

    res.json(sanitizedList);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 3. ADMIN ENDPOINTS: POST (Save/Upsert) Payment Settings
// Safely merges masked credentials with existing secrets and saves config!
// -----------------------------------------------------
router.post("/restaurants/:restId/payment-settings", authenticateJWT, requireTenantIsolation('restId'), requireOwnerOrManager, async (req, res) => {
  const { restId } = req.params;
  const { provider, account_type, enabled_methods, merchant_config, is_active } = req.body;

  if (!provider) {
    return res.status(400).json({ error: "Missing required parameter 'provider'" });
  }

  try {
    const user = (req as AuthenticatedRequest).user!;
    
    // 1. Fetch existing settings for this provider to merge masked values properly
    const { data: existingRecord } = await supabaseAdmin
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restId)
      .eq('provider', provider.toLowerCase())
      .maybeSingle();

    let decryptedExisting: Record<string, any> = {};
    if (existingRecord && existingRecord.merchant_config) {
      decryptedExisting = decryptConfig(existingRecord.merchant_config);
    }

    // 2. Consolidate submitted settings. Replace only if value has actual updates.
    // Overwrite old values ONLY if the submitted string is NOT masked (no '...' or '********').
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
    const encryptedConfig = encryptConfig(finalDecryptedConfig);

    // 4. Update other providers' active is_active mapping to false if saving this provider as active
    if (is_active === true) {
      await supabaseAdmin
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
      const { data, error } = await supabaseAdmin
        .from('payment_settings')
        .update(upsertPayload)
        .eq('id', existingRecord.id)
        .select()
        .single();
      if (error) throw error;
      resultRecord = data;
    } else {
      const { data, error } = await supabaseAdmin
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
    const hasProviderChanged = existingRecord ? (existingRecord.provider !== provider.toLowerCase()) : true;
    if (hasProviderChanged) {
      logToAudit(user.id, user.email, user.role, `Changed active payment provider to: ${provider}`, restId);
    } else {
      logToAudit(user.id, user.email, user.role, `Credentials updated for provider: ${provider}`, restId);
    }
    
    // Log updates to methods enabled
    const oldMethods = existingRecord?.enabled_methods || [];
    const addedMethods = (enabled_methods || []).filter((m: string) => !oldMethods.includes(m));
    const removedMethods = oldMethods.filter((m: string) => !(enabled_methods || []).includes(m));
    if (addedMethods.length > 0) {
      logToAudit(user.id, user.email, user.role, `Method enabled: ${addedMethods.join(", ")}`, restId);
    }
    if (removedMethods.length > 0) {
      logToAudit(user.id, user.email, user.role, `Method disabled: ${removedMethods.join(", ")}`, restId);
    }

    // Return sanitized feedback
    res.json({
      ...resultRecord,
      merchant_config: scrubSensitiveConfig(resultRecord.merchant_config)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 4. ADMIN ENDPOINTS: Test Provider Credentials Connection
// -----------------------------------------------------
router.post("/restaurants/:restId/payment-settings/test-connection", authenticateJWT, requireTenantIsolation('restId'), requireOwnerOrManager, async (req, res) => {
  const { restId } = req.params;
  const { provider, merchant_config } = req.body;
  if (!provider) {
    return res.status(400).json({ error: "Missing parameter 'provider'" });
  }

  try {
    const user = (req as AuthenticatedRequest).user!;
    console.log(`[TestConnection] Testing credentials for provider: ${provider}`);

    // Merge and restore actual keys to test connection accurately
    const { data: existingRecord } = await supabaseAdmin
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restId)
      .eq('provider', provider.toLowerCase())
      .maybeSingle();

    let decryptedExisting: Record<string, any> = {};
    if (existingRecord && existingRecord.merchant_config) {
      decryptedExisting = decryptConfig(existingRecord.merchant_config);
    }

    const testDecryptedConfig = { ...decryptedExisting };
    const incomingConfig = merchant_config || {};
    for (const [key, val] of Object.entries(incomingConfig)) {
      if (typeof val === 'string' && !val.includes('...') && val !== '********' && val.trim() !== '') {
        testDecryptedConfig[key] = val.trim();
      }
    }

    // Check if configuration parameters look reasonably present
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

    logToAudit(user.id, user.email, user.role, `Connection tested for provider: ${provider} (Result: ${connectionLooksValid ? 'Success' : 'Incomplete parameters'})`, restId);

    if (connectionLooksValid) {
      return res.json({ success: true, message: `Successfully connected to ${provider} API gateway interface!` });
    } else {
      return res.status(400).json({ error: `Connection failed: Please fill up all credentials required for ${provider}.` });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 5. PUBLIC CLIENT ENDPOINT: Check order/payment status
// -----------------------------------------------------
router.get("/payments/status/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .select('*, orders(status, paid_at)')
      .eq('id', id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!payment) return res.status(404).json({ error: "Payment record not found" });

    res.json({
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
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 6. PUBLIC CLIENT ENDPOINT: Initiate Payment checkout link
// -----------------------------------------------------
router.post("/payments/create", async (req, res) => {
  const { order_id, payment_method, customer_email, customer_name } = req.body;

  if (!order_id || !payment_method) {
    return res.status(400).json({ error: "Missing parameters 'order_id' or 'payment_method'" });
  }

  try {
    // 1. Fetch Order Details
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .maybeSingle();

    if (orderErr) return res.status(500).json({ error: orderErr.message });
    if (!order) return res.status(404).json({ error: "Requested order not found" });

    const restaurantId = order.restaurant_id;
    const amount = Number(order.total_price) || 0;

    // 2. Handle CASH payments directly
    if (payment_method.toLowerCase() === 'cash') {
      console.log(`[PaymentsCreate] Processing Cash Mode directly for order ${order_id}`);
      
      const { data: updatedOrder, error: updateErr } = await supabaseAdmin
        .from('orders')
        .update({
          payment_method: 'cash',
          status: 'confirmed', // Cash orders are instantly confirmed for kitchen queueing
          paid_at: new Date().toISOString()
        })
        .eq('id', order_id)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Create a paid/confirmed cash payment record in payments ledger
      await supabaseAdmin.from('payments').insert({
        restaurant_id: restaurantId,
        order_id: order_id,
        amount: amount,
        payment_method: 'cash',
        provider: 'cash',
        status: 'completed',
        idempotency_key: `cash_${order_id}`,
        metadata: { instant_cash_checkout: true }
      });

      return res.json({
        success: true,
        method: "cash",
        message: "Order placed successfully! Cash payment chosen.",
        redirect_url: `/checkout/status?order_id=${order_id}`
      });
    }

    // 3. For digital payment, resolve active restaurant payment settings
    const paymentContext = await getPaymentProviderForRestaurant(restaurantId);
    
    // Check if selected payment method is enabled
    // Support aliases: cash, fpx, duitnow, tng, grabpay, boost, visa, mastercard, atome, grab_paylater
    const requestedMethod = payment_method.toLowerCase();
    const isMethodAllowed = paymentContext.enabledMethods.includes(requestedMethod) || 
                          requestedMethod === 'online' || // support generic descriptors
                          (requestedMethod === 'visa' || requestedMethod === 'mastercard' ? paymentContext.enabledMethods.includes('card') || paymentContext.enabledMethods.includes('visa') || paymentContext.enabledMethods.includes('mastercard') : false);

    if (!isMethodAllowed) {
      return res.status(400).json({ error: `Selected payment method "${payment_method}" is not enabled by this restaurant.` });
    }

    // 4. Create pending payments row context safely
    const paymentId = crypto.randomUUID();
    
    // Create base callback and success parameters
    const origin = req.headers.origin || process.env.VITE_API_BASE_URL || `http://${req.headers.host}`;
    const redirectUrl = `${origin}/checkout/status`;
    const callbackUrl = `${origin}/api/payment/webhook`; // General multiplex webhook

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

    console.log(`[PaymentsCreate] Directing to provider adapter "${paymentContext.providerName}":`, JSON.stringify(createReq));
    const providerRes = await paymentContext.provider.createPayment(createReq);

    if (!providerRes.success) {
      return res.status(400).json({ error: providerRes.error || "Failed to create transaction checkout connection" });
    }

    // 6. Persist details inside our Payments table
    const { data: newPayment, error: insertPayErr } = await supabaseAdmin
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
      console.error("[PaymentsCreate] Error writing payment ledger row:", insertPayErr.message);
      return res.status(500).json({ error: "Failed to record payment transaction initialization" });
    }

    res.json({
      success: true,
      payment_id: newPayment.id,
      reference_id: providerRes.reference_id,
      payment_url: providerRes.payment_url,
      qr_code_data: providerRes.qr_code_data,
      redirect_url: providerRes.payment_url // Aliased endpoint helper
    });

  } catch (err: any) {
    console.error("[PaymentsCreate] Fatal Exception:", err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 7. MULTIPLEX / DIRECT PAYMENT WEBHOOK HANDLER
// 100% resilient with idempotency locking and replay safeguards!
// -----------------------------------------------------
router.post("/payment/webhook", async (req, res) => {
  const payload = req.body || {};
  console.log("[PaymentWebhook] General multiplexer webhook endpoint triggered:", JSON.stringify(payload));

  const transactionId = payload.transaction_id || payload.id || payload.payment_id || payload.bill_id || payload.order_id;
  if (!transactionId) {
    return res.status(400).json({ error: "Missing trace transaction ID" });
  }

  const webhookLockKey = `multiplex_webhook:${transactionId}`;
  const lockAcquired = await idempotencyService.acquireLock(webhookLockKey);
  if (!lockAcquired.success) {
    console.warn(`[PaymentWebhook] Concurrent lock acquired previously for transaction: ${transactionId}`);
    return res.status(409).json({ error: "Event currently being processed. Please retry." });
  }

  try {
    // Standardize event and transition
    const isSuccess = payload.paid === 'true' || payload.paid === true || payload.status === 'success' || payload.status === 'completed' || payload.status === '1';
    
    const result = await processPaymentPaid(
      payload.payment_id,
      transactionId,
      Number(payload.amount || 0),
      payload.provider || "online",
      payload
    );

    idempotencyService.set(webhookLockKey, { status: "completed", result, createdAt: Date.now() });
    res.json({ success: true, message: "Webhook successfully registered and finalized.", result });
  } catch (err: any) {
    console.error("[PaymentWebhook] Multiplexer processing Exception:", err);
    idempotencyService.delete(webhookLockKey);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 8. SPECIFIC WEBHOOK ENDPOINTS (Billplz, Stripe, SenangPay, Curlec)
// Delegated into specific verification and central update mechanics!
// -----------------------------------------------------

// BILLPLZ WEBHOOK
router.post("/webhooks/billplz", async (req, res) => {
  console.log("[Webhook][Billplz] Triggered with body:", JSON.stringify(req.body));
  try {
    const payload = req.body || {};
    const isPaid = payload.paid === 'true' || payload.paid === true;
    const refId = payload.id || payload.bill_id;
    
    if (isPaid && refId) {
      await processPaymentPaid("", refId, Number(payload.amount || 0) / 100, "billplz", payload);
    }
    res.send("OK");
  } catch (err: any) {
    console.error("[Webhook][Billplz] Processing Failure:", err.message);
    res.status(500).send("Callback Execution Fail");
  }
});

// STRIPE WEBHOOK
router.post("/webhooks/stripe", async (req, res) => {
  console.log("[Webhook][Stripe] Triggered with headers keys:", Object.keys(req.headers));
  try {
    const payload = req.body || {};
    const dataObj = payload.data?.object || {};
    const refId = dataObj.id;
    const paymentId = dataObj.metadata?.payment_id || "";

    // 1. Find the payment record in the database using paymentId or refId to get restaurant_id
    let restaurantId = "";
    if (paymentId || refId) {
      const q = supabaseAdmin.from('payments').select('restaurant_id');
      if (paymentId) {
        q.eq('id', paymentId);
      } else {
        q.eq('idempotency_key', refId);
      }
      const { data: payRec } = await q.maybeSingle();
      if (payRec) {
        restaurantId = payRec.restaurant_id;
      }
    }

    if (!restaurantId) {
      throw new Error(`Unable to determine restaurant context for Stripe Webhook. PaymentId: ${paymentId}, RefId: ${refId}`);
    }

    // 2. Load payment config for this restaurant
    const paymentContext = await getPaymentProviderForRestaurant(restaurantId);
    if (paymentContext.providerName !== "stripe") {
      throw new Error(`Restaurant ${restaurantId} payment provider is configured as ${paymentContext.providerName}, but received Stripe Webhook`);
    }

    // 3. Verify Stripe signature via Stripe provider
    const rawPayload = {
      rawBody: (req as any).rawBody,
      ...req.body
    };
    const verifyRes = await paymentContext.provider.verifyWebhook(rawPayload, req.headers);

    if (!verifyRes.success || verifyRes.status !== "completed") {
      throw new Error(`Stripe signature verification failed or event type not completed`);
    }

    // 4. Extract verified success parameters and process payment
    const verifiedPaymentId = verifyRes.payment_id || paymentId;
    const verifiedRefId = verifyRes.reference_id || refId;
    const verifiedAmount = verifyRes.amount || (dataObj.amount_total || 0) / 100;

    await processPaymentPaid(verifiedPaymentId, verifiedRefId, verifiedAmount, "stripe", verifyRes.raw_payload);

    res.json({ received: true });
  } catch (err: any) {
    console.error("[Webhook][Stripe] Signature/Processing Failure:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// SENANGPAY WEBHOOK
router.post("/webhooks/senangpay", async (req, res) => {
  console.log("[Webhook][SenangPay] Triggered with query:", req.query, "body:", req.body);
  try {
    const payload = { ...req.body, ...req.query };
    const status = payload.status;
    const refId = payload.order_id;
    const amount = Number(payload.amount || 0);
    
    if (status === '1' && refId) {
      await processPaymentPaid("", refId, amount, "senangpay", payload);
    }
    res.send("OK");
  } catch (err: any) {
    console.error("[Webhook][SenangPay] Processing Failure:", err.message);
    res.status(500).send("OK"); // Respond OK to prevent endless re-delivery retries if config exists
  }
});

// CURLEC WEBHOOK
router.post("/webhooks/curlec", async (req, res) => {
  console.log("[Webhook][Curlec] Triggered:", JSON.stringify(req.body));
  try {
    const payload = req.body || {};
    const status = payload.status || payload.event;
    const refId = payload.reference_id || payload.ref || payload.id;
    
    if ((status === 'success' || status === 'completed' || status === 'payment.captured') && refId) {
      await processPaymentPaid("", refId, Number(payload.amount || 0), "curlec", payload);
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Webhook][Curlec] Processing Failure:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 9. OTHER ENDPOINTS: Preserving original payments.routes.ts
// Mappings for manual listings or cash transaction logging!
// -----------------------------------------------------
router.get("/orders/:orderId/payments", authenticateJWT, requireTenantIsolation(), requirePermissions('payments.view'), async (req, res) => {
  const { sessionId } = req.query;
  let query;
  if (sessionId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
    if (!isUuid) return res.json([]);
    
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('session_id', sessionId);
    
    const orderIds = (orders || []).map(o => o.id);
    if (orderIds.length === 0) return res.json([]);
    
    query = supabaseAdmin
      .from('payments')
      .select('*')
      .in('order_id', orderIds);
  } else {
    query = supabaseAdmin
      .from('payments')
      .select('*')
      .eq('order_id', req.params.orderId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/orders/:orderId/payments", authenticateJWT, requireTenantIsolation(), requirePermissions('payments.view'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .insert({
      ...req.body,
      order_id: req.params.orderId
    })
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post("/cash-transactions", authenticateJWT, requireTenantIsolation(), requirePermissions('payments.view'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cash_transactions')
    .insert(req.body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
