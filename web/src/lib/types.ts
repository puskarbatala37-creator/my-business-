import type { FulfillmentStatus, OrderState, PaymentMethod, PaymentStatus, Platform } from '@slay/shared';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'owner' | 'member';
}

export interface TeamMember extends User {
  active: boolean;
  created_at: string;
  last_seen_at: string | null;
  passkeys: number;
}

export interface Variant {
  id: number;
  product_id: number;
  color: string;
  sku: string | null;
  stock: number;
  cost: number;
  price: number;
  photo: string | null;
  voice_aliases: string;
  archived: number;
}

export interface Product {
  id: number;
  category_id: number;
  name: string;
  description: string;
  sizes: string;
  voice_aliases: string;
  archived: number;
  variants: Variant[];
}

export interface Category {
  id: number;
  name: string;
  voice_aliases: string;
  products: Product[];
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  address: string;
  social_handle: string;
  notes: string;
  order_count?: number;
  total_spent?: number;
  balance_due?: number;
  last_order_date?: string | null;
}

export interface OrderSummary {
  id: number;
  invoice_no: string;
  order_date: string;
  platform: Platform;
  state: OrderState;
  fulfillment_status: FulfillmentStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  subtotal: number;
  delivery_charge: number;
  discount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string;
  tracking_number: string;
  delivery_due_date: string | null;
  prep_time_days: number | null;
  sent_at: string | null;
  version: number;
  customer_id: number;
  customer_name?: string;
  customer_phone?: string;
  item_count?: number;
  thumb?: string | null;
  items_summary?: string;
}

export interface OrderItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  product_name: string;
  color: string;
  size: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  photo: string | null;
  current_stock: number | null;
}

export interface Payment {
  id: number;
  amount: number;
  method: PaymentMethod;
  provider_ref: string | null;
  note: string;
  created_at: string;
  created_by_name: string | null;
}

export interface HistoryRow {
  id: number;
  invoice_no: string;
  order_date: string;
  total: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  state: OrderState;
  items_summary: string | null;
}

export interface OrderDetail extends OrderSummary {
  customer: Customer;
  items: OrderItem[];
  payments: Payment[];
  customer_history: HistoryRow[];
  created_by_name: string | null;
  created_at: string;
}

export interface Receipt {
  id: number;
  photo: string;
  captured_at: string;
  supplier: string;
  amount: number;
  category: string;
  notes: string;
  created_by_name: string | null;
}

export interface Alert {
  id: number;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  created_at: string;
  user_name: string | null;
  read: boolean;
}

export interface DraftItem {
  variant_id: number | null;
  label: string;
  quantity: number;
  size: string;
  unit_price: number | null;
  candidates: number[];
  heard: string;
}

export interface OrderDraft {
  transcript: string;
  items: DraftItem[];
  customer: { name?: string; phone?: string; address?: string };
  payment: { status?: PaymentStatus; amount?: number; method?: PaymentMethod };
  delivery_due_date?: string;
  prep_time_days?: number;
  delivery_charge?: number;
  warnings: string[];
}
