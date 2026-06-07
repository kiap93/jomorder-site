import { supabaseAdmin } from "./dbService";
import { recalculateOrderAndSync } from "./orderAdjustmentService";
import { logToAudit } from "./auditService";

export interface ItemVoidInput {
  reason: 'Customer Changed Mind' | 'Wrong Item' | 'Out Of Stock' | 'Kitchen Error' | 'Other' | string;
  userId: string;
  userEmail: string;
  userRole: string;
}

export class VoidService {
  /**
   * Voids an individual order item.
   * If before kitchen accepts (item.status === 'pending'), it voids immediately.
   * Otherwise, it creates a pending adjustment request.
   */
  static async voidItem(
    orderId: string,
    itemId: string,
    restaurantId: string,
    input: ItemVoidInput
  ) {
    const { reason, userId, userEmail, userRole } = input;

    // Load order item and parent order status
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('order_items')
      .select('*, orders(status)')
      .eq('id', itemId)
      .maybeSingle();

    if (itemErr || !item) {
      throw new Error(`Order item not found: ${itemErr?.message || ''}`);
    }

    if (item.status === 'voided') {
      throw new Error("Item is already voided.");
    }

    const orderStatus = (item.orders as any)?.status || 'pending';
    const itemStatus = item.status || 'pending';

    // Business rule: Completed orders cannot be modified directly (creates adjustment request)
    const isCompleted = orderStatus === 'completed' || itemStatus === 'completed';

    // Business rule: Require manager approval if kitchen has already accepted (status !== 'pending')
    const requireApproval = isCompleted || itemStatus !== 'pending';

    // Owner or Manager can void immediately without approval in any case unless it is completed
    const hasImmediatePrivileges = ['owner', 'manager'].includes(userRole.toLowerCase());
    const needsApproval = requireApproval && !hasImmediatePrivileges;

    if (needsApproval) {
      // Create pending void request
      const { data: request, error: reqErr } = await supabaseAdmin
        .from('order_item_adjustments')
        .insert({
          order_id: orderId,
          order_item_id: itemId,
          restaurant_id: restaurantId,
          type: 'void',
          reason: reason || 'Item void request',
          requested_by: userId,
          status: 'pending'
        })
        .select()
        .single();

      if (reqErr) throw new Error(`Failed to submit void request: ${reqErr.message}`);

      // Log audit
      logToAudit(
        userId,
        userEmail,
        userRole,
        `SUBMITTED VOID REQUEST: Item ${item.name} in Order ${orderId}. Reason: ${reason}`,
        restaurantId
      );

      return {
        success: true,
        pending: true,
        requestId: request.id,
        message: "Void request submitted. Awaiting manager approval."
      };
    }

    // Apply void immediately (before kitchen accepts or Manager/Owner Privilege)
    const { error: updateErr } = await supabaseAdmin
      .from('order_items')
      .update({
        status: 'voided',
        void_reason: reason,
        voided_by: userId,
        voided_at: new Date().toISOString()
      })
      .eq('id', itemId);

    if (updateErr) throw new Error(`Failed to void order item: ${updateErr.message}`);

    // Immutable KOT events
    await supabaseAdmin.from('order_item_events').insert({
      order_id: orderId,
      order_item_id: itemId,
      event_type: 'ITEM_VOIDED',
      created_by: userId,
      created_by_role: userRole,
      old_status: itemStatus,
      new_status: 'voided',
      reason: `Item Voided immediately: ${reason}`
    });

    logToAudit(
      userId,
      userEmail,
      userRole,
      `ITEM_VOIDED: Voided item ${item.name} in Order ${orderId}. Reason: ${reason}`,
      restaurantId
    );

    // Recalculate physical order
    await recalculateOrderAndSync(orderId);

    return {
      success: true,
      pending: false,
      message: "Item voided immediately and totals recalculated."
    };
  }

  /**
   * Restores a voided item back to active status.
   */
  static async restoreVoid(
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

    if (item.status !== 'voided') {
      throw new Error("Item is not voided.");
    }

    // Restore to pending status
    const { error: updateErr } = await supabaseAdmin
      .from('order_items')
      .update({
        status: 'pending',
        void_reason: null,
        voided_by: null,
        voided_at: null
      })
      .eq('id', itemId);

    if (updateErr) throw new Error(`Failed to restore voided item: ${updateErr.message}`);

    // KOT event
    await supabaseAdmin.from('order_item_events').insert({
      order_id: orderId,
      order_item_id: itemId,
      event_type: 'ITEM_VOID_RESTORED',
      created_by: userId,
      created_by_role: userRole,
      old_status: 'voided',
      new_status: 'pending',
      reason: "Void restored by user request."
    });

    logToAudit(
      userId,
      userEmail,
      userRole,
      `ITEM_VOID_RESTORED: Restored voided item ${item.name} in Order ${orderId}`,
      restaurantId
    );

    await recalculateOrderAndSync(orderId);

    return {
      success: true,
      message: "Voided item restored successfully."
    };
  }
}
