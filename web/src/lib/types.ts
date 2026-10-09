import type { FulfillmentStatus, OrderState, PaymentMethod, PaymentStatus, Platform } from '@slay/shared';

export interface User {
  id: number;
  /** Sign-in email (older accounts may still show their old username until they add one). */
  email: string;
  displayName: string;
  role: 'owner' | 'member';
}

/** The signed-in person's own account, including what they still need to add. */
export interface Profile extends Omit<User, 'email'> {
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  missing: ('email' | 'phone' | 'verify_phone')[];
}

export interface TeamMember extends User {
  /** Signed up themselves and waiting for an owner's approval. */
  pending: boolean;
  needs_email: boolean;
  has_phone: boolean;
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
  /** One of PLATFORMS; older orders may hold a legacy value such as "walk-in". */
  platform: Platform | string;
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
  /** Product types (categories) in the order, comma separated. */
  categories?: string | null;
}

export interface OrderSearchResult {
  orders: OrderSummary[];
  summary: { count: number; total: number; paid: number };
  has_more: boolean;
}

export interface OrderItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  product_name: string;
  color: string;
  /** What to show: "42", or "42, 41" when pieces differ. */
  size: string;
  /** One size per piece when they differ; null when all pieces share `size`. */
  sizes: string[] | null;
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
  platform: string;
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
  platform?: Platform;
  payment: { status?: PaymentStatus; amount?: number; method?: PaymentMethod };
  delivery_due_date?: string;
  prep_time_days?: number;
  delivery_charge?: number;
  warnings: string[];
}
