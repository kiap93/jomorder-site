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
 */
export const validateSelection = (product: Product, selection: ProductSelection): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  const checkGroups = (groups: ProductGroup[] | undefined, currentSelections: Record<string, SelectedGroupItem[]>) => {
    if (!groups) return;

    groups.forEach(group => {
      const selectedItems = currentSelections[group.id] || [];
      const count = selectedItems.length;

      if (group.required && count === 0) {
        errors.push(`${group.name} is required.`);
      }

      if (count < group.minSelect) {
        errors.push(`${group.name} requires at least ${group.minSelect} selections.`);
      }

      if (count > group.maxSelect) {
        errors.push(`${group.name} allows at most ${group.maxSelect} selections.`);
      }

      // Recursively check nested selections
      selectedItems.forEach(item => {
        if (item.nestedSelections) {
          // Note: In a real system, we'd need the Product definition for the child to check its groups
          // For now, we assume the engine manages this via recursive UI components
        }
      });
    });
  };

  checkGroups(product.groups, selection.selections);

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
