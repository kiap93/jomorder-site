import { Router } from "express";
import { supabaseAdmin, getStaffSettings } from "../services/dbService";
import { authenticateJWT } from "../middleware/authMiddleware";
import { logToAudit } from "../services/auditService";

const router = Router();

// Get orders
router.get("/restaurants/:restId/orders", authenticateJWT, async (req, res) => {
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
router.patch("/orders/:id", authenticateJWT, async (req, res) => {
  const caller = (req as any).user;
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
      
      if (req.body.status === 'cancelled' && !settings.permissions.can_cancel_order) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to cancel orders." });
      }

      if (req.body.status === 'confirmed' && caller.role === 'runner') {
        return res.status(403).json({ error: "Forbidden: Runners cannot confirm orders." });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('orders')
      .update(req.body)
      .eq('id', orderId)
      .select()
      .single();
    
    if (error) return res.status(500).json({ error: error.message });

    if (caller && caller.email) {
      let action = `Updated Order ${orderId}`;
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
