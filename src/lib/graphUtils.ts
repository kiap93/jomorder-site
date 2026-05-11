import { Product } from '../types';

/**
 * Validates a product configuration graph for circular dependencies.
 * Returns true if a cycle is detected.
 */
export const hasCircularDependency = (
  rootProduct: Product, 
  allProducts: Product[],
  visited: Set<string> = new Set()
): boolean => {
  const groupsToStyles = [
    ...(rootProduct.groups || []),
    ...(rootProduct.comboGroups || [])
  ];

  if (groupsToStyles.length === 0) return false;
  
  if (visited.has(rootProduct.id)) return true;
  visited.add(rootProduct.id);

  for (const group of groupsToStyles) {
    if (!(group as any).items) continue;
    for (const item of (group as any).items) {
      if (item.childProductId) {
        const childProduct = allProducts.find(p => p.id === item.childProductId);
        if (childProduct) {
          // Clone visited to keep sibling branches independent
          if (hasCircularDependency(childProduct, allProducts, new Set(visited))) {
            return true;
          }
        }
      }
    }
  }

  return false;
};
