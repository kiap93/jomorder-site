export type OrderStatus = 'pending' | 'confirmed' | 'cooking' | 'ready' | 'served' | 'completed' | 'cancelled';

export interface Restaurant {
  id: string;
  name: string;
  currency: string;
  serviceCharge: number;
  sst: number;
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

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  imageUrl?: string;
  description?: string;
  isActive: boolean;
  status: MenuItemStatus;
  options?: MenuOption[];
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
}

export interface Order {
  id: string;
  tableId: string;
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
