import { Router } from "express";
import authRoutes from "./auth.routes";
import translationRoutes from "./translation.routes";
import menuRoutes from "./menu.routes";
import staffRoutes from "./staff.routes";
import workspaceRoutes from "./workspace.routes";
import superadminRoutes from "./superadmin.routes";
import tablesRoutes from "./tables.routes";
import ordersRoutes from "./orders.routes";
import sessionsRoutes from "./sessions.routes";
import paymentsRoutes from "./payments.routes";
import publicRoutes from "./public.routes";

const router = Router();

// Gather all sub-routes which are individually declared under the "/api" nested paths
router.use("/api", authRoutes);
router.use("/api", translationRoutes);
router.use("/api", menuRoutes);
router.use("/api", staffRoutes);
router.use("/api", workspaceRoutes);
router.use("/api/superadmin", superadminRoutes);
router.use("/api", tablesRoutes);
router.use("/api", ordersRoutes);
router.use("/api", sessionsRoutes);
router.use("/api", paymentsRoutes);
router.use("/api/public", publicRoutes);

export default router;
