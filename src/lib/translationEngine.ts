import { guestSupabase as supabase } from './supabase';
import { LanguageCode, Product, MenuItem } from '../types';

export interface TranslationContext {
  restaurantId: string;
  franchiseId?: string | null;
  targetLanguage: LanguageCode;
}

/**
 * Resolves a translation using the enterprise hierarchy:
 * 1. Branch/Restaurant Override (branch_translations)
 * 2. Franchise Translation (franchise_translations)
 * 3. Tenant/Restaurant Translation (tenant_translations)
 * 4. Global Dictionary (global_translations)
 * 5. Fallback Default Text
 */
export async function resolveTranslation(
  entityId: string,
  entityType: string,
  fieldName: string,
  defaultText: string,
  context: TranslationContext
): Promise<string> {
  const { restaurantId, franchiseId, targetLanguage } = context;

  if (targetLanguage === 'en') return defaultText; // Assuming 'en' is the base language in the editor

  try {
    // 1. Check Branch Override
    const { data: branchData } = await supabase
      .from('branch_translations')
      .select('translated_text')
      .eq('restaurant_id', restaurantId)
      .eq('entity_id', entityId)
      .eq('language_code', targetLanguage)
      .maybeSingle();

    if (branchData?.translated_text) return branchData.translated_text;

    // 2. Check Franchise Translation
    if (franchiseId) {
      const { data: franchiseData } = await supabase
        .from('franchise_translations')
        .select('translated_text')
        .eq('franchise_id', franchiseId)
        .eq('entity_id', entityId)
        .eq('language_code', targetLanguage)
        .maybeSingle();

      if (franchiseData?.translated_text) return franchiseData.translated_text;
    }

    // 3. Check Tenant Translation
    const { data: tenantData } = await supabase
      .from('tenant_translations')
      .select('translated_text')
      .eq('restaurant_id', restaurantId)
      .eq('entity_id', entityId)
      .eq('entity_type', entityType)
      .eq('field_name', fieldName)
      .eq('language_code', targetLanguage)
      .maybeSingle();

    if (tenantData?.translated_text) return tenantData.translated_text;

    // 4. Check Global Translation
    const { data: globalData } = await supabase
      .from('global_translations')
      .select('translated_text')
      .eq('term_key', fieldName === 'name' ? defaultText : `${entityType}_${fieldName}`)
      .eq('language_code', targetLanguage)
      .maybeSingle();

    if (globalData?.translated_text) return globalData.translated_text;

  } catch (error) {
    console.error('Translation resolution error:', error);
  }

  return defaultText;
}

/**
 * Bulk resolves translations for a list of products.
 * Optimization: Fetches all level translations in parallel.
 */
export async function resolveMenuTranslations(
  items: MenuItem[],
  context: TranslationContext
): Promise<MenuItem[]> {
  const { targetLanguage } = context;
  if (targetLanguage === 'en') return items;

  return await Promise.all(
    items.map(async (item) => {
      const translatedName = await resolveTranslation(item.id, 'menu_item', 'name', item.name, context);
      const translatedDesc = item.description 
        ? await resolveTranslation(item.id, 'menu_item', 'description', item.description, context)
        : item.description;

      // Translate groups if they exist
      const translatedGroups = item.groups ? await Promise.all(item.groups.map(async (group) => {
        const groupName = await resolveTranslation(group.id, 'product_group', 'name', group.name, context);
        
        // Translate group items
        const translatedGroupItems = group.items ? await Promise.all(group.items.map(async (gi) => {
          if (!gi.childProduct) return gi;
          const childName = await resolveTranslation(gi.childProduct.id, 'menu_item', 'name', gi.childProduct.name, context);
          return {
            ...gi,
            childProduct: {
              ...gi.childProduct,
              name: childName
            }
          };
        })) : group.items;

        return {
          ...group,
          name: groupName,
          items: translatedGroupItems
        };
      })) : item.groups;

      return {
        ...item,
        name: translatedName,
        description: translatedDesc,
        groups: translatedGroups
      };
    })
  );
}

/**
 * Bulk resolves translations for categories.
 */
export async function resolveCategoryTranslations(
  categories: any[],
  context: TranslationContext
): Promise<any[]> {
  const { targetLanguage } = context;
  if (targetLanguage === 'en') return categories;

  return await Promise.all(
    categories.map(async (cat) => {
      const translatedName = await resolveTranslation(cat.id, 'category', 'name', cat.name, context);
      return {
        ...cat,
        name: translatedName
      };
    })
  );
}

/**
 * Fetches Kitchen Canonical Language names.
 */
export async function getKitchenCanonical(menuItemId: string): Promise<string | null> {
  const { data } = await supabase
    .from('kitchen_canonical_names')
    .select('canonical_name')
    .eq('menu_item_id', menuItemId)
    .maybeSingle();
  
  return data?.canonical_name || null;
}
