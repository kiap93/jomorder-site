import { Router, Request, Response } from "express";
import { authenticateJWT, requireTenantIsolation, requireAnyPermission } from "../middleware/authMiddleware";
import { generateTaxReport, convertReportToCSV, getRestaurantConfig } from "../services/taxReportingService";
import { supabaseAdmin } from "../services/dbService";
import { logToAudit } from "../services/auditService";

const router = Router();

/**
 * GET /restaurants/:restId/tax/summary
 * Generates high-precision tax reporting data for selected parameters
 */
router.get(
  "/restaurants/:restId/tax/summary",
  authenticateJWT,
  requireTenantIsolation("restId"),
  requireAnyPermission("settings.manage", "orders.view"),
  async (req: Request, res: Response) => {
    const { restId } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const type = (req.query.type as 'daily' | 'monthly' | 'custom') || 'custom';

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Parameters startDate and endDate are required." });
    }

    try {
      const summary = await generateTaxReport(restId, startDate, endDate, type);
      return res.json(summary);
    } catch (err: any) {
      console.error("[TaxRoutes] Error compiling tax report summary:", err);
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  }
);

/**
 * GET /restaurants/:restId/tax/csv
 * Exports complete transaction details compiled inside the summary as CSV
 */
router.get(
  "/restaurants/:restId/tax/csv",
  authenticateJWT,
  requireTenantIsolation("restId"),
  requireAnyPermission("settings.manage", "orders.view"),
  async (req: Request, res: Response) => {
    const { restId } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const type = (req.query.type as 'daily' | 'monthly' | 'custom') || 'custom';

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Parameters startDate and endDate are required." });
    }

    try {
      const summary = await generateTaxReport(restId, startDate, endDate, type);
      const csv = convertReportToCSV(summary);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tax_report_${restId}_${startDate}_to_${endDate}.csv"`
      );
      return res.send(csv);
    } catch (err: any) {
      console.error("[TaxRoutes] Error downloading CSV tax report:", err);
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  }
);

/**
 * GET /restaurants/:restId/tax/config
 * Retrieves current active configurations such as business hours closing limit
 */
router.get(
  "/restaurants/:restId/tax/config",
  authenticateJWT,
  requireTenantIsolation("restId"),
  requireAnyPermission("settings.manage", "orders.view"),
  async (req: Request, res: Response) => {
    const { restId } = req.params;
    try {
      const config = await getRestaurantConfig(restId);
      return res.json(config);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  }
);

/**
 * POST /restaurants/:restId/tax/config
 * Updates the customizable business hours closing limit
 */
router.post(
  "/restaurants/:restId/tax/config",
  authenticateJWT,
  requireTenantIsolation("restId"),
  requireAnyPermission("settings.manage"),
  async (req: Request, res: Response) => {
    const { restId } = req.params;
    const { business_day_close_time } = req.body;
    const caller = (req as Request & { user?: any }).user;

    if (!business_day_close_time || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(business_day_close_time)) {
      return res.status(400).json({ error: "Invalid business_day_close_time. Must match HH:MM format." });
    }

    try {
      // Find business settings ID or record
      const { data: businessSettings, error: selectErr } = await supabaseAdmin
        .from('business_settings')
        .select('*')
        .eq('restaurant_id', restId)
        .maybeSingle();

      if (selectErr) throw selectErr;

      if (businessSettings) {
        const { error: updateErr } = await supabaseAdmin
          .from('business_settings')
          .update({ business_day_close_time })
          .eq('restaurant_id', restId);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabaseAdmin
          .from('business_settings')
          .insert({
            restaurant_id: restId,
            business_id: restId,
            business_day_close_time
          });
        if (insertErr) throw insertErr;
      }

      if (caller && caller.email) {
        logToAudit(
          caller.id,
          caller.email,
          caller.role,
          `Updated F&B business closing hour to ${business_day_close_time}`,
          restId
        );
      }

      return res.json({ success: true, business_day_close_time });
    } catch (err: any) {
      console.error("[TaxRoutes] Error updating business hours closing time configuration:", err);
      return res.status(500).json({ error: err?.message || "Internal server error" });
    }
  }
);

export default router;
