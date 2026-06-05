import { GoogleGenAI } from '@google/genai';
import { Bindings } from '../types';
import { getSupabase } from './db_service';

export function sanitizeTranslationOutput(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  const descPattern = /\s*\((fragrant|coconut|rice|fried|chicken|spicy|sweet|savory|sauce|steamed|soup|noodle|pork|beef|curry|traditional|malay|chinese|local|dish|style)[^)]*\)/gi;
  cleaned = cleaned.replace(descPattern, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

export function isLatinString(text: string): boolean {
  if (!text) return true;
  const nonLatinRegex = /[\u4e00-\u9fff\u3040-\u30ff\u3000-\u303f\uac00-\ud7af\u0e00-\u0e7f]/;
  return !nonLatinRegex.test(text);
}

export async function detectLanguageAndTranslate(text: string, apiKey?: string): Promise<{ isEnglish: boolean; languageCode: string | null; englishTranslation: string | null } | null> {
  const sanitized = (text || "").trim();
  if (!sanitized) return null;

  // Preserve standard Latin strings like Nasi Lemak directly, treating them as English
  // to avoid over-translation and unwanted bracketed/parenthetical explanations in menu_items
  if (isLatinString(sanitized)) {
    return {
      isEnglish: true,
      languageCode: null,
      englishTranslation: sanitized
    };
  }

  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `
      You are an expert language detector and culinary translator for a multi-tenant restaurant system.
      Analyze the following text (which is a food menu item name or description):
      "${sanitized}"
      
      Determine:
      1. Is this text primarily in English? (Answer true if it's already in English or standard Latin name with no clear translation, false if it's in another language. For terms like "Nasi Lemak" or "Ayam Goreng" which are Malay, return false with languageCode "ms" and englishTranslation as a clean English/standard culinary spelling).
      2. If not English, detect its language code. Supported language codes are:
         - "zh" (Chinese)
         - "ms" (Malay/Bahasa Melayu)
         - "th" (Thai)
         - "ja" (Japanese)
         - "ko" (Korean)
         If the language is not one of these, but is non-English, use the closest ISO 2-letter code.
      3. Translate the text from its original language to natural, appealing English.
      
      Return ONLY a JSON object (no markdown formatting, no code blocks, just raw JSON) with the following structure:
      {
        "isEnglish": boolean,
        "languageCode": "zh" | "ms" | "th" | "ja" | "ko" | null,
        "englishTranslation": "translated text in English" | null
      }
      `
    });

    const rawText = (response.text || "").trim();
    const cleanText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(cleanText);
    return {
      isEnglish: !!result.isEnglish,
      languageCode: result.languageCode || null,
      englishTranslation: result.englishTranslation ? sanitizeTranslationOutput(result.englishTranslation) : null
    };
  } catch (error) {
    console.error(`[Language Detection] Gemini language detection/translation failed for "${text}":`, error);
    return null;
  }
}

export async function translateTextWithGemini(text: string, targetLang: string, apiKey?: string): Promise<string | null> {
  const sanitized = (text || "").trim();
  if (!sanitized) return "";

  // If the target language is English, and the source text is already written in standard Latin script,
  // return the source text directly to avoid any unnecessary or verbose machine translation edits.
  if (targetLang.toLowerCase() === 'en' && isLatinString(sanitized)) {
    return sanitized;
  }

  if (!apiKey) {
    return null;
  }
  try {
    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    const targetLangFull = targetLang === 'zh' ? 'Chinese (Simplified)' : targetLang === 'en' ? 'English' : targetLang === 'ms' ? 'Bahasa Melayu' : targetLang;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `
      You are a professional culinary translator specializing in multi-tenant restaurant systems.
      Translate the following food term or description to the target language: ${targetLangFull}.
      
      Term: "${sanitized}"
      Restaurant Type: General
      
      Context Guidelines:
      - For Bubble Tea: Use established tea culture terms.
      - For Malaysian Restaurants: Use authentic local terms if target is Bahasa Melayu.
      - Aim for appetite appeal and accuracy.
      - CRITICAL: Do NOT append any definitions, descriptions, ingredients, transliterations, or alternative/literal names in parentheses or brackets (for example: do NOT translate "Nasi Lemak" into "Nasi Lemak (Fragrant Coconut Rice)" or "椰浆饭（椰香米饭）"). Keep the translation completely concise, authentic, and direct, containing ONLY the item name itself without any parenthetical clarifications or extra comments.
      
      Return ONLY the translated text, no explanation or quotes.
      `
    });
    const rawVal = (response.text || "").trim();
    return sanitizeTranslationOutput(rawVal);
  } catch (error) {
    console.error(`[Background Translation Job] Gemini Translation failed for "${text}" to ${targetLang}:`, error);
    return null;
  }
}

