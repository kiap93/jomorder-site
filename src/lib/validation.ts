import { z } from 'zod';

// Helper validator schemas for runtime safety, preventing corrupted payloads:

export const LoginSchema = z.object({
  email: z.string().email({ message: "Invalid email structure" }),
  password: z.string().min(1, { message: "Password is required" })
});

export const RegisterSchema = z.object({
  email: z.string().email({ message: "Invalid email structure" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" })
});

export const ResolveSessionSchema = z.object({
  restaurantId: z.string().uuid({ message: "Restaurant ID must be a valid UUID" }),
  tableId: z.string().nullable().optional(),
  deviceInfo: z.string().nullable().optional(),
  clientToken: z.string().nullable().optional(),
  fulfillment: z.string().nullable().optional()
});

export const SyncBasketItemSchema = z.object({
  p_session_id: z.string().uuid({ message: "p_session_id must be a valid UUID" }),
  p_session_token: z.string().min(1, { message: "p_session_token is required" }),
  p_product_id: z.string().min(1, { message: "p_product_id is required" }),
  p_delta: z.number().int({ message: "p_delta must be an integer" }),
  p_configuration: z.record(z.string(), z.any()).nullable().optional(),
  p_device_info: z.string().nullable().optional()
});

export const OrderItemSchema = z.object({
  id: z.string().optional(),
  menuItemId: z.string().uuid({ message: "menuItemId must be a valid UUID" }),
  quantity: z.number().int().positive({ message: "quantity must be a positive integer" }),
  price: z.number().nonnegative({ message: "price cannot be negative" }),
  name: z.string().optional(),
  selection: z.record(z.string(), z.any()).nullable().optional(),
  notes: z.string().nullable().optional(),
  kitchenName: z.string().nullable().optional(),
  smartRenderedLines: z.object({
    kds: z.array(z.string()).optional(),
    customer: z.array(z.string()).optional(),
    receipt: z.array(z.string()).optional()
  }).optional()
});

export const PlaceOrderSchema = z.object({
  p_restaurant_id: z.string().uuid({ message: "p_restaurant_id must be a valid UUID" }),
  p_table_id: z.string().nullable().optional(),
  p_session_id: z.string().uuid({ message: "p_session_id must be a valid UUID" }).nullable().optional(),
  p_session_token: z.string().nullable().optional(),
  p_order_type: z.enum(['dine_in', 'takeaway']),
  p_items: z.array(OrderItemSchema).min(1, { message: "Order must contain at least one item" }),
  p_total_price: z.number().nonnegative({ message: "p_total_price cannot be negative" }),
  p_payment_method: z.string().optional(),
  p_idempotency_key: z.string().nullable().optional()
});

export const PaymentsSchema = z.object({
  restaurantId: z.string().uuid({ message: "restaurantId must be a valid UUID" }),
  orderId: z.string().uuid({ message: "orderId must be a valid UUID" }),
  amount: z.number().positive({ message: "amount must be a positive number" }),
  method: z.string().min(1, { message: "method is required" }),
  provider: z.string().min(1, { message: "provider is required" }),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  idempotency_key: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional()
});
