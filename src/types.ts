export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';

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

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  imageUrl?: string;
  description?: string;
  isActive: boolean;
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
