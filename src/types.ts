import { OrderStatus as OrderStatusEnum } from './enums';
export type OrderStatus = OrderStatusEnum;

export interface Organization {
  id: string;
  name: string;
  max_outlets: number | string;
}

export interface WorkspaceRestaurant {
  id: string;
  name: string;
  organization_id: string;
  role?: string;
}

export interface BusinessSettings {
  country: string;
  currency: string;
  timezone: string;
  language: string;
  tax_type: string;
  tax_rate: number;
  date_format: string;
  payment_mode: "pay_first" | "pay_later" | "both";
}

export interface Restaurant {
  id: string;
  name: string;
  currency: string;
  serviceCharge: number;
  sst: number;
  franchiseId?: string;
  payment_mode?: 'pay_first' | 'pay_later' | 'both';
  show_voided_on_receipt?: boolean;
  business_settings?: BusinessSettings;
  tax_profiles?: any[];
}

export interface Table {
  id: string;
  name: string;
  status: 'available' | 'occupied';
  current_session_id?: string;
}

export interface DiningSession {
  id: string;
  restaurantId: string;
  tableId: string;
  sessionToken: string;
  status: 'active' | 'idle' | 'awaiting_payment' | 'paid' | 'closing' | 'closed' | 'expired' | 'replaced';
  session_type: 'dine_in' | 'takeaway' | 'delivery' | 'pos';
  payment_mode: 'prepaid' | 'postpaid' | 'hybrid';
  fulfillment_type: 'dine_in' | 'takeaway' | 'kiosk';
  total_amount: number;
  paid_amount: number;
  startedAt: string;
  lastActivityAt: string;
  closedAt?: string;
  tableNameSnapshot?: string;
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

export interface VisibilityFlags {
  menu_listing: boolean;
  product_configurator: boolean;
  qr_cart: boolean;
  kds: boolean;
  receipt: boolean;
}

export type DisplayBehavior = 'always' | 'only_if_changed' | 'hidden' | 'kitchen_only' | 'receipt_only' | { visible_in: VisibilityFlags };
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

export interface ComboGroupItem {
  id: string;
  groupId: string;
  childProductId: string;
  customName?: string;
  priceDelta: number;
  defaultSelected: boolean;
  displayBehavior?: DisplayBehavior;
  importance?: RenderImportance;
  sortOrder: number;
  childProduct?: Product;
}

export interface ComboGroup {
  id: string;
  productId: string;
  name: string;
  description?: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  displayBehavior?: DisplayBehavior;
  importance?: RenderImportance;
  sortOrder: number;
  items?: ComboGroupItem[];
}

export interface Modifier {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  renderImportance: RenderImportance;
  displayBehavior?: DisplayBehavior;
  sortOrder: number;
}

export interface ModifierGroup {
  id: string;
  productId?: string;
  parentModifierId?: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  displayBehavior?: DisplayBehavior;
  sortOrder: number;
  modifiers?: Modifier[];
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
  displayBehavior?: DisplayBehavior;
  comboGroups?: ComboGroup[];
  modifierGroups?: ModifierGroup[];
  groups?: ProductGroup[]; // Legacy / Shared
  options?: MenuOption[]; // Legacy
  translations?: Record<string, TranslationMapping>; // field -> { lang -> value }
}

export type MenuItem = Product;

// Selection state for the engine
export interface SelectedGroupItem {
  id: string; // The ID of the selection (combo item or modifier)
  modifierId?: string; // If it's a modifier
  comboItemId?: string; // If it's a combo item
  groupItemId?: string; // Backward compatibility
  productId?: string;   // For combos, this is the child product.
  name: string;
  priceDelta: number;
  nestedSelections?: Record<string, SelectedGroupItem[]>; // Recursive
  childProduct?: Product; // For combos
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
  id?: string; // Optional for basket items
  orderItemId?: string;
  menuItemId: string;
  name: string;
  kitchenName?: string;
  price: number;
  quantity: number;
  options: OrderItemOption[];
  selection?: ProductSelection;
  specialInstructions?: string;
  smartRenderedLines?: {
    kds?: string[];
    receipt?: string[];
    customer?: string[];
  };
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  voidApprovedBy?: string;
  status?: string;
  originalUnitPrice?: number;
  original_unit_price?: number;
  finalUnitPrice?: number;
  final_unit_price?: number;
  discount?: {
    type: 'percentage' | 'fixed' | 'override';
    value: number;
    reason?: string;
    appliedBy?: string;
  } | null;
}

export type BasketStatus = 'active' | 'locked' | 'submitted' | 'abandoned' | 'expired' | 'merged';

export interface Basket {
  id: string;
  restaurantId: string;
  sessionId: string;
  status: BasketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BasketItem {
  id: string;
  basketId: string;
  productId: string;
  quantity: number;
  configuration: ProductSelection;
  specialInstructions?: string;
  createdByDevice?: string;
  createdAt: string;
  product?: Product;
}

export interface Order {
  id: string;
  tableId: string;
  sessionId?: string;
  session_id?: string;
  tableName?: string;
  paidAmount?: number;
  orderType: 'dine_in' | 'takeaway';
  status: OrderStatus;
  totalPrice: number;
  total_price?: string | number;
  paymentMethod: 'counter' | 'online';
  items: OrderItem[];
  discount?: {
    type: 'percentage' | 'fixed';
    value: number;
    reason?: string;
    appliedBy?: string;
  } | null;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  paid_at?: string;
  confirmed_at?: string;
  restaurant_id?: string;
  table_id?: string;
  session_token?: string;
  voided?: boolean;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  voidApprovedBy?: string;
}

export type PaymentStatus = 'pending' | 'processing' | 'authorized' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';

export interface Payment {
  id: string;
  restaurant_id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_method: string;
  provider: string;
  external_id?: string;
  paid_at?: string;
  created_at: string;
}

export type CashTransactionStatus = 'calculating' | 'awaiting_confirmation' | 'confirmed' | 'completed' | 'voided';

export interface CashTransaction {
  id: string;
  payment_id: string;
  order_id: string;
  cashier_id: string;
  restaurant_id: string;
  device_id?: string;
  amount_due: number;
  cash_received: number;
  change_given: number;
  rounding_adjustment: number;
  status: CashTransactionStatus;
  created_at: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface UserProfile {
  id: string;
  email: string;
  role: 'superadmin' | 'admin' | 'staff' | 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'runner';
  restaurantId: string;
  platform_role?: string | null;
  organizationId?: string | null;
  status?: 'active' | 'suspended';
  permissions?: Record<string, boolean>;
}

export interface ModifierSelection {
  modifierId: string;
  name: string;
  priceDelta: number;
}

export interface BasketSession {
  basketId: string;
  sessionId: string;
  restaurantId: string;
  status: BasketStatus;
  basketVersion: number;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  clientSecret?: string;
  paymentMethodId?: string;
}

export interface QueueMutation {
  id: string;
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  retry_count: number;
  status: 'pending' | 'failed' | 'processing';
  created_at: number;
  priority: number;
  description?: string;
  rollback_data?: Record<string, unknown>;
}

export interface MutationJob {
  id: string;
  entity: 'order' | 'payment' | 'basket';
  operation: 'create' | 'update' | 'delete';
  payload: any;
  retries: number;
  createdAt: number;
  syncStatus: 'pending' | 'syncing' | 'failed';
}

export interface SessionEpoch {
  token: string;
  version: number;
  issued_at: number;
}

export interface WorkspaceMembership {
  id: string;
  email: string;
  role: 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'runner';
  restaurantId: string;
  status: 'active' | 'suspended';
  created_at?: string;
  user_id?: string;
}

export interface QueueJob {
  id: string;
  entity: 'order' | 'payment' | 'basket';
  operation: 'create' | 'update' | 'delete';
  payload: any;
  retries: number;
  createdAt: number;
  syncStatus: 'pending' | 'syncing' | 'failed';
}

export interface AuditLog {
  id: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entity: string;
  entityId?: string;
  timestamp: string;
  details?: Record<string, any>;
}

export interface ThermalPrinter {
  id: string;
  restaurantId: string;
  name: string;
  type: 'thermal' | 'star' | 'browser';
  interfaceType: 'network' | 'usb' | 'bluetooth' | 'browser';
  connectionAddress: string;
  status: 'online' | 'offline';
  isActive: boolean;
  createdAt: string;
}

export interface PrinterRoute {
  id: string;
  restaurantId: string;
  printerId: string;
  categoryId: string;
  createdAt: string;
}

export interface KOTItem {
  id?: string;
  name: string;
  quantity: number;
  modifiers: string[];
  specialInstructions?: string;
}

export interface KOTPayload {
  orderId: string;
  tableName: string;
  orderType: 'dine_in' | 'takeaway';
  time: string;
  date: string;
  items: KOTItem[];
  notes?: string;
  reprintCount?: number;
  reprintedBy?: string;
  reprintedAt?: string;
}

export interface PrintJob {
  id: string;
  restaurantId: string;
  orderId: string;
  printerId?: string;
  idempotencyKey: string;
  type: 'kot' | 'receipt';
  status: 'pending' | 'printed' | 'failed';
  retries: number;
  errorMessage?: string;
  payload: KOTPayload;
  reprintCount: number;
  reprintedBy?: string;
  reprintedAt?: string;
  createdAt: string;
  updatedAt: string;
}

