import { supabaseAdmin } from "./dbService";
import { recalculateOrderAndSync } from "./orderAdjustmentService";
import { logToAudit } from "./auditService";

export interface ItemDiscountInput {
  discountType: 'percentage' | 'fixed' | 'override';
  discountValue: number;
  overridePrice?: number;
  reason?: string;
  userId: string;
  userEmail: string;
  userRole: string;
}

export class DiscountService {
  /**
   * Applies a discount to an individual order item.
   * If before kitchen accepts (item status is 'pending'), it's applied immediately.
   * Otherwise, it creates a pending adjustment request.
   */
  static async applyDiscount(
    orderId: string,
    itemId: string,
    restaurantId: string,
    input: ItemDiscountInput
  ) {
    const { discountType, discountValue, overridePrice, reason, userId, userEmail, userRole } = input;

    // Validate inputs
    if (!['percentage', 'fixed', 'override'].includes(discountType)) {
      throw new Error("Invalid discount type. Supported: percentage, fixed, override");
    }
    if (discountValue < 0 || (overridePrice && overridePrice < 0)) {
      throw new Error("Discount value or override price cannot be negative");
    }

    // Get order item and parent order status
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('order_items')
      .select('*, orders(status)')
      .eq('id', itemId)
      .maybeSingle();

    if (itemErr || !item) {
      throw new Error(`Order item not found: ${itemErr?.message || ''}`);
    }

    const orderStatus = (item.orders as any)?.status || 'pending';
    const itemStatus = item.status || 'pending';

    // Business rule: Completed orders cannot be modified directly (creates adjustment request)
    const isCompleted = orderStatus === 'completed' || itemStatus === 'completed';

    // Business rule: Require manager approval if kitchen has already accepted (status !== 'pending')
    const requireApproval = isCompleted || itemStatus !== 'pending';

    // If caller is Owner or Manager, they can modify anything immediately unless it is completed
    const hasImmediatePrivileges = ['owner', 'manager'].includes(userRole.toLowerCase());
    const needsApproval = requireApproval && !hasImmediatePrivileges;

    if (needsApproval) {
      // Create pending discount request
      const { data: request, error: reqErr } = await supabaseAdmin
        .from('order_item_adjustments')
        .insert({
          order_id: orderId,
          order_item_id: itemId,
          restaurant_id: restaurantId,
          type: 'discount',
          discount_type: discountType,
          discount_value: discountValue,
          override_price: overridePrice || null,
          reason: reason || 'Item discount request',
          requested_by: userId,
          status: 'pending'
        })
        .select()
        .single();

      if (reqErr) throw new Error(`Failed to submit discount request: ${reqErr.message}`);

      // Log audit
      logToAudit(
        userId,
        userEmail,
        userRole,
        `SUBMITTED DISCOUNT REQUEST: Item ${item.name} (qty: ${item.quantity || 1}) in Order ${orderId}. Reason: ${reason}`,
        restaurantId
      );

      return {
        success: true,
        pending: true,
        requestId: request.id,
        message: "Discount request submitted. Awaiting manager approval."
      };
    }

    // Apply discount immediately (Owner/Manager, or item is pending)
    const originalPrice = parseFloat(item.original_unit_price || item.price);
    let finalPrice = originalPrice;
    
    if (discountType === 'percentage') {
      finalPrice = originalPrice * (1 - (discountValue / 100));
    } else if (discountType === 'fixed') {
      finalPrice = originalPrice - discountValue;
    } else if (discountType === 'override') {
      finalPrice = overridePrice !== undefined ? overridePrice : discountValue;
    }
    finalPrice = Math.max(0, finalPrice);

    const { error: updateErr } = await supabaseAdmin
      .from('order_items')
      .update({
        discount_type: discountType,
        discount_value: discountValue,
        override_price: overridePrice || null,
        discount_reason: reason || null,
        discounted_by: userId,
        discounted_at: new Date().toISOString(),
        original_unit_price: originalPrice,
        final_unit_price: finalPrice
      })
      .eq('id', itemId);

    if (updateErr) throw new Error(`Failed to apply discount: ${updateErr.message}`);

    // Immutable audit logs trail in order_item_events
    await supabaseAdmin.from('order_item_events').insert({
      order_id: orderId,
      order_item_id: itemId,
      event_type: 'ITEM_DISCOUNTED',
      created_by: userId,
      created_by_role: userRole,
      old_status: itemStatus,
      new_status: itemStatus,
      reason: `Discount Applied: Type ${discountType}, Val ${discountValue}. Reason: ${reason}`
    });

    // General persistent Audit log
    logToAudit(
      userId,
      userEmail,
      userRole,
      `ITEM_DISCOUNTED: Applied ${discountType} discount (${discountValue}) to item ${item.name} (qty: ${item.quantity || 1}). Old Price: RM${originalPrice.toFixed(2)}, New Price: RM${finalPrice.toFixed(2)}`,
      restaurantId
    );

    // Recalculate physical order
    await recalculateOrderAndSync(orderId);

    return {
      success: true,
      pending: false,
      message: "Discount applied immediately and totals recalculated."
    };
  }

  /**
   * Removals of an active discount from an item.
   */
  static async removeDiscount(
    orderId: string,
    itemId: string,
    restaurantId: string,
    userId: string,
    userEmail: string,
    userRole: string
  ) {
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('order_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();

    if (itemErr || !item) {
      throw new Error("Order item not found.");
    }

    const { error: updateErr } = await supabaseAdmin
      .from('order_items')
      .update({
        discount_type: null,
        discount_value: null,
        override_price: null,
        discount_reason: null,
        discounted_by: null,
        discounted_at: null,
        final_unit_price: item.original_unit_price || item.price
      })
      .eq('id', itemId);

    if (updateErr) throw new Error(`Empty discount removal failed: ${updateErr.message}`);

    // Audit logs trail
    await supabaseAdmin.from('order_item_events').insert({
      order_id: orderId,
      order_item_id: itemId,
      event_type: 'ITEM_DISCOUNT_REMOVED',
      created_by: userId,
      created_by_role: userRole,
      old_status: item.status,
      new_status: item.status,
      reason: "Discount removed"
    });

    logToAudit(
      userId,
      userEmail,
      userRole,
      `ITEM_DISCOUNT_REMOVED: Removed discount from item ${item.name} (qty: ${item.quantity || 1})`,
      restaurantId
    );

    await recalculateOrderAndSync(orderId);
    return { success: true, message: "Discount removed." };
  }
}
