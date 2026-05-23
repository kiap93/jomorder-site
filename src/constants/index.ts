import { OrderStatus, OrderType, PaymentMethod, TableStatus, DiningSessionStatus } from '../enums';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'status.pending',
  [OrderStatus.CONFIRMED]: 'status.confirmed',
  [OrderStatus.COOKING]: 'status.cooking',
  [OrderStatus.READY]: 'status.ready',
  [OrderStatus.SERVED]: 'status.served',
  [OrderStatus.COMPLETED]: 'status.completed',
  [OrderStatus.CANCELLED]: 'status.cancelled',
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  [OrderType.DINE_IN]: 'menu.dineIn',
  [OrderType.TAKEAWAY]: 'menu.takeaway',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'payment.cash',
  [PaymentMethod.ONLINE]: 'payment.online',
  [PaymentMethod.COUNTER]: 'payment.cash', // default counter desk
};

export const ORDER_TYPES = [
  { value: OrderType.DINE_IN, labelKey: 'menu.dineIn' },
  { value: OrderType.TAKEAWAY, labelKey: 'menu.takeaway' },
];

export const PAYMENT_METHODS = [
  { value: PaymentMethod.CASH, labelKey: 'payment.cash' },
  { value: PaymentMethod.ONLINE, labelKey: 'payment.online' },
];
