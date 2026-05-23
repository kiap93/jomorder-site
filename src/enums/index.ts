export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COOKING = 'cooking',
  READY = 'ready',
  SERVED = 'served',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export enum OrderType {
  DINE_IN = 'dine_in',
  TAKEAWAY = 'takeaway'
}

export enum PaymentMethod {
  CASH = 'cash',
  ONLINE = 'online',
  COUNTER = 'counter'
}

export enum DiningSessionStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  AWAITING_PAYMENT = 'awaiting_payment',
  PAID = 'paid',
  CLOSING = 'closing',
  CLOSED = 'closed',
  EXPIRED = 'expired',
  REPLACED = 'replaced'
}

export enum TableStatus {
  VACANT = 'vacant',
  ACTIVE = 'active',
  RESERVED = 'reserved',
  AVAILABLE = 'available',
  OCCUPIED = 'occupied'
}
