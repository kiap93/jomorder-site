import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Bindings, Variables } from './worker/types';
import { getSupabase } from './worker/services/db_service';

// Import sub-routers
import authRoutes from './worker/routes/auth';
import staffRoutes from './worker/routes/staff';
import menuRoutes from './worker/routes/menu';
import orderRoutes from './worker/routes/orders';
import paymentRoutes from './worker/routes/payments';
import superadminRoutes from './worker/routes/superadmin';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', logger());
app.use('*', cors());

app.use('*', async (c, next) => {
  if (!c.env || !c.env.JWT_SECRET) {
    if (process.env.GITHUB_ACTIONS === "true" || process.env.CI) {
      c.env = { ...c.env, JWT_SECRET: "dummy_jwt_secret_for_ci_bypass" } as any;
    } else {
      throw new Error('JWT_SECRET env variable is required');
    }
  }
  if (!c.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (process.env.GITHUB_ACTIONS === "true" || process.env.CI) {
      c.env = { ...c.env, SUPABASE_SERVICE_ROLE_KEY: "dummy_supabase_key_for_ci_bypass" } as any;
    } else {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
    }
  }
  await next();
});

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.url} failed: ${err.message}`);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

app.notFound((c) => {
  console.warn(`[WORKER 404] ${c.req.method} ${c.req.url}`);
  return c.json({ 
    error: 'Route not found in Worker', 
    method: c.req.method,
    path: c.req.path 
  }, 404);
});

// --- CORE SYSTEM ROUTES ---

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/debug-restaurants', async (c) => {
  const supabase = getSupabase(c.env);
  try {
    const { data, error } = await supabase.from('restaurants').select('*').limit(1);
    if (error) {
      return c.json({ error: error.message, details: error }, 500);
    }
    const sampleRow = data && data[0] ? data[0] : null;
    return c.json({
      message: "Success",
      columns: sampleRow ? Object.keys(sampleRow) : [],
      sampleRow
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- MOUNT MODULAR SUB-ROUTERS ---

app.route('/', authRoutes);
app.route('/', staffRoutes);
app.route('/', menuRoutes);
app.route('/', orderRoutes);
app.route('/', paymentRoutes);
app.route('/', superadminRoutes);

export default app;
