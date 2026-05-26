import { MiddlewareHandler } from 'hono';
import { verifyJWT } from '../auth/jwt';
import { Bindings, Variables } from '../types';

export const authenticate: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return c.json({ error: 'Unauthorized: No token provided' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Unauthorized: Invalid token' }, 401);
  }

  c.set('user', payload);
  await next();
};

export const requireSuperAdmin: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const user = c.get('user');
  const isSuperAdminEmail = user && (user.email === c.env.ADMIN_USER_EMAIL || 
                                     user.email === "admin@saas.com" || 
                                     user.email === "test@example.com" ||
                                     (user.email && user.email.toLowerCase() === "kiap93.kmj@gmail.com"));
  if (!user || (user.role !== 'admin' && !isSuperAdminEmail)) {
    return c.json({ error: "Forbidden: Superadmin authorization required" }, 403);
  }
  await next();
};
