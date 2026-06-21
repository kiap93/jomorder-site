import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation, requirePermissions, requireAnyPermission } from "../middleware/authMiddleware";

const router = Router();

// Get dining sessions for a restaurant
router.get("/restaurants/:restId/dining-sessions", authenticateJWT, requireTenantIsolation('restId'), requireAnyPermission('orders.view'), async (req, res) => {
  const status = req.query.status;
  let query = supabaseAdmin
    .from('dining_sessions')
    .select('*, orders(id, total_price, status, paid_at, items, session_id)')
    .eq('restaurant_id', req.params.restId);
  
  if (status === 'active') {
    query = query.in('status', ['active', 'awaiting_payment', 'paid']);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  if (status === 'active') {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
    const filteredData = (data || []).filter((session: any) => {
      if (session.status === 'active' || session.status === 'awaiting_payment') {
        return true;
      }
      if (session.status === 'paid') {
        const sessionDate = new Date(session.started_at || session.created_at || Date.now()).getTime();
        return sessionDate > yesterday;
      }
      return false;
    });
    return res.json(filteredData);
  }

  res.json(data || []);
});

// Get orders belonging to a dining session
router.get("/dining-sessions/:id/orders", authenticateJWT, requireTenantIsolation(), requireAnyPermission('orders.view'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, payments(amount)')
    .eq('session_id', req.params.id)
    .neq('status', 'cancelled');
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Settle dining session from back-office/counter counter-cash payments
router.post("/dining-sessions/:id/settle", authenticateJWT, requireTenantIsolation(), requirePermissions('payments.view'), async (req, res) => {
  const { orderIds, paidAmount } = req.body;
  try {
    const { error: orderError } = await supabaseAdmin
      .from('orders')
      .update({
        paid_at: new Date().toISOString(),
        payment_method: 'counter'
      })
      .in('id', orderIds);
    
    if (orderError) throw orderError;

    // Graduating 'pending' orders to 'confirmed' status
    await supabaseAdmin
      .from('orders')
      .update({ status: 'confirmed' })
      .in('id', orderIds)
      .eq('status', 'pending');

    const { error: sessionError } = await supabaseAdmin
      .from('dining_sessions')
      .update({
        status: 'paid',
        paid_amount: paidAmount
      })
      .eq('id', req.params.id);
    
    if (sessionError) throw sessionError;

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update dining session details
router.patch("/dining-sessions/:id", authenticateJWT, requireTenantIsolation(), requireAnyPermission('orders.view'), async (req, res) => {
  if (req.body && req.body.status === 'closed') {
    // Check if there are outstanding payments
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, status, paid_at, voided')
      .eq('session_id', req.params.id);

    if (ordersError) {
      return res.status(500).json({ error: ordersError.message });
    }

    const unpaidActiveOrders = (orders || []).filter(o => {
      const isPaid = !!o.paid_at;
      const isCancelled = o.status === 'cancelled';
      const isVoided = !!o.voided || o.status === 'voided';
      return !isPaid && !isCancelled && !isVoided;
    });

    if (unpaidActiveOrders.length > 0) {
      return res.status(400).json({ 
        error: "Cannot close dining session with outstanding payments. Please settle or void all orders first." 
      });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('dining_sessions')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
