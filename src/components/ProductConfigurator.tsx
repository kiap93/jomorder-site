import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, AlertTriangle, ChevronRight, CornerDownRight } from 'lucide-react';
import { Product, ProductGroup, ProductSelection, SelectedGroupItem, ProductGroupItem, DisplayBehavior } from '../types';
import { calculateSelectionPrice, validateSelection } from '../lib/configEngine';

const shouldHideForCustomer = (behavior?: DisplayBehavior, parentBehavior?: DisplayBehavior): boolean => {
  const effective = behavior || parentBehavior;
  if (!effective) return false;
  
  if (typeof effective === 'object' && 'visible_in' in effective) {
    return !effective.visible_in.product_configurator;
  }

  // Normalize and check all kitchen/receipt exclusion cases for backward compatibility strings
  const b = String(effective).toLowerCase();
  return b === 'hidden' || b === 'kitchen_only' || b === 'kitchen' || b === 'receipt_only' || b === 'receipt';
};

interface ConfigGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  displayBehavior?: DisplayBehavior;
  sortOrder: number;
  type: 'legacy' | 'combo' | 'modifier';
  items?: any[];
  modifiers?: any[];
}

interface ConfigItem {
  id: string;
  childProductId?: string;
  customName?: string;
  name?: string;
  priceDelta: number;
  defaultSelected?: boolean;
  displayBehavior?: DisplayBehavior;
  sortOrder: number;
  childProduct?: Product;
}

interface Props {
  product: Product;
  selection: ProductSelection;
  onChange: (selection: ProductSelection) => void;
  currency: string;
  depth?: number;
}

