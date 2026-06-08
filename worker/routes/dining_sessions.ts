import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getSupabase } from '../services/db_service';
import { authenticate } from '../middleware/auth';

const diningSessionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Get dining sessions for a restaurant
diningSessionRoutes.get("/api/restaurants/:restId/dining-sessions", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const restId = c.req.param('restId');
  const status = c.req.query('status');
  
  let query = supabase
    .from('dining_sessions')
    .select('*, orders(id, total_price, status, paid_at, items, session_id)')
    .eq('restaurant_id', restId);
  
  if (status === 'active') {
    query = query.neq('status', 'paid').neq('status', 'expired');
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

// Get orders belonging to a dining session
diningSessionRoutes.get("/api/dining-sessions/:id/orders", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('orders')
    .select('*, payments(amount)')
    .eq('session_id', c.req.param('id'))
    .neq('status', 'cancelled');
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data || []);
});

// Settle dining session from back-office/counter counter-cash payments
diningSessionRoutes.post("/api/dining-sessions/:id/settle", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const { orderIds, paidAmount } = await c.req.json();
  try {
    const { error: orderError } = await supabase
      .from('orders')
      .update({
        paid_at: new Date().toISOString(),
        payment_method: 'counter'
      })
      .in('id', orderIds);
    
    if (orderError) throw orderError;

    const { error: sessionError } = await supabase
      .from('dining_sessions')
      .update({
        status: 'paid',
        paid_amount: paidAmount
      })
      .eq('id', c.req.param('id'));
    
    if (sessionError) throw sessionError;

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update dining session details
diningSessionRoutes.patch("/api/dining-sessions/:id", authenticate, async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await supabase
    .from('dining_sessions')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

export default diningSessionRoutes;
