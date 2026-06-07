import { Router, Request } from "express";
import { supabaseAdmin, getStaffSettings } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation, requirePermissions, requireAnyPermission } from "../middleware/authMiddleware";
import { logToAudit } from "../services/auditService";
import { hasPermission } from "../../lib/rbac";

const router = Router();

// Get orders
router.get("/restaurants/:restId/orders", authenticateJWT, requireTenantIsolation('restId'), requireAnyPermission('orders.view', 'kitchen.view'), async (req, res) => {
  const { restId } = req.params;
  const limit = parseInt(req.query.limit as string) || 100;
  console.log(`[API] Fetching orders for restId: ${restId}, limit: ${limit}`);

  const { data, error } = await supabaseAdmin
     .from('orders')
     .select('*, tables(name), payments(amount)')
     .eq('restaurant_id', restId)
     .order('created_at', { ascending: false })
     .limit(limit);
  
  if (error) {
    console.error(`[API ERROR] Fetch orders failed for ${restId}:`, error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.json(data || []);
});

// Update order
router.patch("/orders/:id", authenticateJWT, requireTenantIsolation(), requireAnyPermission('orders.view', 'kitchen.view'), async (req, res) => {
  const caller = (req as Request & { user?: any }).user;
  const orderId = req.params.id;

  try {
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('restaurant_id, status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) throw orderErr;
    if (!order) return res.status(404).json({ error: "Order not found." });

    const restId = order.restaurant_id || caller?.restaurantId || "default";

    if (caller && caller.is_platform_admin !== true) {
      const settings = getStaffSettings(caller.id, caller.role);
      const userRole = caller.role;
      const customPerms = settings.permissions || {};

      // Match statuses to actual operational KDS privileges
      if (req.body.status && req.body.status !== order.status) {
        const nextStatus = req.body.status;
        if (nextStatus === 'preparing' || nextStatus === 'cooking') {
          if (!hasPermission(userRole, 'orders.prepare', customPerms)) {
            return res.status(403).json({ error: "Forbidden: You lack 'orders.prepare' capabilities to start preparation." });
          }
        }
        if (nextStatus === 'ready') {
          if (!hasPermission(userRole, 'orders.ready', customPerms)) {
            return res.status(403).json({ error: "Forbidden: You lack 'orders.ready' capabilities to mark products ready." });
          }
        }
        if (nextStatus === 'completed' || nextStatus === 'bumped') {
          if (!hasPermission(userRole, 'orders.bump', customPerms)) {
            return res.status(403).json({ error: "Forbidden: You lack 'orders.bump' capabilities to bump tickets." });
          }
        }
      }

      if (req.body.status === 'cancelled' && !settings.permissions.can_cancel_order) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to cancel orders." });
      }

      if (req.body.status === 'confirmed' && caller.role === 'runner') {
        return res.status(403).json({ error: "Forbidden: Runners cannot confirm orders." });
      }
    }

    const auditAction = req.body.auditAction;
    delete req.body.auditAction;

    const allowedColumns = [
      'restaurant_id',
      'table_id',
      'session_id',
      'order_type',
      'status',
      'total_price',
      'payment_method',
      'payment_id',
      'paid_at',
      'idempotency_key',
      'session_token',
      'items',
      'created_at',
      'updated_at',
      'discount',
      'voided',
      'void_reason',
      'voided_by',
      'voided_at',
      'void_approved_by'
    ];

    const camelCaseMap: Record<string, string> = {
      restaurantId: 'restaurant_id',
      tableId: 'table_id',
      sessionId: 'session_id',
      orderType: 'order_type',
      totalPrice: 'total_price',
      paymentMethod: 'payment_method',
      paymentId: 'payment_id',
      paidAt: 'paid_at',
      idempotencyKey: 'idempotency_key',
      sessionToken: 'session_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      voidReason: 'void_reason',
      voidedBy: 'voided_by',
      voidedAt: 'voided_at',
      voidApprovedBy: 'void_approved_by'
    };

    const updatePayload: Record<string, any> = {};
    for (const key of Object.keys(req.body)) {
      const dbColumn = camelCaseMap[key] || key;
      if (allowedColumns.includes(dbColumn) && req.body[key] !== undefined) {
        updatePayload[dbColumn] = req.body[key];
      }
    }

    const { data, error } = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select()
      .single();
    
    if (error) return res.status(500).json({ error: error.message });

    if (caller && caller.email) {
      let action = auditAction || `Updated Order ${orderId}`;
      if (req.body.status && req.body.status !== order.status) {
        action = `Changed Order ${orderId} status from [${order.status}] to [${req.body.status}]`;
      }
      logToAudit(caller.id, caller.email, caller.role, action, restId);
    }

    res.json(data);
  } catch (err: any) {
    console.error("Error updating order:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET order items with lazy-sync
router.get("/orders/:orderId/items", authenticateJWT, requireTenantIsolation(), requireAnyPermission('orders.view', 'kitchen.view'), async (req, res) => {
  const { orderId } = req.params;
  try {
    const { ensureOrderItemsSynced } = await import("../services/cancellationService");
    await ensureOrderItemsSynced(orderId);

    const { data, error } = await supabaseAdmin
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (error) {
      // Fallback to order json items
      const { data: order } = await supabaseAdmin.from('orders').select('items').eq('id', orderId).single();
      if (order && Array.isArray(order.items)) {
        return res.json(order.items);
      }
      throw error;
    }
    return res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST staff order item cancel
router.post("/orders/:orderId/items/:itemId/cancel", authenticateJWT, requireTenantIsolation(), requireAnyPermission('orders.view', 'kitchen.view'), async (req, res) => {
  const { orderId, itemId } = req.params;
  const { quantity, reason } = req.body;
  const caller = (req as Request & { user?: any }).user;

  try {
    const cancelQty = parseInt(quantity);
    if (!cancelQty || cancelQty <= 0) {
      return res.status(400).json({ error: "Cancel quantity must be at least 1." });
    }
    if (!reason || reason.trim() === "") {
      return res.status(400).json({ error: "Reason for cancellation is required." });
    }

    const { ensureOrderItemsSynced, cancelOrderItemQuantity } = await import("../services/cancellationService");
    await ensureOrderItemsSynced(orderId);

    const result = await cancelOrderItemQuantity(
      itemId,
      cancelQty,
      reason,
      caller?.id || null,
      caller?.role || 'cashier'
    );

    if (caller && caller.email) {
      logToAudit(
        caller.id, 
        caller.email, 
        caller.role, 
        `Cancelled ${cancelQty} units of item ${itemId} from order ${orderId}. Reason: ${reason}`, 
        caller.restaurantId || 'default'
      );
    }

    return res.json(result);
  } catch (err: any) {
    console.error("Error in staff cancel item:", err);
    res.status(400).json({ error: err.message });
  }
});

// GET /orders/:orderId/item-adjustments
router.get("/orders/:orderId/item-adjustments", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { orderId } = req.params;
  try {
    const { data, error } = await supabaseAdmin
      .from('order_item_adjustments')
      .select('*, order_items(name)')
      .eq('order_id', orderId);

    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    console.error("[API] Failed to get item adjustments:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /orders/:orderId/items/:itemId/discount
router.post("/orders/:orderId/items/:itemId/discount", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { orderId, itemId } = req.params;
  const { discountType, discountValue, overridePrice, reason } = req.body;
  const caller = (req as Request & { user?: any }).user;

  try {
    const { DiscountService } = await import("../services/discountService");

    // If discountType is 'none' or null, we treat this as a removal of the active discount
    if (!discountType || discountType === 'none') {
      const result = await DiscountService.removeDiscount(
        orderId,
        itemId,
        caller?.restaurantId || 'default',
        caller?.id || 'unknown',
        caller?.email || 'unknown@restaurant.com',
        caller?.role || 'cashier'
      );
      return res.json(result);
    }

    const value = parseFloat(discountValue) || 0;
    const ovPrice = overridePrice !== undefined ? parseFloat(overridePrice) : undefined;

    const result = await DiscountService.applyDiscount(
      orderId,
      itemId,
      caller?.restaurantId || 'default',
      {
        discountType,
        discountValue: value,
        overridePrice: ovPrice,
        reason: reason || 'Manual item discount',
        userId: caller?.id || 'unknown',
        userEmail: caller?.email || 'unknown@restaurant.com',
        userRole: caller?.role || 'cashier'
      }
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[API] Error in item discount route:", err);
    return res.status(400).json({ error: err.message });
  }
});

// POST /orders/:orderId/items/:itemId/void
router.post("/orders/:orderId/items/:itemId/void", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { orderId, itemId } = req.params;
  const { reason } = req.body;
  const caller = (req as Request & { user?: any }).user;

  try {
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: "Reason for void is required." });
    }

    const { VoidService } = await import("../services/voidService");
    const result = await VoidService.voidItem(
      orderId,
      itemId,
      caller?.restaurantId || 'default',
      {
        reason,
        userId: caller?.id || 'unknown',
        userEmail: caller?.email || 'unknown@restaurant.com',
        userRole: caller?.role || 'cashier'
      }
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[API] Error in item void route:", err);
    return res.status(400).json({ error: err.message });
  }
});

// POST /orders/:orderId/items/:itemId/restore
router.post("/orders/:orderId/items/:itemId/restore", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { orderId, itemId } = req.params;
  const caller = (req as Request & { user?: any }).user;

  try {
    const { VoidService } = await import("../services/voidService");
    const result = await VoidService.restoreVoid(
      orderId,
      itemId,
      caller?.restaurantId || 'default',
      caller?.id || 'unknown',
      caller?.email || 'unknown@restaurant.com',
      caller?.role || 'cashier'
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[API] Error in item restore route:", err);
    return res.status(400).json({ error: err.message });
  }
});

// POST /orders/:orderId/items/:itemId/adjustments/:adjustmentId/approve
router.post("/orders/:orderId/items/:itemId/adjustments/:adjustmentId/approve", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { adjustmentId } = req.params;
  const caller = (req as Request & { user?: any }).user;

  try {
    // Audit check: Only managers / owners can approve
    const userRole = (caller?.role || 'cashier').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: "Forbidden: Only Owners or Managers can approve item modifications." });
    }

    const { OrderAdjustmentService } = await import("../services/orderAdjustmentService");
    const result = await OrderAdjustmentService.approveAdjustment(
      adjustmentId,
      caller?.id || 'unknown',
      caller?.email || 'unknown@restaurant.com',
      caller?.role || 'manager'
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[API] Error in approve adjustment route:", err);
    return res.status(400).json({ error: err.message });
  }
});

// POST /orders/:orderId/items/:itemId/adjustments/:adjustmentId/reject
router.post("/orders/:orderId/items/:itemId/adjustments/:adjustmentId/reject", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { adjustmentId } = req.params;
  const { rejectionReason } = req.body;
  const caller = (req as Request & { user?: any }).user;

  try {
    // Only managers / owners can reject
    const userRole = (caller?.role || 'cashier').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: "Forbidden: Only Owners or Managers can reject item modifications." });
    }

    const { OrderAdjustmentService } = await import("../services/orderAdjustmentService");
    const result = await OrderAdjustmentService.rejectAdjustment(
      adjustmentId,
      rejectionReason || 'Rejected by Manager',
      caller?.id || 'unknown',
      caller?.email || 'unknown@restaurant.com',
      caller?.role || 'manager'
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[API] Error in reject adjustment route:", err);
    return res.status(400).json({ error: err.message });
  }
});

export default router;
