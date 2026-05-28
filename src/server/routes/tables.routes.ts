import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation } from "../middleware/authMiddleware";

const router = Router();

// Get tables
router.get("/restaurants/:restId/tables", authenticateJWT, requireTenantIsolation('restId'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('tables')
    .select('*, current_session:dining_sessions!tables_current_session_id_fkey(*)')
    .eq('restaurant_id', req.params.restId)
    .order('name', { ascending: true });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Create table
router.post("/tables", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('tables')
    .insert(req.body)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Update table
router.patch("/tables/:id", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('tables')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Delete table
router.delete("/tables/:id", authenticateJWT, requireTenantIsolation(), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('tables')
    .delete()
    .eq('id', req.params.id);
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;
