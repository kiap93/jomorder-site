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
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    query = query.in('status', ['active', 'paid']).gt('created_at', yesterday);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
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
