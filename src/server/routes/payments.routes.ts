import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT } from "../middleware/authMiddleware";

const router = Router();

// Get list of payments mapped to an order or restaurant session
router.get("/orders/:orderId/payments", authenticateJWT, async (req, res) => {
  const { sessionId } = req.query;
  let query;
  if (sessionId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId));
    if (!isUuid) return res.json([]);
    
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('session_id', sessionId);
    
    const orderIds = (orders || []).map(o => o.id);
    if (orderIds.length === 0) return res.json([]);
    
    query = supabaseAdmin
      .from('payments')
      .select('*')
      .in('order_id', orderIds);
  } else {
    query = supabaseAdmin
      .from('payments')
      .select('*')
      .eq('order_id', req.params.orderId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Create payment for order
router.post("/orders/:orderId/payments", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .insert({
      ...req.body,
      order_id: req.params.orderId
    })
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Log cash transactions
router.post("/cash-transactions", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cash_transactions')
    .insert(req.body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