export async function runBackgroundTranslationJob(env: Bindings) {
  try {
    const supabaseAdmin = getSupabase(env);
    const { data: jobs, error: fetchErr } = await supabaseAdmin
      .from('translation_jobs')
      .select('id, restaurant_id, entity_type, entity_id, field_name, source_language, target_language')
      .eq('status', 'pending')
      .limit(5);

    if (fetchErr) {
      console.error('[Background Translation Job] Error fetching pending jobs on worker:', fetchErr);
      return;
    }

    if (!jobs || jobs.length === 0) {
      return;
    }

    console.log(`[Background Translation Job] Found ${jobs.length} pending translation jobs to process on worker.`);

    for (const job of jobs) {
      // Mark job as processing
      await supabaseAdmin
        .from('translation_jobs')
        .update({ status: 'processing' })
        .eq('id', job.id);

      try {
        let textToTranslate = '';
        if (job.entity_type === 'menu_item') {
          const { data: item } = await supabaseAdmin
            .from('menu_items')
            .select('name, description')
            .eq('id', job.entity_id)
            .maybeSingle();

          if (item) {
            textToTranslate = job.field_name === 'description' ? item.description : item.name;
          }
        }

        if (!textToTranslate || !textToTranslate.trim()) {
          console.log(`[Background Translation Job] Empty text or item not found for job ${job.id}. Marking as completed.`);
          await supabaseAdmin
            .from('translation_jobs')
            .update({ 
              status: 'completed', 
              ai_generated_text: '', 
              reviewed_text: '', 
              review_status: 'approved'
            })
            .eq('id', job.id);
          continue;
        }

        console.log(`[Background Translation Job] Translating text for job ${job.id} to ${job.target_language} on worker...`);
        const translated = await translateTextWithGemini(textToTranslate, job.target_language, env.GEMINI_API_KEY);

        if (translated) {
          // 1. Update the translation job
          await supabaseAdmin
            .from('translation_jobs')
            .update({
              status: 'completed',
              ai_generated_text: translated,
              reviewed_text: translated,
              review_status: 'draft'
            })
            .eq('id', job.id);

          // 2. Mirror/save immediately to tenant_translations so the restaurant has access to it
          await supabaseAdmin
            .from('tenant_translations')
            .upsert({
              restaurant_id: job.restaurant_id,
              entity_type: job.entity_type,
              entity_id: job.entity_id,
              field_name: job.field_name,
              language_code: job.target_language,
              translated_text: translated,
              translation_status: 'translated',
              override_global: true
            }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

          // 3. Mirror/save to global_translations for fallback cache
          await supabaseAdmin
            .from('global_translations')
            .upsert({
              term_key: textToTranslate,
              language_code: job.target_language,
              translated_text: translated,
              confidence_score: 1.00,
              approved: true
            }, { onConflict: 'term_key,language_code' });

          console.log(`[Background Translation Job] Saved translations on worker for "${textToTranslate.substring(0, 30)}" in ${job.target_language} -> "${translated.substring(0, 30)}"`);
        } else {
          throw new Error("Translation service returned empty result");
        }
      } catch (jobErr: any) {
        console.error(`[Background Translation Job] Failed processing job ${job.id} on worker:`, jobErr);
        await supabaseAdmin
          .from('translation_jobs')
          .update({ status: 'failed' })
          .eq('id', job.id);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('[Background Translation Job] Error in translation loop on worker:', err);
  }
}
