import fs from 'fs';
import path from 'path';

const SETTINGS_FILE_PATH = path.join(process.cwd(), 'src', 'server', 'restaurant_extra_settings.json');

interface ExtraSettings {
  show_voided_on_receipt?: boolean;
}

// Memory cache
let settingsCache: Record<string, ExtraSettings> = {};

// Load cache from disk
try {
  if (fs.existsSync(SETTINGS_FILE_PATH)) {
    const rawData = fs.readFileSync(SETTINGS_FILE_PATH, 'utf8');
    settingsCache = JSON.parse(rawData);
  }
} catch (err) {
  console.error('[ExtraSettingsService] Error loading extra settings from file:', err);
}

function saveToDisk() {
  try {
    const dir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settingsCache, null, 2), 'utf8');
  } catch (err) {
    console.error('[ExtraSettingsService] Error saving extra settings to disk:', err);
  }
}

export const extraSettingsService = {
  getSettings(restaurantId: string): ExtraSettings {
    const defaults = { show_voided_on_receipt: true };
    return {
      ...defaults,
      ...(settingsCache[restaurantId] || {})
    };
  },

  updateSettings(restaurantId: string, updates: ExtraSettings): ExtraSettings {
    settingsCache[restaurantId] = {
      ...(settingsCache[restaurantId] || {}),
      ...updates
    };
    saveToDisk();
    return this.getSettings(restaurantId);
  }
};
