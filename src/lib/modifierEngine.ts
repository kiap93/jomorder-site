import { ProductSelection, Product, SelectedGroupItem, DisplayBehavior, ProductGroup, ProductGroupItem } from '../types';

export type RenderingContext = 'qr_cart' | 'pos_display' | 'kds' | 'receipt';

export interface RenderedModifier {
  id: string;
  name: string;
  priceDelta: number;
  groupId: string;
  groupName: string;
}

/**
 * Intelligent Modifier Rendering Engine
 * Decides which modifiers to show based on context and behavior settings.
 */
export const getVisibleModifiers = (
  product: Product,
  selection: ProductSelection,
  context: RenderingContext
): RenderedModifier[] => {
  const visible: RenderedModifier[] = [];

  if (!product.groups) return visible;

  product.groups.forEach(group => {
    const selectedItems = selection.selections[group.id] || [];
    const groupBehavior = group.display_behavior || 'only_if_changed';

    // 1. Check if group itself is hidden in this context
    if (shouldHideByContext(groupBehavior, context)) return;

    selectedItems.forEach(selected => {
      const groupItem = group.items?.find(item => item.id === selected.groupItemId);
      const itemBehavior = groupItem?.display_behavior || groupBehavior; // Inherit group behavior if not set on item

      // 2. Check if item is hidden in this context
      if (shouldHideByContext(itemBehavior, context)) return;

      // 3. Intelligent "only_if_changed" logic
      if (itemBehavior === 'only_if_changed') {
        const isDefault = groupItem?.defaultSelected ?? false;
        // If it's a default item, we only show it if the selection for this group is NOT just the defaults
        // BUT for a specific item, if it IS the default, we usually hide it to reduce noise.
        if (isDefault) return;
      }

      visible.push({
        id: selected.groupItemId,
        name: selected.name,
        priceDelta: selected.priceDelta,
        groupId: group.id,
        groupName: group.name
      });
    });
  });

  return visible;
};

const shouldHideByContext = (behavior: DisplayBehavior, context: RenderingContext): boolean => {
  if (behavior === 'hidden') return true;
  
  if (context === 'kds') {
    if (behavior === 'receipt_only') return true;
  }

  if (context === 'receipt') {
    if (behavior === 'kitchen_only') return true;
  }

  if (context === 'qr_cart' || context === 'pos_display') {
    if (behavior === 'kitchen_only' || behavior === 'receipt_only') return true;
  }

  return false;
};

/**
 * Formats modifiers for display strings (e.g. "Less Sugar, No Ice")
 */
export const formatModifiers = (modifiers: RenderedModifier[]): string => {
  return modifiers.map(m => m.name).join(', ');
};
