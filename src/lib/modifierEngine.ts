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
 * Supports recursive traversal of the configuration tree.
 */
export const getVisibleModifiers = (
  product: Product,
  selection: { selections: Record<string, SelectedGroupItem[]> },
  context: RenderingContext,
  depth = 0
): RenderedModifier[] => {
  const visible: RenderedModifier[] = [];

  if (!product.groups) return visible;

  product.groups.forEach(group => {
    const selectedItems = selection.selections[group.id] || [];
    const groupBehavior = group.displayBehavior || 'only_if_changed';

    // 1. Check if group itself is hidden in this context
    if (shouldHideByContext(groupBehavior, context)) return;

    selectedItems.forEach(selected => {
      const groupItem = group.items?.find(item => item.id === selected.groupItemId);
      // Item behavior inherits from group behavior if not set on item
      const itemBehavior = groupItem?.displayBehavior || groupBehavior; 

      const isHiddenContext = shouldHideByContext(itemBehavior, context);

      // 2. Add current item if visible
      if (!isHiddenContext) {
        let shouldShow = true;
        const importance = groupItem?.importance || group.importance || 'normal';

        // 3. Intelligent Rendering Logic with Importance Support
        if (importance === 'critical') {
          // Critical items (e.g. Allergy alerts, specific soup bases) always show regardless of default state
          shouldShow = true;
        } else if (importance === 'silent') {
          // Silent items only show if they are NOT the default
          const isDefault = groupItem?.defaultSelected ?? false;
          if (isDefault) shouldShow = false;
        } else {
          // Normal items: apply display behavior logic
          if (itemBehavior === 'only_if_changed') {
            const isDefault = groupItem?.defaultSelected ?? false;
            if (isDefault) shouldShow = false;
          }
        }

        if (shouldShow) {
          visible.push({
            id: selected.groupItemId,
            name: selected.name,
            priceDelta: selected.priceDelta,
            groupId: group.id,
            groupName: group.name
          });
        }
      }

      // 4. Recurse into nested selections
      if (selected.nestedSelections && selected.childProduct) {
        const nestedVisible = getVisibleModifiers(
          selected.childProduct,
          { selections: selected.nestedSelections },
          context,
          depth + 1
        );
        visible.push(...nestedVisible);
      }
    });
  });

  return visible;
};

const shouldHideByContext = (behavior: DisplayBehavior, context: RenderingContext): boolean => {
  if (behavior === 'always') return false;
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
