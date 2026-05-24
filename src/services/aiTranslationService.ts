import { LanguageCode } from "../types";
import { apiClient } from "../lib/apiClient";

export async function translateFoodTerm(text: string, targetLang: LanguageCode, restaurantContext?: string) {
  try {
    const data = await apiClient.post<any>("/api/translate", { text, targetLang, restaurantContext });
    return data.translatedText || null;
  } catch (error) {
    console.error("AI Translation failed:", error);
    return null;
  }
}
