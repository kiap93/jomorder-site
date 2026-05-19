import { LanguageCode } from "../types";
import { useAuthStore } from "../store/useAuthStore";
import { getApiUrl } from "../lib/api";

export async function translateFoodTerm(text: string, targetLang: LanguageCode, restaurantContext?: string) {
  try {
    const token = useAuthStore.getState().token;
    if (!token) {
      console.warn("Translation ignored: No auth token available.");
      return null;
    }

    const response = await fetch(getApiUrl("/api/translate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ text, targetLang, restaurantContext })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Translation request failed");
    }

    const data = await response.json();
    return data.translatedText || null;
  } catch (error) {
    console.error("AI Translation failed:", error);
    return null;
  }
}
