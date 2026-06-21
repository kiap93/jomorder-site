import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getUserSupabaseClient } from '../services/db_service';
import { authenticate } from '../middleware/auth';

const diningSessionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Get dining sessions for a restaurant
diningSessionRoutes.get("/api/restaurants/:restId/dining-sessions", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
  const restId = c.req.param('restId');
  const status = c.req.query('status');
  
  let query = supabase
    .from('dining_sessions')
    .select('*, orders(id, total_price, status, paid_at, items, session_id)')
    .eq('restaurant_id', restId);
  
  if (status === 'active') {
    query = query.in('status', ['active', 'awaiting_payment', 'paid']);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

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
    return c.json(filteredData);
  }

  return c.json(data || []);
});

// Get orders belonging to a dining session
diningSessionRoutes.get("/api/dining-sessions/:id/orders", authenticate, async (c) => {
  const supabase = getUserSupabaseClient(c);
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
  const supabase = getUserSupabaseClient(c);
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

    // Graduating 'pending' orders to 'confirmed' status
    await supabase
      .from('orders')
      .update({ status: 'confirmed' })
      .in('id', orderIds)
      .eq('status', 'pending');

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
  const supabase = getUserSupabaseClient(c);
  const body = await c.req.json();

  if (body && body.status === 'closed') {
    // Check if there are outstanding payments
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, status, paid_at, voided')
      .eq('session_id', c.req.param('id'));

    if (ordersError) {
      return c.json({ error: ordersError.message }, 500);
    }

    const unpaidActiveOrders = (orders || []).filter((o: any) => {
      const isPaid = !!o.paid_at;
      const isCancelled = o.status === 'cancelled';
      const isVoided = !!o.voided || o.status === 'voided';
      return !isPaid && !isCancelled && !isVoided;
    });

    if (unpaidActiveOrders.length > 0) {
      return c.json({ 
        error: "Cannot close dining session with outstanding payments. Please settle or void all orders first." 
      }, 400);
    }
  }

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
