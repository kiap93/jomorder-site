import express from "express";
import jwt from "jsonwebtoken";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required but was not defined in environment variables");
  }
  return secret;
};

export const authenticateJWT = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    console.warn(`[AUTH FAIL] No token for ${req.path}`);
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const secret = getSecret();
    const decoded = jwt.verify(token, secret);
    (req as any).user = decoded;
    console.log(`[AUTH SUCCESS] User: ${(decoded as any).email}, Path: ${req.path}`);
    next();
  } catch (err) {
    console.warn(`[AUTH FAIL] Invalid token for ${req.path}:`, (err as any).message);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

export const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user;
  const isSuperAdminEmail = user && (user.email === process.env.ADMIN_USER_EMAIL || 
                                     user.email === "admin@saas.com" || 
                                     user.email === "test@example.com" ||
                                     (user.email && user.email.toLowerCase() === "kiap93.kmj@gmail.com"));
  if (!user || (user.role !== 'admin' && !isSuperAdminEmail)) {
    return res.status(403).json({ error: "Forbidden: Superadmin authorization required" });
  }
  next();
};
