import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "../services/dbService";
import { authenticateJWT } from "../middleware/authMiddleware";

const router = Router();

// Translate endpoint using Gemini
router.post("/translate", authenticateJWT, async (req, res) => {
  const { text, targetLang, restaurantContext } = req.body;
  
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
  }

  try {
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY!,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `
      You are a professional culinary translator specializing in multi-tenant restaurant systems.
      Translate the following food term or description from English to ${targetLang}.
      
      Term: "${text}"
      Restaurant Type: ${restaurantContext || 'General'}
      
      Context Guidelines:
      - For Bubble Tea: Use established tea culture terms.
      - For Malaysian Restaurants: Use authentic local terms if target is Bahasa Melayu.
      - Aim for appetite appeal and accuracy.
      - CRITICAL: Do NOT append any definitions, descriptions, ingredients, transliterations, or alternative/literal names in parentheses or brackets (for example: do NOT translate "Nasi Lemak" into "Nasi Lemak (Fragrant Coconut Rice)" or "椰浆饭（椰香米饭）"). Keep the translation completely concise, authentic, and direct, containing ONLY the item name itself without any parenthetical clarifications or extra comments.
      
      Return ONLY the translated text, no explanation or quotes.
      `
    });
    
    const translatedText = response.text.trim();
    res.json({ translatedText });
  } catch (error: any) {
    console.error("AI Translation failed:", error);
    res.status(500).json({ error: `Translation failed: ${error?.message || error}` });
  }
});

// Translation Jobs
router.get("/translation-jobs", authenticateJWT, async (req, res) => {
  const { filter } = req.query;
  let query = supabaseAdmin
    .from('translation_jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (filter && filter !== 'all') {
    query = query.eq('review_status', filter);
  } else {
    query = query.neq('review_status', 'approved');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.patch("/translation-jobs/:id", authenticateJWT, async (req, res) => {
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
router.patch("/tenant-translations", authenticateJWT, async (req, res) => {
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
