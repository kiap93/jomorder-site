import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";

// High-performance caching layers
const detectionCache = new Map<string, { isEnglish: boolean; languageCode: string | null; englishTranslation: string | null } | null>();
const translationCache = new Map<string, string | null>();

// LRU eviction helper to avoid potential memory growth
function setInCache<T>(cache: Map<string, T>, key: string, value: T, limit = 5000): void {
  if (cache.size >= limit) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

// Generate unique checksum/hash for the query content
function getHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

export async function detectLanguageAndTranslate(text: string, apiKey?: string): Promise<{ isEnglish: boolean; languageCode: string | null; englishTranslation: string | null } | null> {
  const sanitizedText = (text || "").trim();
  if (!sanitizedText) {
    return null;
  }

  const textHash = getHash(sanitizedText);
  
  // 1. Check cache first
  if (detectionCache.has(textHash)) {
    console.log(`[Translation Cache] HIT! Saved detectLanguageAndTranslate API cost for text hash: ${textHash.substring(0, 8)} ("${sanitizedText.substring(0, 20)}...")`);
    return detectionCache.get(textHash) || null;
  }

  const finalApiKey = apiKey || process.env.GEMINI_API_KEY;
  if (!finalApiKey) {
    return null;
  }

  try {
    const ai = new GoogleGenAI({ 
      apiKey: finalApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `
      You are an expert language detector and culinary translator for a multi-tenant restaurant system.
      Analyze the following text (which is a food menu item name or description):
      "${sanitizedText}"
      
      Determine:
      1. Is this text primarily in English? (Answer true if it's already in English or standard Latin name with no clear translation, false if it's in another language. For terms like "Nasi Lemak" or "Ayam Goreng" which are Malay, return false with languageCode "ms" and englishTranslation as a clean standard culinary spelling without any parenthetical definitions like "(Fragrant Coconut Rice)")
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

    const rawText = response.text.trim();
    const cleanText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(cleanText);
    
    const parsedResult = {
      isEnglish: !!result.isEnglish,
      languageCode: result.languageCode || null,
      englishTranslation: result.englishTranslation ? result.englishTranslation.trim() : null
    };

    // 2. Write to cache
    setInCache(detectionCache, textHash, parsedResult);
    return parsedResult;
  } catch (error) {
    console.error(`[Language Detection] Gemini language detection/translation failed for "${sanitizedText}":`, error);
    return null;
  }
}

export async function translateTextWithGemini(text: string, targetLang: string, restaurantContext?: string): Promise<string | null> {
  const sanitizedText = (text || "").trim();
  if (!sanitizedText) {
    return null;
  }

  const contextStr = (restaurantContext || "General").trim();
  const cacheKey = `${getHash(sanitizedText)}:${targetLang.toLowerCase()}:${getHash(contextStr)}`;

  // 1. Check cache first
  if (translationCache.has(cacheKey)) {
    console.log(`[Translation Cache] HIT! Saved translateTextWithGemini API cost for cache key: ${cacheKey.substring(0, 12)} ("${sanitizedText.substring(0, 20)}...")`);
    return translationCache.get(cacheKey) || null;
  }

  const apiKey = process.env.GEMINI_API_KEY;
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
      
      Term: "${sanitizedText}"
      Restaurant Type: ${contextStr}
      
      Context Guidelines:
      - For Bubble Tea: Use established tea culture terms.
      - For Malaysian Restaurants: Use authentic local terms if target is Bahasa Melayu.
      - Aim for appetite appeal and accuracy.
      - CRITICAL: Do NOT append any definitions, descriptions, ingredients, transliterations, or alternative/literal names in parentheses or brackets (for example: do NOT translate "Nasi Lemak" into "Nasi Lemak (Fragrant Coconut Rice)" or "椰浆饭（椰香米饭）"). Keep the translation completely concise, authentic, and direct, containing ONLY the item name itself without any parenthetical clarifications or extra comments.
      
      Return ONLY the translated text, no explanation or quotes.
      `
    });

    const translatedText = response.text.trim();
    
    // 2. Write to cache
    setInCache(translationCache, cacheKey, translatedText);
    return translatedText;
  } catch (error) {
    console.error(`[Gemini Translation] Gemini Translation failed for "${sanitizedText}" to ${targetLang}:`, error);
    return null;
  }
}
