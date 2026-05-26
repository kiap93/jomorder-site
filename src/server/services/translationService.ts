import { GoogleGenAI } from "@google/genai";

export async function detectLanguageAndTranslate(text: string, apiKey?: string): Promise<{ isEnglish: boolean; languageCode: string | null; englishTranslation: string | null } | null> {
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
      "${text}"
      
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

    const rawText = response.text.trim();
    const cleanText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const result = JSON.parse(cleanText);
    return {
      isEnglish: !!result.isEnglish,
      languageCode: result.languageCode || null,
      englishTranslation: result.englishTranslation ? result.englishTranslation.trim() : null
    };
  } catch (error) {
    console.error(`[Language Detection] Gemini language detection/translation failed for "${text}":`, error);
    return null;
  }
}

export async function translateTextWithGemini(text: string, targetLang: string): Promise<string | null> {
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
      
      Term: "${text}"
      Restaurant Type: General
      
      Context Guidelines:
      - For Bubble Tea: Use established tea culture terms.
      - For Malaysian Restaurants: Use authentic local terms if target is Bahasa Melayu.
      - Aim for appetite appeal and accuracy.
      
      Return ONLY the translated text, no explanation or quotes.
      `
    });
    return response.text.trim();
  } catch (error) {
    console.error(`[Gemini Translation] Gemini Translation failed for "${text}" to ${targetLang}:`, error);
    return null;
  }
}
