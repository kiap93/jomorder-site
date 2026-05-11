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

interface Props {
  product: Product;
  selection: ProductSelection;
  onChange: (selection: ProductSelection) => void;
  currency: string;
  depth?: number;
}

export const ProductConfigurator: React.FC<Props> = ({ product, selection, onChange, currency, depth = 0 }) => {
  const toggleItem = (group: any, item: any, type: 'combo' | 'modifier' | 'legacy') => {
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

  const allGroups = [
    ...(product.groups || []).map(g => ({ ...g, type: 'legacy' as const })),
    ...(product.comboGroups || []).map(g => ({ ...g, type: 'combo' as const })),
    ...(product.modifierGroups || []).map(g => ({ ...g, type: 'modifier' as const }))
  ];

  const visibleGroups = allGroups.filter(g => !shouldHideForCustomer(g.displayBehavior)) || [];

  return (
    <div className={`space-y-8 ${depth > 0 ? 'mt-6 border-l border-white/10 ml-1 pl-2 relative' : 'relative'}`}>
      {visibleGroups.sort((a, b) => a.sortOrder - b.sortOrder).map(group => {
        const selectedCount = selection.selections[group.id]?.length || 0;
        const isSatisfied = selectedCount >= group.minSelect;
        
        let items: any[] = [];
        if (group.type === 'legacy') items = (group as any).items || [];
        else if (group.type === 'combo') items = (group as any).items || [];
        else if (group.type === 'modifier') items = (group as any).modifiers || [];

        const visibleItems = items.filter((i: any) => !shouldHideForCustomer(i.displayBehavior, group.displayBehavior)) || [];

        return (
          <section key={group.id} className="space-y-4 group/section overflow-hidden">
            <div className="flex justify-between items-end relative gap-2">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className={`font-black tracking-[0.2em] uppercase transition-all duration-500 truncate ${
                    depth > 0 ? 'text-[9px] text-zinc-500' : 'text-[11px] text-zinc-100'
                  } ${!isSatisfied ? 'text-orange-500' : ''}`}>
                    {group.name}
                  </h3>
                  {group.required && !isSatisfied && (
                    <motion.span 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="text-[7px] bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded border border-orange-500/20 font-black uppercase tracking-widest shadow-[0_0_10px_rgba(249,115,22,0.1)] shrink-0"
                    >
                      Required
                    </motion.span>
                  )}
                </div>
                <p className="text-zinc-600 text-[8px] font-black uppercase tracking-[0.1em] truncate">
                  {group.minSelect === group.maxSelect 
                    ? `Selection Mandatory (${group.minSelect})` 
                    : `Selection Range: ${group.minSelect}-${group.maxSelect}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-[9px] font-black tracking-widest px-2.5 py-1 rounded-full tabular-nums transition-all ${
                   isSatisfied ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border border-white/5'
                }`}>
                  {selectedCount} <span className="opacity-30">/</span> {group.maxSelect}
                </span>
              </div>
            </div>

            <div className={`grid gap-2 ${depth === 0 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              {visibleItems.sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((item: any) => {
                const isSelected = (selection.selections[group.id] || []).some(i => i.id === item.id || i.groupItemId === item.id);
                const isMaxReached = selectedCount >= group.maxSelect && !isSelected && group.maxSelect > 1;
                
                const selectedItemState = (selection.selections[group.id] || []).find(i => i.id === item.id || i.groupItemId === item.id);

                return (
                  <div key={item.id} className={`${(group.maxSelect === 1 && depth === 0) ? 'col-span-full' : ''} space-y-2 min-w-0`}>
                    <button
                      disabled={isMaxReached}
                      onClick={() => toggleItem(group, item, group.type)}
                      className={`w-full group/btn relative flex items-center justify-between p-3 rounded-xl border transition-all duration-300 active:scale-[0.98] ${
                        isSelected 
                          ? 'bg-zinc-100 text-zinc-900 border-zinc-100 shadow-[0_10px_20px_rgba(0,0,0,0.2)] z-10' 
                          : isMaxReached 
                            ? 'bg-zinc-900/50 border-zinc-900 opacity-20 grayscale cursor-not-allowed'
                            : 'bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all duration-500 shrink-0 ${
                          isSelected ? 'bg-zinc-900 border-zinc-900' : 'bg-zinc-800 border-white/10'
                        }`}>
                          <AnimatePresence mode="wait">
                            {isSelected ? (
                              <motion.div
                                initial={{ scale: 0, rotate: -45 }}
                                animate={{ scale: 1, rotate: 0 }}
                                exit={{ scale: 0, rotate: 45 }}
                                key="check"
                              >
                                <Check size={10} className="text-zinc-100 underline-offset-4" strokeWidth={4} />
                              </motion.div>
                            ) : (
                              <div key="empty" className="w-0.5 h-0.5 rounded-full bg-white/10" />
                            )}
                          </AnimatePresence>
                        </div>
                        <div className="text-left min-w-0">
                          <p className={`font-black text-[10px] transition-colors tracking-wider uppercase break-words leading-tight ${isSelected ? 'text-zinc-900' : 'text-zinc-400'}`}>
                            {item.name || item.customName || item.childProduct?.name || 'Standard Selection'}
                          </p>
                          {item.priceDelta !== 0 && (
                            <p className={`text-[8px] font-black tabular-nums tracking-tighter ${isSelected ? 'text-zinc-500' : 'text-zinc-600'}`}>
                              {item.priceDelta > 0 ? 'ADD +' : 'LESS -'}{currency}{Math.abs(item.priceDelta).toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {isSelected && (item.childProduct?.groups || item.childProduct?.modifierGroups) && (
                         <div className="bg-zinc-900 p-1 rounded-full text-white shrink-0 ml-2">
                           <ChevronRight size={10} strokeWidth={3} className="rotate-90" />
                         </div>
                      )}
                    </button>

                    {/* Nested Configuration */}
                    <AnimatePresence mode="wait">
                      {isSelected && item.childProduct && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="relative pt-2 pb-4">
                            <ProductConfigurator
                              product={item.childProduct as Product}
                              selection={{
                                productId: item.childProductId,
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
