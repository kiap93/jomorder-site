import { supabaseAdmin } from "./dbService";
import { logToAudit } from "./auditService";

export async function recalculateOrderAndSync(orderId: string) {
  // 1. Fetch order details with restaurant join
  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('*, restaurants(*)')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    console.error("[Recalculate] Failed to fetch order:", orderErr?.message);
    return;
  }

  // 2. Fetch order_items rows
  const { data: orderItems, error: itemsErr } = await supabaseAdmin
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  if (itemsErr || !orderItems) {
    console.error("[Recalculate] Failed to fetch order_items:", itemsErr?.message);
    return;
  }

  // Ensure original_unit_price and final_unit_price are populated in memory if they are null
  orderItems.forEach(oi => {
    if (oi.original_unit_price === null || oi.original_unit_price === undefined) {
      oi.original_unit_price = parseFloat(oi.price);
    }
    if (oi.final_unit_price === null || oi.final_unit_price === undefined) {
      oi.final_unit_price = parseFloat(oi.price);
    }
  });

  // 3. Rebuild order items JSON representation
  const itemsJson = orderItems.map(oi => {
    const isVoided = oi.status === 'voided';
    const isCancelled = oi.status === 'cancelled';
    
    // We compute the final unit price based on discount type
    const originalPrice = parseFloat(oi.original_unit_price);
    let finalPrice = originalPrice;
    
    if (oi.discount_type) {
      if (oi.discount_type === 'percentage') {
        finalPrice = originalPrice * (1 - (parseFloat(oi.discount_value) / 100));
      } else if (oi.discount_type === 'fixed') {
        finalPrice = originalPrice - parseFloat(oi.discount_value);
      } else if (oi.discount_type === 'override') {
        finalPrice = parseFloat(oi.override_price !== null ? oi.override_price : oi.discount_value);
      }
      finalPrice = Math.max(0, finalPrice);
    }

    // Round prices nicely
    finalPrice = Math.round(finalPrice * 100) / 100;

    return {
      id: oi.id,
      menuItemId: oi.menu_item_id,
      name: oi.name,
      price: originalPrice, // Base price
      originalUnitPrice: originalPrice,
      finalUnitPrice: finalPrice,
      quantity: oi.quantity,
      status: oi.status,
      options: oi.options || [],
      specialInstructions: oi.special_instructions,
      voided: isVoided || isCancelled,
      voidedAt: oi.voided_at || oi.cancelled_at || null,
      voidedBy: oi.voided_by || oi.cancelled_by || null,
      voidReason: oi.void_reason || oi.cancellation_reason || null,
      discount: oi.discount_type ? {
        type: oi.discount_type,
        value: parseFloat(oi.discount_value),
        overridePrice: oi.override_price ? parseFloat(oi.override_price) : null,
        reason: oi.discount_reason,
        discountedBy: oi.discounted_by,
        discountedAt: oi.discounted_at
      } : null
    };
  });

  // 4. Calculate Subtotals & Totals
  const restaurant = order.restaurants;
  const scRate = (restaurant?.service_charge || 0) / 100;
  const sstRate = (restaurant?.sst || 0) / 100;

  let subtotal = 0;
  itemsJson.forEach((it: any) => {
    if (it.status !== 'voided' && it.status !== 'cancelled') {
      subtotal += it.finalUnitPrice * it.quantity;
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

  // Sync back final unit price to database for each order item row so DB is fully queryable
  for (const oi of orderItems) {
    const originalPrice = parseFloat(oi.original_unit_price);
    let finalPrice = originalPrice;
    if (oi.discount_type) {
      if (oi.discount_type === 'percentage') {
        finalPrice = originalPrice * (1 - (parseFloat(oi.discount_value) / 100));
      } else if (oi.discount_type === 'fixed') {
        finalPrice = originalPrice - parseFloat(oi.discount_value);
      } else if (oi.discount_type === 'override') {
        finalPrice = parseFloat(oi.override_price !== null ? oi.override_price : oi.discount_value);
      }
      finalPrice = Math.max(0, finalPrice);
    }
    finalPrice = Math.round(finalPrice * 100) / 100;

    await supabaseAdmin
      .from('order_items')
      .update({
        original_unit_price: originalPrice,
        final_unit_price: finalPrice
      })
      .eq('id', oi.id);
  }

  // 5. Update orders table
  // Calculate if entire order is voided/cancelled
  const activeItemCount = orderItems.filter(oi => oi.status !== 'voided' && oi.status !== 'cancelled').reduce((sum, oi) => sum + oi.quantity, 0);
  const orderStatus = activeItemCount === 0 ? 'cancelled' : order.status;

  const { error: patchError } = await supabaseAdmin
    .from('orders')
    .update({
      items: itemsJson,
      total_price: grandTotal,
      status: orderStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);

  if (patchError) {
    console.error("[Recalculate] Failed to sync back parent order total:", patchError.message);
  }
}

export class OrderAdjustmentService {
  /**
   * Approves a pending void/discount request.
   */
  static async approveAdjustment(
    adjustmentId: string,
    approverId: string,
    approverEmail: string,
    approverRole: string
  ) {
    // 1. Fetch adjustment request
    const { data: request, error: reqErr } = await supabaseAdmin
      .from('order_item_adjustments')
      .select('*')
      .eq('id', adjustmentId)
      .maybeSingle();

    if (reqErr || !request) {
      throw new Error(`Adjustment request not found: ${reqErr?.message || ''}`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Adjustment is already evaluated. Status: ${request.status}`);
    }

    const { order_id: orderId, order_item_id: orderItemId, restaurant_id: restId, type } = request;

    // 2. Load order item details
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('order_items')
      .select('*')
      .eq('id', orderItemId)
      .maybeSingle();

    if (itemErr || !item) {
      throw new Error("Order item associated with this request not found.");
    }

    // 3. Mark request as approved
    const { error: updReqErr } = await supabaseAdmin
      .from('order_item_adjustments')
      .update({
        status: 'approved',
        approved_by: approverId,
        approved_at: new Date().toISOString()
      })
      .eq('id', adjustmentId);

    if (updReqErr) throw new Error("Failed to approve adjustment request.");

    if (type === 'void') {
      // Perform Void of Item
      const { error: voidErr } = await supabaseAdmin
        .from('order_items')
        .update({
          status: 'voided',
          void_reason: request.reason,
          voided_by: request.requested_by,
          voided_at: new Date().toISOString()
        })
        .eq('id', orderItemId);

      if (voidErr) throw new Error(`Failed to apply approved void to item: ${voidErr.message}`);

      // KOT / Order Event
      await supabaseAdmin.from('order_item_events').insert({
        order_id: orderId,
        order_item_id: orderItemId,
        event_type: 'ITEM_VOID_APPROVED',
        created_by: approverId,
        created_by_role: approverRole,
        old_status: item.status,
        new_status: 'voided',
        reason: `Void Approved by Manager. Request reason: ${request.reason}`
      });

      logToAudit(
        approverId,
        approverEmail,
        approverRole,
        `ITEM_VOID_APPROVED: Approved void for item ${item.name} in Order ${orderId}`,
        restId || 'default'
      );

    } else if (type === 'discount') {
      // Perform Discount of Item
      const originalPrice = parseFloat(item.original_unit_price || item.price);
      let finalPrice = originalPrice;
      const { discount_type: dType, discount_value: dVal, override_price: oPrice } = request;

      if (dType === 'percentage') {
        finalPrice = originalPrice * (1 - (parseFloat(dVal) / 100));
      } else if (dType === 'fixed') {
        finalPrice = originalPrice - parseFloat(dVal);
      } else if (dType === 'override') {
        finalPrice = parseFloat(oPrice !== null ? oPrice : dVal);
      }
      finalPrice = Math.max(0, finalPrice);

      const { error: discErr } = await supabaseAdmin
        .from('order_items')
        .update({
          discount_type: dType,
          discount_value: dVal,
          override_price: oPrice,
          discount_reason: request.reason,
          discounted_by: request.requested_by,
          discounted_at: new Date().toISOString(),
          original_unit_price: originalPrice,
          final_unit_price: finalPrice
        })
        .eq('id', orderItemId);

      if (discErr) throw new Error(`Failed to apply approved discount to item: ${discErr.message}`);

      await supabaseAdmin.from('order_item_events').insert({
        order_id: orderId,
        order_item_id: orderItemId,
        event_type: 'ITEM_DISCOUNT_APPROVED',
        created_by: approverId,
        created_by_role: approverRole,
        old_status: item.status,
        new_status: item.status,
        reason: `Discount Approved. Req: ${dType} (${dVal}). Reason: ${request.reason}`
      });

      logToAudit(
        approverId,
        approverEmail,
        approverRole,
        `ITEM_DISCOUNT_APPROVED: Approved ${dType} (${dVal}) discount for item ${item.name} in Order ${orderId}`,
        restId || 'default'
      );
    }

    // 4. Recalculate totals
    await recalculateOrderAndSync(orderId);

    return { success: true, message: "Adjustment request approved successfully." };
  }

  /**
   * Rejects a pending void/discount request.
   */
  static async rejectAdjustment(
    adjustmentId: string,
    rejectionReason: string,
    approverId: string,
    approverEmail: string,
    approverRole: string
  ) {
    const { data: request, error: reqErr } = await supabaseAdmin
      .from('order_item_adjustments')
      .select('*, order_items(name)')
      .eq('id', adjustmentId)
      .maybeSingle();

    if (reqErr || !request) {
      throw new Error("Adjustment request not found.");
    }

    if (request.status !== 'pending') {
      throw new Error("Adjustment request is no longer pending.");
    }

    // Mark as rejected
    const { error: updErr } = await supabaseAdmin
      .from('order_item_adjustments')
      .update({
        status: 'rejected',
        rejection_reason: rejectionReason || 'Rejected by Manager',
        approved_by: approverId,
        approved_at: new Date().toISOString()
      })
      .eq('id', adjustmentId);

    if (updErr) throw new Error("Failed to reject adjustment request.");

    const itemName = (request.order_items as any)?.name || "Item";

    logToAudit(
      approverId,
      approverEmail,
      approverRole,
      `ITEM_ADJUSTMENT_REJECTED: Rejected ${request.type} for item ${itemName} in Order ${request.order_id}. Reason: ${rejectionReason}`,
      request.restaurant_id || 'default'
    );

    return { success: true, message: "Adjustment request rejected successfully." };
  }
}
