import { Product, ProductSelection, SelectedGroupItem, ProductGroup } from '../types';

/**
 * Calculates the total price of a selection including base price and all modifiers.
 */
export const calculateSelectionPrice = (product: Product, selection: ProductSelection): number => {
  let total = product.basePrice;

  const traverseSelections = (selections: Record<string, SelectedGroupItem[]>) => {
    Object.values(selections).forEach(items => {
      items.forEach(item => {
        total += item.priceDelta;
        if (item.nestedSelections) {
          traverseSelections(item.nestedSelections);
        }
      });
    });
  };

  traverseSelections(selection.selections);
  return total;
};

/**
 * Validates if a selection meets all group constraints (required, min/max).
 * This is a recursive validation that follows the active selection tree.
 */
export const validateSelection = (product: Product, selection: ProductSelection): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  const checkGroups = (currentProduct: Product | undefined, currentSelections: Record<string, SelectedGroupItem[]>) => {
    if (!currentProduct?.groups) return;

    currentProduct.groups.forEach(group => {
      const selectedItems = currentSelections[group.id] || [];
      const count = selectedItems.length;

      // Only validate required groups if they are "active" in the current product context
      if (group.required && count === 0) {
        errors.push(`${currentProduct.name}: ${group.name} is required.`);
      }

      if (count < group.minSelect) {
        errors.push(`${currentProduct.name}: ${group.name} requires at least ${group.minSelect} selections.`);
      }

      if (count > group.maxSelect) {
        errors.push(`${currentProduct.name}: ${group.name} allows at most ${group.maxSelect} selections.`);
      }

      // Recursively check nested selections ONLY for items that are actually selected
      selectedItems.forEach(item => {
        // We need the child product definition to validate its groups
        // In the UI, this is often passed down. In the engine, we look at the item.childProduct
        if (item.nestedSelections && item.childProduct) {
          checkGroups(item.childProduct, item.nestedSelections);
        }
      });
    });
  };

  checkGroups(product, selection.selections);

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Flattens the selection structure for display (e.g. for KDS or receipt).
 */
export const flattenSelections = (selection: ProductSelection): string[] => {
  const flattened: string[] = [];

  const traverse = (selections: Record<string, SelectedGroupItem[]>, depth = 0) => {
    Object.entries(selections).forEach(([_, items]) => {
      items.forEach(item => {
        flattened.push(`${'  '.repeat(depth)}• ${item.name}`);
        if (item.nestedSelections) {
          traverse(item.nestedSelections, depth + 1);
        }
      });
    });
  };

  traverse(selection.selections);
  return flattened;
};
