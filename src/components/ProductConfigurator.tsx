import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, AlertTriangle, ChevronRight, CornerDownRight } from 'lucide-react';
import { Product, ProductGroup, ProductSelection, SelectedGroupItem, ProductGroupItem } from '../types';
import { calculateSelectionPrice, validateSelection } from '../lib/configEngine';

interface Props {
  product: Product;
  selection: ProductSelection;
  onChange: (selection: ProductSelection) => void;
  currency: string;
  depth?: number;
}

export const ProductConfigurator: React.FC<Props> = ({ product, selection, onChange, currency, depth = 0 }) => {
  const toggleItem = (group: ProductGroup, item: ProductGroupItem) => {
    const currentSelected = selection.selections[group.id] || [];
    const isSelected = currentSelected.some(i => i.groupItemId === item.id);

    let newSelected: SelectedGroupItem[];

    if (isSelected) {
      newSelected = currentSelected.filter(i => i.groupItemId !== item.id);
    } else {
      const newItem: SelectedGroupItem = {
        groupItemId: item.id,
        productId: item.childProductId || '',
        name: item.customName || item.childProduct?.name || 'Option',
        priceDelta: item.priceDelta || 0,
        nestedSelections: {}
      };

      if (group.maxSelect === 1) {
        newSelected = [newItem];
      } else if (currentSelected.length < group.maxSelect) {
        newSelected = [...currentSelected, newItem];
      } else {
        // Option: Auto-replace last selection if max_select > 1? 
        // For now, let's keep it strict or disable UI.
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

  const updateNestedSelection = (groupId: string, groupItemId: string, nestedSelection: ProductSelection) => {
    const groupSelections = [...(selection.selections[groupId] || [])];
    const itemIndex = groupSelections.findIndex(i => i.groupItemId === groupItemId);
    
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

  return (
    <div className={`space-y-10 ${depth > 0 ? 'mt-4 border-l-2 border-zinc-800 ml-4 pl-6' : ''}`}>
      {product.groups?.sort((a, b) => a.sortOrder - b.sortOrder).map(group => {
        const selectedCount = selection.selections[group.id]?.length || 0;
        const isSatisfied = selectedCount >= group.minSelect;

        return (
          <section key={group.id} className="space-y-4">
            <div className="flex justify-between items-end">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className={`font-black tracking-[0.15em] uppercase transition-colors ${depth > 0 ? 'text-xs text-zinc-400' : 'text-sm text-zinc-100'}`}>
                    {group.name}
                  </h3>
                  {group.required && !isSatisfied && (
                    <span className="text-[7px] bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded border border-orange-500/20 font-black uppercase">Required</span>
                  )}
                </div>
                <p className="text-zinc-500 text-[9px] font-bold uppercase tracking-widest">
                  {group.minSelect === group.maxSelect 
                    ? `Pick Exactly ${group.minSelect}` 
                    : `Pick ${group.minSelect}-${group.maxSelect}`}
                </p>
              </div>
              <div className="text-right">
                <span className={`text-[10px] font-black tracking-widest px-2 py-1 rounded-lg ${isSatisfied ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-500'}`}>
                  {selectedCount} / {group.maxSelect}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {group.items?.sort((a, b) => a.sortOrder - b.sortOrder).map(item => {
                const isSelected = (selection.selections[group.id] || []).some(i => i.groupItemId === item.id);
                const isMaxReached = selectedCount >= group.maxSelect && !isSelected && group.maxSelect > 1;
                
                const selectedItemState = (selection.selections[group.id] || []).find(i => i.groupItemId === item.id);

                return (
                  <div key={item.id} className="space-y-2">
                    <button
                      disabled={isMaxReached}
                      onClick={() => toggleItem(group, item)}
                      className={`w-full group relative flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 ${
                        isSelected 
                          ? 'bg-orange-500/10 border-orange-500/40 shadow-[0_0_20px_rgba(249,115,22,0.05)]' 
                          : isMaxReached 
                            ? 'bg-zinc-900/50 border-zinc-800 opacity-40 grayscale cursor-not-allowed'
                            : 'bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                          isSelected ? 'bg-orange-500 border-orange-500' : 'bg-zinc-800 border-white/10'
                        }`}>
                          {isSelected && <Check size={12} className="text-white" strokeWidth={4} />}
                        </div>
                        <div className="text-left">
                          <p className={`font-black text-xs transition-colors tracking-wide ${isSelected ? 'text-white' : 'text-zinc-400'}`}>
                            {item.customName || item.childProduct?.name || 'Standard'}
                          </p>
                          {item.priceDelta !== 0 && (
                            <p className={`text-[9px] font-bold ${isSelected ? 'text-orange-400' : 'text-zinc-600'}`}>
                              {item.priceDelta > 0 ? '+' : ''}{currency} {item.priceDelta.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Nested Configuration */}
                    <AnimatePresence>
                      {isSelected && item.childProduct?.groups && item.childProduct.groups.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
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
