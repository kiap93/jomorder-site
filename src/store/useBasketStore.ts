import { create } from 'zustand';
import { OrderItem } from '../types';

interface BasketState {
  items: OrderItem[];
  addItem: (item: OrderItem) => void;
  removeItem: (index: number) => void;
  clearBasket: () => void;
  getTotal: () => number;
}

export const useBasketStore = create<BasketState>((set, get) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  removeItem: (index) => set((state) => ({
    items: state.items.filter((_, i) => i !== index)
  })),
  clearBasket: () => set({ items: [] }),
  getTotal: () => {
    return get().items.reduce((total, item) => {
      const optionsTotal = item.options.reduce((optTotal, opt) => optTotal + opt.priceDelta, 0);
      return total + (item.price + optionsTotal) * item.quantity;
    }, 0);
  }
}));
