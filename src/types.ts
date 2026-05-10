export type OrderStatus = 'pending' | 'confirmed' | 'cooking' | 'ready' | 'served' | 'completed' | 'cancelled';

export interface Restaurant {
  id: string;
  name: string;
  currency: string;
  serviceCharge: number;
  sst: number;
  franchiseId?: string;
}

export interface Table {
  id: string;
  name: string;
  status: 'available' | 'occupied';
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface MenuOptionValue {
  name: string;
  priceDelta: number;
}

export interface MenuOption {
  name: string;
  values: MenuOptionValue[];
}

export type MenuItemStatus = 'Available' | 'Low Stock' | 'Out of Stock' | 'Paused' | 'Hidden' | 'Scheduled' | 'Seasonal';

export type ProductType = 'single' | 'combo' | 'configurable';
export type GroupType = 'required' | 'optional' | 'nested';
export type DisplayBehavior = 'always' | 'only_if_changed' | 'hidden' | 'kitchen_only' | 'receipt_only';
export type RenderImportance = 'critical' | 'normal' | 'silent';

export interface ProductGroupItem {
  id: string;
  groupId: string;
  childProductId?: string;
  customName?: string;
  priceDelta: number;
  defaultSelected: boolean;
  displayBehavior?: DisplayBehavior;
  importance?: RenderImportance;
  sortOrder: number;
  childProduct?: Product; // For display
}

export interface ProductGroup {
  id: string;
  productId: string;
  name: string;
  description?: string;
  groupType: GroupType;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  displayBehavior?: DisplayBehavior;
  importance?: RenderImportance;
  sortOrder: number;
  items?: ProductGroupItem[];
}

export type LanguageCode = 'en' | 'zh' | 'ms' | 'th' | 'ja' | 'ko';

export interface TranslationMapping {
  [languageCode: string]: string;
}

export interface Product {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description?: string;
  basePrice: number;
  price: number; // Backward compatibility
  imageUrl?: string;
  isActive: boolean;
  productType: ProductType;
  status: MenuItemStatus;
  groups?: ProductGroup[];
  options?: MenuOption[]; // Legacy
  translations?: Record<string, TranslationMapping>; // field -> { lang -> value }
}

export type MenuItem = Product;

// Selection state for the engine
export interface SelectedGroupItem {
  groupItemId: string;
  productId: string;
  name: string;
  priceDelta: number;
  nestedSelections?: Record<string, SelectedGroupItem[]>; // Recursive
  childProduct?: Product; // Snapshot of the child product for validation and display
}

export interface ProductSelection {
  productId: string;
  selections: Record<string, SelectedGroupItem[]>; // groupId -> selected items
}

export interface OrderItemOption {
  optionName: string;
  valueName: string;
  priceDelta: number;
}

export interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  options: OrderItemOption[];
  selection?: ProductSelection;
  smartRenderedLines?: {
    kds?: string[];
    receipt?: string[];
    customer?: string[];
  };
}

export interface Order {
  id: string;
  tableId: string;
  tableName?: string;
  orderType: 'dine-in' | 'takeaway';
  status: OrderStatus;
  totalPrice: number;
  paymentMethod: 'counter' | 'online';
  items: OrderItem[];
  createdAt: any; // Firestore Timestamp
  updatedAt: any;
}

export interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'staff' | 'kitchen';
  restaurantId: string;
}
