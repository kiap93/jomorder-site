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
    const { data: items, error: fetchErr } = await supabaseAdmin
      .from('menu_items')
      .select('name, description');
    
    if (fetchErr || !items) {
      return;
    }

    const terms = new Set<string>();
    items.forEach(it => {
      if (it.name && it.name.trim()) terms.add(it.name.trim());
      if (it.description && it.description.trim()) terms.add(it.description.trim());
    });

    const termList = Array.from(terms);
    const targetLangs = ['zh', 'ms', 'th', 'ja', 'ko'];

    let translationCount = 0;
    const maxTranslationsPerRun = 5;

    for (const term of termList) {
      if (translationCount >= maxTranslationsPerRun) break;

      for (const lang of targetLangs) {
        if (translationCount >= maxTranslationsPerRun) break;

        const { data: existing, error: existingErr } = await supabaseAdmin
          .from('global_translations')
          .select('id')
          .eq('term_key', term)
          .eq('language_code', lang)
          .maybeSingle();

        if (existingErr) continue;

        if (!existing) {
          console.log(`[Background Translation Job] Translating "${term}" to ${lang}...`);
          const translated = await translateTextWithGemini(term, lang, env.GEMINI_API_KEY);
          if (translated) {
            const { error: insertErr } = await supabaseAdmin
              .from('global_translations')
              .upsert({
                term_key: term,
                language_code: lang,
                translated_text: translated,
                confidence_score: 1.00,
                approved: true
              }, { onConflict: 'term_key,language_code' });

            if (insertErr) {
              console.error(`[Background Translation Job] Failed to save translation for "${term}" in ${lang}:`, insertErr);
            } else {
              console.log(`[Background Translation Job] Saved global translation for "${term}" to ${lang}: "${translated}"`);
              translationCount++;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  } catch (err) {
    console.error('[Background Translation Job] Error in translation loop:', err);
  }
}
