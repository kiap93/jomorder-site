import { supabaseAdmin } from "./dbService";
import crypto from "crypto";

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

export type OrderItemStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "served"
  | "completed"
  | "cancelled";

export type Role = "owner" | "admin" | "manager" | "cashier" | "waiter" | "kitchen" | "customer";

/**
 * Centered permissions engine for checking if an order item can be cancelled.
 */
export function canCancelOrderItem(
  userRole: Role | string,
  itemStatus: OrderItemStatus | string,
  businessSettings: BusinessSettings,
  orderCreatedAt?: string
): { allowed: boolean; reason?: string } {
  const role = (userRole || "customer").toLowerCase();
  const status = (itemStatus || "pending").toLowerCase() as OrderItemStatus;

  // Already cancelled
  if (status === "cancelled") {
    return { allowed: false, reason: "Item is already cancelled." };
  }

  // Completed items cannot be cancelled by anyone
  if (status === "completed") {
    return { allowed: false, reason: "Completed items cannot be cancelled." };
  }

  // Kitchen cannot cancel items
  if (role === "kitchen") {
    return { allowed: false, reason: "Kitchen staff lack cancellation privileges." };
  }

  // Owners and Managers can cancel any non-completed items
  if (role === "owner" || role === "admin" || role === "manager") {
    return { allowed: true };
  }

  // Cashiers and Waiters can cancel pending and accepted items
  if (role === "cashier" || role === "waiter" || role === "runner") {
    if (status === "pending" || status === "accepted") {
      return { allowed: true };
    }
    return { 
      allowed: false, 
      reason: `Role '${role}' cannot cancel items once kitchen preparation starts (status is '${status}').` 
    };
  }

  // Customer rules
  if (role === "customer" || !role) {
    if (!businessSettings.allow_customer_cancel) {
      return { allowed: false, reason: "Customer cancellations are disabled by the restaurant." };
    }

    // Time limit limit check
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

/**
 * Lazy utility to ensure order items are in order_items table.
 */
export async function ensureOrderItemsSynced(orderId: string, orderData?: any) {
  try {
    let order = orderData;
    if (!order) {
      const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (error || !data) return;
      order = data;
    }

    const { data: existingItems, error: itemsError } = await supabaseAdmin
      .from('order_items')
      .select('id')
      .eq('order_id', orderId);

    if (itemsError) {
      console.warn("[CancellationService] Error loading existing order_items. Table might be missing:", itemsError.message);
      return;
    }

    if (Array.isArray(order.items) && (!existingItems || existingItems.length === 0)) {
      const rowsToInsert = order.items.map((item: any) => {
        let itemId = item.id;
        if (!itemId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
          itemId = crypto.randomUUID();
          item.id = itemId;
        }

        return {
          id: itemId,
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
        };
      });

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabaseAdmin.from('order_items').insert(rowsToInsert);
        if (insertError) {
          console.error("[CancellationService] order_items bulk insert error:", insertError.message);
        } else {
          // Commit generating ID snapshots
          await supabaseAdmin.from('orders').update({ items: order.items }).eq('id', orderId);
        }
      }
    }
  } catch (err: any) {
    console.error("[CancellationService] ensureOrderItemsSynced exception:", err);
  }
}

/**
 * Core business transaction: Cancel specific quantity of an order item
 */
export async function cancelOrderItemQuantity(
  orderItemId: string,
  cancelQty: number,
  reason: string,
  cancelledBy: string | null,
  cancelledByRole: string
) {
  // 1. Load the order item row
  const { data: orderItem, error: oiError } = await supabaseAdmin
    .from('order_items')
    .select('*')
    .eq('id', orderItemId)
    .maybeSingle();

  if (oiError || !orderItem) {
    throw new Error(`Order item matches no records. Details: ${oiError?.message || 'Item not found'}`);
  }

  const orderId = orderItem.order_id;

  // 2. Load the order to get the settings and status
  const { data: order, error: oError } = await supabaseAdmin
    .from('orders')
    .select('*, restaurants(*)')
    .eq('id', orderId)
    .maybeSingle();

  if (oError || !order) {
    throw new Error(`Order loading error: ${oError?.message || 'Order not found'}`);
  }

  // 3. Load configurations or compile fallbacks
  const { data: bizSettings } = await supabaseAdmin
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
  if (cancelQty <= 0) {
    throw new Error("Quantity to cancel must be at least 1.");
  }
  if (cancelQty > orderItem.quantity) {
    throw new Error(`Cannot cancel quantity ${cancelQty} - only ${orderItem.quantity} active units remain.`);
  }

  // 5. Check permissions
  const permCheck = canCancelOrderItem(cancelledByRole, orderItem.status, activeSettings, order.created_at);
  if (!permCheck.allowed) {
    throw new Error(permCheck.reason || "Unauthorized cancellation request.");
  }

  // 6. Execute split or in-place update
  const isPaid = !!order.paid_at;
  const itemPrice = parseFloat(orderItem.price);
  
  // Account for item discount if any
  let unitDiscount = 0;
  if (orderItem.options) {
    // Find parent item discount inside parent order json if needed or keep it simple
  }

  // Look for any discount applied to this item inside JSON
  const orderItemsJson = order.items || [];
  const foundJsonItem = orderItemsJson.find((it: any) => it.id === orderItemId);
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
  let targetCancelId = orderItemId;

  if (isPartial) {
    if (!activeSettings.allow_partial_cancel && cancelledByRole === 'customer') {
      throw new Error("Partial cancellations are disabled for customers.");
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

    const { error: insertErr } = await supabaseAdmin.from('order_items').insert(cancelledRow);
    if (insertErr) throw new Error(`Failed to create split cancelled item row: ${insertErr.message}`);

    // 2. Shrink existing row
    const { error: updateErr } = await supabaseAdmin
      .from('order_items')
      .update({
        quantity: orderItem.quantity - cancelQty,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderItemId);

    if (updateErr) throw new Error(`Failed to shrink active quantity row: ${updateErr.message}`);
    
    targetCancelId = cancelledId;

    // Log split events
    await logOrderItemEvent(orderId, orderItemId, 'ITEM_PARTIALLY_CANCELLED', cancelledBy, cancelledByRole, orderItem.status, orderItem.status, `${reason} (Split qty ${cancelQty} of ${orderItem.quantity})`);
    await logOrderItemEvent(orderId, cancelledId, 'ITEM_CANCELLED', cancelledBy, cancelledByRole, orderItem.status, 'cancelled', reason);

  } else {
    // 1. Total cancellation: Update row in place
    const { error: updateErr } = await supabaseAdmin
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
      .eq('id', orderItemId);

    if (updateErr) throw new Error(`Failed to cancel item row: ${updateErr.message}`);

    await logOrderItemEvent(orderId, orderItemId, 'ITEM_CANCELLED', cancelledBy, cancelledByRole, orderItem.status, 'cancelled', reason);
  }

  // 7. Manage refunds
  if (isPaid && refundAmtForCancellation > 0) {
    const { error: refundErr } = await supabaseAdmin
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
    await logOrderItemEvent(orderId, targetCancelId, 'ITEM_REFUNDED', cancelledBy, cancelledByRole, 'cancelled', 'cancelled', `Refund created for RM ${refundAmtForCancellation.toFixed(2)}`);
  }

  // 8. Rebuild the order items JSON and recalculate prices
  const { data: refreshedOrderItems } = await supabaseAdmin
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);

  if (refreshedOrderItems && refreshedOrderItems.length > 0) {
    const newItemsJson = refreshedOrderItems.map(oi => {
      // Find the corresponding config snippet from original items json if available
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
    const sstRate = (restaurant?.sst || 0) / 100;

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

    // Check if entire order becomes cancelled
    const activeItemCount = refreshedOrderItems.filter(oi => oi.status !== 'cancelled').reduce((sum, oi) => sum + oi.quantity, 0);
    const orderStatus = activeItemCount === 0 ? 'cancelled' : order.status;

    // Update orders table
    const { error: orderUpdErr } = await supabaseAdmin
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

  return { success: true, message: "Order item cancelled successfully." };
}

/**
 * Log order item cancellation/refund trail audits
 */
async function logOrderItemEvent(
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
    await supabaseAdmin
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
