import { create } from 'zustand';
import { translations } from '../translations';

export type LanguageCode = 'en' | 'zh' | 'ms';

interface LanguageState {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
}

const getBrowserLanguage = (): LanguageCode => {
  const local = localStorage.getItem('jomorder_locale');
  if (local === 'en' || local === 'zh' || local === 'ms') {
    return local;
  }
  const navLang = navigator.language?.toLowerCase() || '';
  if (navLang.includes('zh') || navLang.includes('cn')) return 'zh';
  if (navLang.includes('ms') || navLang.includes('my')) return 'ms';
  return 'en';
};

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: getBrowserLanguage(),
  setLanguage: (lang: LanguageCode) => {
    localStorage.setItem('jomorder_locale', lang);
    set({ language: lang });
  },
  t: (key: string, variables?: Record<string, string | number>) => {
    const currentLang = get().language;
    const dictionary = translations[currentLang] || translations.en;
    
    // Normalize and robustly map common translation keys to ensure clean resolution
    let lookupKey = key;
    const normalized = key.toLowerCase().trim();
    if (normalized === 'print kot' || normalized === 'printkot' || normalized === 'common.printkot') {
      lookupKey = 'common.printKot';
    } else if (normalized === 'status.active' || normalized === 'active') {
      lookupKey = 'status.active';
    } else if (normalized === 'status.paid' || normalized === 'paid') {
      lookupKey = 'status.paid';
    }

    let text = (dictionary as any)[lookupKey] || (translations.en as any)[lookupKey] || key;
    
    if (text === key && lookupKey !== key) {
      // Fallback if the key mapping did not find a translated value
      text = (dictionary as any)[key] || (translations.en as any)[key] || key;
    }
    
    if (variables) {
      Object.entries(variables).forEach(([vKey, vVal]) => {
        text = text.replace(new RegExp(`\\{${vKey}\\}`, 'g'), String(vVal));
      });
    }
    
    return text;
  }
}));
