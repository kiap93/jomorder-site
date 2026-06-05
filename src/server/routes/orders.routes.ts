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

export default router;