export const ProductConfigurator: React.FC<Props> = ({ product, selection, onChange, currency, depth = 0 }) => {
  const toggleItem = (group: ConfigGroup, item: ConfigItem, type: 'combo' | 'modifier' | 'legacy') => {
    const currentSelected = selection.selections[group.id] || [];
    const isSelected = currentSelected.some(i => i.id === item.id || i.groupItemId === item.id);

    let newSelected: SelectedGroupItem[];

    if (isSelected) {
      newSelected = currentSelected.filter(i => i.id !== item.id && i.groupItemId !== item.id);
    } else {
      const newItem: SelectedGroupItem = {
        id: item.id,
        groupItemId: item.id, // backward compat
        productId: item.childProductId || '',
        name: item.name || item.customName || item.childProduct?.name || 'Option',
        priceDelta: item.priceDelta || 0,
        nestedSelections: {},
        childProduct: item.childProduct 
      };
      
      if (type === 'modifier') {
        newItem.modifierId = item.id;
      } else if (type === 'combo') {
        newItem.comboItemId = item.id;
      }

      if (group.maxSelect === 1) {
        newSelected = [newItem];
      } else if (currentSelected.length < (group.maxSelect || 1)) {
        newSelected = [...currentSelected, newItem];
      } else {
        return;
      }
    }

    onChange({
      ...selection,
      selections: {
        ...selection.selections,
        [group.id]: newSelected
      }
    });
  };

  const updateNestedSelection = (groupId: string, id: string, nestedSelection: ProductSelection) => {
    const groupSelections = [...(selection.selections[groupId] || [])];
    const itemIndex = groupSelections.findIndex(i => i.id === id || i.groupItemId === id);
    
    if (itemIndex > -1) {
      groupSelections[itemIndex] = {
        ...groupSelections[itemIndex],
        nestedSelections: nestedSelection.selections
      };
      
      onChange({
        ...selection,
        selections: {
          ...selection.selections,
          [groupId]: groupSelections
        }
      });
    }
  };

  if (depth > 5) return <div className="p-4 text-zinc-500 text-[10px]">Maximum configuration depth reached.</div>;

  const allGroups: ConfigGroup[] = [
    ...(product.groups || []).map(g => ({ ...g, type: 'legacy' as const })),
    ...(product.comboGroups || []).map(g => ({ ...g, type: 'combo' as const })),
    ...(product.modifierGroups || []).map(g => ({ ...g, type: 'modifier' as const }))
  ];

  const visibleGroups = allGroups.filter(g => !shouldHideForCustomer(g.displayBehavior)) || [];

  return (
    <div className={`space-y-8 ${depth > 0 ? 'mt-4 border-l border-zinc-100 ml-1 pl-4 relative' : 'relative'}`}>
      {visibleGroups.sort((a, b) => a.sortOrder - b.sortOrder).map(group => {
        const selectedCount = selection.selections[group.id]?.length || 0;
        const isSatisfied = selectedCount >= group.minSelect;
        
        let items: ConfigItem[] = [];
        if (group.type === 'legacy') items = group.items || [];
        else if (group.type === 'combo') items = group.items || [];
        else if (group.type === 'modifier') items = group.modifiers || [];

        const visibleItems = items.filter((i) => !shouldHideForCustomer(i.displayBehavior, group.displayBehavior)) || [];

        return (
          <section key={group.id} className="space-y-3">
            <div className="flex justify-between items-start">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`font-bold transition-all truncate ${
                    depth > 0 ? 'text-sm text-zinc-600' : 'text-base text-zinc-900'
                  }`}>
                    {group.name}
                  </h3>
                  {group.required && !isSatisfied && (
                    <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full border border-orange-100 font-bold shrink-0">
                      Required
                    </span>
                  )}
                </div>
                <p className="text-zinc-500 text-[11px] font-medium mt-0.5">
                  {group.minSelect === group.maxSelect 
                    ? `Pick ${group.minSelect}` 
                    : `Pick up to ${group.maxSelect}`}
                </p>
              </div>
              <div className="shrink-0 pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg transition-all ${
                   isSatisfied ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400'
                }`}>
                  {selectedCount}/{group.maxSelect}
                </span>
              </div>
            </div>

            <div className="grid gap-2 grid-cols-1">
              {visibleItems.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => {
                const isSelected = (selection.selections[group.id] || []).some(i => i.id === item.id || i.groupItemId === item.id);
                const isMaxReached = selectedCount >= group.maxSelect && !isSelected && group.maxSelect > 1;
                
                const selectedItemState = (selection.selections[group.id] || []).find(i => i.id === item.id || i.groupItemId === item.id);

                return (
                  <div key={item.id} className="space-y-2">
                    <button
                      disabled={isMaxReached}
                      onClick={() => toggleItem(group, item, group.type)}
                      className={`w-full relative flex items-center justify-between p-3.5 rounded-xl border transition-all active:scale-[0.98] ${
                        isSelected 
                          ? 'bg-orange-50/50 border-orange-200 ring-1 ring-orange-200' 
                          : isMaxReached 
                            ? 'bg-zinc-50 border-zinc-100 opacity-40 cursor-not-allowed'
                            : 'bg-white border-zinc-100 hover:border-zinc-200 shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                          isSelected ? 'bg-orange-500 border-orange-500' : 'bg-white border-zinc-200'
                        }`}>
                          {isSelected && <Check size={12} className="text-white" strokeWidth={4} />}
                        </div>
                        <div className="text-left min-w-0">
                          <p className={`text-sm font-semibold transition-colors truncate ${isSelected ? 'text-zinc-900' : 'text-zinc-700'}`}>
                            {item.name || item.customName || item.childProduct?.name || 'Option'}
                          </p>
                          {item.priceDelta !== 0 && (
                            <p className={`text-xs font-bold ${isSelected ? 'text-orange-600' : 'text-zinc-400'}`}>
                              {item.priceDelta > 0 ? '+' : '-'}{currency}{Math.abs(item.priceDelta).toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {isSelected && (item.childProduct?.groups || item.childProduct?.modifierGroups || item.childProduct?.comboGroups) && (
                         <div className="bg-orange-500 p-1 rounded-lg text-white shrink-0 ml-2">
                           <ChevronRight size={14} strokeWidth={3} className="rotate-90" />
                         </div>
                      )}
                    </button>

                    {/* Nested Configuration */}
                    <AnimatePresence mode="wait">
                      {isSelected && (item.childProduct?.groups || item.childProduct?.modifierGroups || item.childProduct?.comboGroups) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pb-4">
                            <ProductConfigurator
                              product={item.childProduct as Product}
                              selection={{
                                productId: item.childProductId || '',
                                selections: selectedItemState?.nestedSelections || {}
                              }}
                              onChange={(nested) => updateNestedSelection(group.id, item.id, nested)}
                              currency={currency}
                              depth={depth + 1}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
