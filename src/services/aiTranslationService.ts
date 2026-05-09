import { GoogleGenAI } from "@google/genai";
import { LanguageCode } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function translateFoodTerm(text: string, targetLang: LanguageCode, restaurantContext?: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
      You are a professional culinary translator specializing in multi-tenant restaurant systems.
      Translate the following food term or description from English to ${targetLang}.
      
      Term: "${text}"
      Restaurant Type: ${restaurantContext || 'General'}
      
      Context Guidelines:
      - For Bubble Tea: Use established tea culture terms (e.g., 奶盖 -> Milk Foam/Cheese Foam).
      - For Malaysian Restaurants: Use authentic local terms if target is Bahasa Melayu.
      - Aim for appetite appeal and accuracy.
      
      Return ONLY the translated text, no explanation or quotes.
    `});

    return response.text?.trim() || null;
  } catch (error) {
    console.error("AI Translation failed:", error);
    return null;
  }
}
