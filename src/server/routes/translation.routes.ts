import { Router } from "express";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT, requireTenantIsolation, requirePermissions } from "../middleware/authMiddleware";
import { translateTextWithGemini } from "../services/translationService";

const router = Router();

// Translate endpoint using Gemini
router.post("/translate", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req, res) => {
  const { text, targetLang, restaurantContext } = req.body;
  
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
  }

  try {
    const translatedText = await translateTextWithGemini(text, targetLang, restaurantContext);
    if (translatedText === null) {
      throw new Error("Translation service returned null");
    }
    res.json({ translatedText });
  } catch (error: any) {
    console.error("AI Translation failed:", error);
    res.status(500).json({ error: `Translation failed: ${error?.message || error}` });
  }
});

// Translation Jobs
router.get("/translation-jobs", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req, res) => {
  const user = (req as any).user;
  const userRestId = user.restaurantId || user.restaurant_id;
  const { filter } = req.query;

  let query = supabaseAdmin
    .from('translation_jobs')
    .select('*')
    .order('created_at', { ascending: false });

  // Enforce tenant boundary on fetch unless superadmin
  if (user.platform_role !== 'superadmin' && user.is_platform_admin !== true) {
    if (userRestId) {
      query = query.eq('restaurant_id', userRestId);
    }
  }

  if (filter && filter !== 'all') {
    query = query.eq('review_status', filter);
  } else {
    query = query.neq('review_status', 'approved');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.patch("/translation-jobs/:id", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('translation_jobs')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Tenant Translations
router.patch("/tenant-translations", authenticateJWT, requireTenantIsolation(), requirePermissions('settings.manage'), async (req, res) => {
  const { restaurantId, entityId, fieldName, languageCode, translatedText } = req.body;
  const { data, error } = await supabaseAdmin
    .from('tenant_translations')
    .update({ translated_text: translatedText })
    .eq('restaurant_id', restaurantId)
    .eq('entity_id', entityId)
    .eq('field_name', fieldName)
    .eq('language_code', languageCode)
    .select();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
