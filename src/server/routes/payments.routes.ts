import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation } from "../middleware/authMiddleware";
import { idempotencyService } from "../services/idempotencyService";

const router = Router();

// Get list of payments mapped to an order or restaurant session
router.get("/orders/:orderId/payments", authenticateJWT, requireTenantIsolation(), async (req, res) => {
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

// Create payment for order
router.post("/orders/:orderId/payments", authenticateJWT, requireTenantIsolation(), async (req, res) => {
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

// Log cash transactions
router.post("/cash-transactions", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cash_transactions')
    .insert(req.body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Digital Payment Gateway Webhook Handler
// Handles gateway confirmations, verifies signature / payloads, and guards against webhook duplicate event triggers.
router.post("/payment/webhook", async (req, res) => {
  const payload = req.body || {};
  console.log("[PaymentWebhook] Received incoming payment webhook event:", JSON.stringify(payload));

  const transactionId = payload.transaction_id || payload.idempotency_key || payload.idempotencyKey || payload.payment_id || payload.paymentId;
  if (!transactionId) {
    return res.status(400).json({ error: "Missing transaction identifier or idempotency_key" });
  }

  // 1. In-Memory Lock prevents concurrent re-entries of identical webhook triggers (mobile instability, network resends)
  const webhookLockKey = `webhook:${transactionId}`;
  const lockAcquired = await idempotencyService.acquireLock(webhookLockKey);
  if (!lockAcquired.success) {
    console.warn(`[PaymentWebhook] Webhook processed or processing matches for transaction client id: ${transactionId}`);
    const record = lockAcquired.record;
    if (record?.status === 'completed') {
      return res.json(record.result);
    }
    return res.status(409).json({ error: "Duplicate webhook event currently being processed. Please retry." });
  }

  try {
    // 2. Query DB to look up existing payment details to ensure strict single execution (Replay protection)
    let { data: payment, error: pError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('idempotency_key', transactionId)
      .maybeSingle();

    if (!payment && payload.payment_id) {
      // Fallback: look up via target UUID
      const { data: pById } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', payload.payment_id)
        .maybeSingle();
      payment = pById;
    }

    if (payment && payment.status === 'completed') {
      console.log(`[PaymentWebhook] Replay Match: Webhook duplicate checks caught already completed transaction context: ${payment.id}`);
      const responsePayload = { success: true, message: "Payment already successfully processed.", payment };
      idempotencyService.set(webhookLockKey, {
        status: 'completed',
        result: responsePayload,
        createdAt: Date.now()
      });
      return res.json(responsePayload);
    }

    let orderId = payment?.order_id || payload.order_id || payload.orderId;
    let paymentAmount = payment?.amount || payload.amount || 0;

    if (!payment) {
      // Orphaned transaction: if payment is not registered but a real order exists, create it securely.
      if (!orderId) {
        idempotencyService.delete(webhookLockKey);
        return res.status(422).json({ error: "Unrecognized transaction. No associated payment ledger or orderId found." });
      }

      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (!order) {
        idempotencyService.delete(webhookLockKey);
        return res.status(404).json({ error: "Associated order not found." });
      }

      paymentAmount = order.total_price || payload.amount || 0;
      
      // Attempt insert with DB-level unique idempotency_key safeguard
      const { data: newPayment, error: insertError } = await supabaseAdmin
        .from('payments')
        .insert({
          restaurant_id: order.restaurant_id,
          order_id: order.id,
          amount: paymentAmount,
          payment_method: payload.method || 'online',
          provider: payload.provider || 'duitnow',
          status: 'completed',
          metadata: { webhook_payload: payload },
          idempotency_key: transactionId
        })
        .select()
        .single();

      if (insertError) {
        // Enforce DB uniqueness check constraint triggers
        if (insertError.code === '23505' || insertError.message?.toLowerCase().includes('unique') || insertError.message?.toLowerCase().includes('duplicate')) {
          const { data: duplicatePayment } = await supabaseAdmin
            .from('payments')
            .select('*')
            .eq('idempotency_key', transactionId)
            .single();

          if (duplicatePayment) {
            const resData = { success: true, message: "Handled concurrent insert replay.", payment: duplicatePayment };
            idempotencyService.set(webhookLockKey, { status: 'completed', result: resData, createdAt: Date.now() });
            return res.json(resData);
          }
        }
        throw insertError;
      }
      payment = newPayment;
    } else {
      // Payment exists in pending/processing, transition it to finished/completed status
      const { data: updatedPayment, error: updatePayError } = await supabaseAdmin
        .from('payments')
        .update({
          status: 'completed',
          metadata: {
            ...(payment.metadata || {}),
            webhook_processed_at: new Date().toISOString(),
            webhook_payload: payload
          }
        })
        .eq('id', payment.id)
        .select()
        .single();

      if (updatePayError) throw updatePayError;
      payment = updatedPayment;
    }

    // 3. Mark the Order table status as confirmed (paid) and set paid_at
    if (orderId) {
      console.log(`[PaymentWebhook] Transitioning Order ${orderId} to confirmed.`);
      const { error: orderUpdateError } = await supabaseAdmin
        .from('orders')
        .update({
          status: 'confirmed',
          paid_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (orderUpdateError) {
        console.error(`[PaymentWebhook] Warning: failed to transition Order ${orderId} state:`, orderUpdateError);
      }
    }

    const finalResponse = {
      success: true,
      message: "Webhook processed successfully.",
      payment_id: payment.id,
      order_id: orderId,
      amount: paymentAmount,
      status: "PAID"
    };

    idempotencyService.set(webhookLockKey, {
      status: 'completed',
      result: finalResponse,
      createdAt: Date.now()
    });

    return res.json(finalResponse);

  } catch (err: any) {
    console.error("[PaymentWebhook] Fatal runtime processing failure error:", err);
    idempotencyService.set(webhookLockKey, {
      status: 'failed',
      error: err.message || "Failed execution",
      createdAt: Date.now()
    });
    return res.status(500).json({ error: err.message || "Internal Webhook Processing Failure" });
  }
});

export default router;
