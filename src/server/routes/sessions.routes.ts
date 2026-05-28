import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation } from "../middleware/authMiddleware";

const router = Router();

// Get dining sessions for a restaurant
router.get("/restaurants/:restId/dining-sessions", authenticateJWT, requireTenantIsolation('restId'), async (req, res) => {
  const status = req.query.status;
  let query = supabaseAdmin
    .from('dining_sessions')
    .select('*, orders(id, total_price, status, paid_at, items, session_id)')
    .eq('restaurant_id', req.params.restId);
  
  if (status === 'active') {
    query = query.neq('status', 'paid').neq('status', 'expired');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Get orders belonging to a dining session
router.get("/dining-sessions/:id/orders", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, payments(amount)')
    .eq('session_id', req.params.id)
    .neq('status', 'cancelled');
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Settle dining session from back-office/counter counter-cash payments
router.post("/dining-sessions/:id/settle", authenticateJWT, requireTenantIsolation(), async (req, res) => {
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
router.patch("/dining-sessions/:id", authenticateJWT, requireTenantIsolation(), async (req, res) => {
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
