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

const PROTECTED_BRANDS = [
  "mcdonald", "mcchicken", "mcnugget", "coca cola", "coca-cola", "coke", "pepsi",
  "sprite", "fanta", "starbucks", "heineken", "guinness", "tiger beer", "red bull",
  "nutella", "oreo", "kitkat", "milo", "nescafe", "7up", "seven up", "dr pepper", "mountain dew"
];

export function checkBrandSafety(text: string, translated: string | null | undefined, targetLang: string): string {
  const trimmedOriginal = text.trim();
  const trimmedTranslated = (translated || "").trim();
  if (!trimmedTranslated) return trimmedOriginal;

  const lowerOriginal = trimmedOriginal.toLowerCase();
  for (const brand of PROTECTED_BRANDS) {
    if (lowerOriginal === brand || lowerOriginal.includes(brand)) {
      if (trimmedTranslated.toLowerCase() !== lowerOriginal) {
        console.warn("Translation fallback applied", {
          sourceText: trimmedOriginal,
          language: targetLang,
          reason: `Brand name protection triggered for: ${brand}`
        });
        return trimmedOriginal;
      }
    }
  }
  return trimmedTranslated;
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
      
      Mandatory AI Translation Fallback Rules:
      - If you are uncertain about the translation, return the original text.
      - Do not invent, guess, or construct unverified translations.
      - Preserve brand names, product names, restaurant names, and trademarks (e.g. McChicken, Coca Cola, Starbucks, Heineken, Pepsi). Keep them exactly in their original spelling and format.
      - Preserve proper nouns exactly.
      - Return original text if translation confidence or quality is low.
      
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
    
    let englishTrans = result.englishTranslation ? result.englishTranslation.trim() : null;
    if (englishTrans) {
      englishTrans = checkBrandSafety(sanitizedText, englishTrans, "en");
    }

    const parsedResult = {
      isEnglish: !!result.isEnglish,
      languageCode: result.languageCode || null,
      englishTranslation: englishTrans
    };

    // 2. Write to cache
    setInCache(detectionCache, textHash, parsedResult);
    return parsedResult;
  } catch (error: any) {
    console.warn("Translation fallback applied", {
      sourceText: sanitizedText,
      language: "en",
      reason: `Language detection/translation failed: ${error?.message || error}`
    });
    return {
      isEnglish: true,
      languageCode: null,
      englishTranslation: sanitizedText
    };
  }
}

export async function translateTextWithGemini(text: string, targetLang: string, restaurantContext?: string): Promise<string> {
  const sanitizedText = (text || "").trim();
  if (!sanitizedText) {
    return "";
  }

  const contextStr = (restaurantContext || "General").trim();
  const cacheKey = `${getHash(sanitizedText)}:${targetLang.toLowerCase()}:${getHash(contextStr)}`;

  const protectResult = (translated: string | null | undefined): string => {
    const finalTranslation = translated?.trim() ? translated.trim() : sanitizedText;
    
    if (!translated || !translated.trim() || translated.trim().toLowerCase() === "null" || translated.trim().toLowerCase() === "undefined") {
      console.warn("Translation fallback applied", {
        sourceText: sanitizedText,
        language: targetLang,
        reason: "Machine translation returned null/empty/undefined"
      });
      return sanitizedText;
    }

    const brandProtected = checkBrandSafety(sanitizedText, finalTranslation, targetLang);
    return brandProtected;
  };

  // 1. Check cache first
  if (translationCache.has(cacheKey)) {
    console.log(`[Translation Cache] HIT! Saved translateTextWithGemini API cost for cache key: ${cacheKey.substring(0, 12)} ("${sanitizedText.substring(0, 20)}...")`);
    return protectResult(translationCache.get(cacheKey));
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Translation fallback applied", {
      sourceText: sanitizedText,
      language: targetLang,
      reason: "GEMINI_API_KEY is not configured on the server."
    });
    return sanitizedText;
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
      
      Mandatory AI Translation Fallback Rules:
      - If you are uncertain about the translation, return the original text.
      - Do not invent, guess, or construct unverified translations.
      - Preserve brand names, product names, restaurant names, and trademarks (e.g., McChicken, Coca Cola, Starbucks, Heineken, Pepsi, etc.). Keep them exactly in their original spelling and format.
      - Preserve proper nouns and trademarks exactly.
      - Return the original text if translation confidence or quality is low.
      
      Return ONLY the translated text, no explanation, no quotes, no metadata.
      `
    });

    const translatedText = (response.text || "").trim();
    
    const lowerOutput = translatedText.toLowerCase();
    if (lowerOutput.includes("failed") || lowerOutput.includes("error") || lowerOutput.includes("uncertain") || lowerOutput.includes("unknown")) {
      console.warn("Translation fallback applied", {
        sourceText: sanitizedText,
        language: targetLang,
        reason: `AI output indicates uncertainty/failure: "${translatedText}"`
      });
      return sanitizedText;
    }

    const finalVal = protectResult(translatedText);
    
    // 2. Write to cache
    setInCache(translationCache, cacheKey, finalVal);
    return finalVal;
  } catch (error: any) {
    console.warn("Translation fallback applied", {
      sourceText: sanitizedText,
      language: targetLang,
      reason: `Gemini translation call failed: ${error?.message || error}`
    });
    return sanitizedText;
  }
}
