import { ProductSelection, Product, SelectedGroupItem, DisplayBehavior, ProductGroup, ProductGroupItem, ComboGroup, ModifierGroup } from '../types';

export type RenderingContext = 'qr_cart' | 'pos_display' | 'kds' | 'receipt';

export interface RenderedModifier {
  id: string;
  name: string;
  priceDelta: number;
  groupId: string;
  groupName: string;
  depth: number;
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

  const allGroups = [
    ...(product.groups || []),
    ...(product.comboGroups || []),
    ...(product.modifierGroups || [])
  ];

  if (allGroups.length === 0) return visible;

  allGroups.forEach(group => {
    const selectedItems = selection.selections[group.id] || [];
    const groupBehavior = group.displayBehavior || 'only_if_changed';

    if (shouldHideByContext(groupBehavior, context)) return;

    selectedItems.forEach(selected => {
      // Find item in appropriate group
      let groupItem: any;
      if (product.groups) {
        groupItem = (group as ProductGroup).items?.find(item => item.id === selected.id || item.id === selected.groupItemId);
      }
      if (!groupItem && product.comboGroups) {
        groupItem = (group as ComboGroup).items?.find(item => item.id === selected.id || item.id === selected.comboItemId);
      }
      if (!groupItem && product.modifierGroups) {
        groupItem = (group as ModifierGroup).modifiers?.find(item => item.id === selected.id || item.id === selected.modifierId);
      }

      const itemBehavior = groupItem?.displayBehavior || groupBehavior; 
      const isHiddenContext = shouldHideByContext(itemBehavior, context);

      if (!isHiddenContext) {
        let shouldShow = true;
        const importance = groupItem?.importance || (group as any).importance || groupItem?.renderImportance || 'normal';

        if (importance === 'critical') {
          shouldShow = true;
        } else if (importance === 'silent') {
          const isDefault = groupItem?.defaultSelected ?? groupItem?.isDefault ?? false;
          if (isDefault) shouldShow = false;
        } else {
          if (itemBehavior === 'only_if_changed') {
            const isDefault = groupItem?.defaultSelected ?? groupItem?.isDefault ?? false;
            if (isDefault) shouldShow = false;
          }
        }

        if (shouldShow) {
          visible.push({
            id: selected.id || selected.groupItemId || '',
            name: selected.name,
            priceDelta: selected.priceDelta,
            groupId: group.id,
            groupName: group.name,
            depth: depth
          });
        }
      }

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
  if (!behavior) return false;

  if (typeof behavior === 'object' && 'visible_in' in behavior) {
    const flags = behavior.visible_in;
    switch (context) {
      case 'kds': return !flags.kds;
      case 'receipt': return !flags.receipt;
      case 'qr_cart': return !flags.qr_cart;
      case 'pos_display': return !flags.qr_cart; // Map pos_display to qr_cart or add flag if needed
      default: return false;
    }
  }

  const b = String(behavior).toLowerCase();
  
  if (b === 'always') return false;
  if (b === 'hidden') return true;
  
  if (context === 'kds') {
    if (b === 'receipt_only' || b === 'receipt') return true;
  }

  if (context === 'receipt') {
    if (b === 'kitchen_only' || b === 'kitchen') return true;
  }

  if (context === 'qr_cart' || context === 'pos_display') {
    if (b === 'kitchen_only' || b === 'kitchen' || b === 'receipt_only' || b === 'receipt') return true;
  }

  return false;
};

/**
 * Formats modifiers for display strings (e.g. "Less Sugar, No Ice")
 */
export const formatModifiers = (modifiers: RenderedModifier[]): string => {
  return modifiers.map(m => m.name).join(', ');
};
