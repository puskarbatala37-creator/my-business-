/**
 * Online payment gateways plug in through this interface. eSewa is the first;
 * Khalti, Fonepay etc. can be added later as more providers.
 */
export interface PaymentRequestRow {
  id: number;
  token: string;
  provider: string;
  order_id: number;
  amount: number;
  transaction_uuid: string;
  status: 'pending' | 'complete' | 'failed' | 'expired';
  created_at: string;
}

export interface CheckoutForm {
  action: string;
  method: 'POST';
  fields: Record<string, string>;
}

export interface VerifiedPayment {
  transactionUuid: string;
  amount: number;
  status: 'complete' | 'pending' | 'failed';
  providerRef: string | null;
  raw: unknown;
}

export interface PaymentProvider {
  name: string;
  checkout(req: PaymentRequestRow, urls: { success: string; failure: string }): CheckoutForm;
  /** Decode + authenticate the data the gateway sends back to our success URL. */
  parseCallback(query: Record<string, unknown>): VerifiedPayment;
  /** Ask the gateway directly for the transaction's real status (server-to-server). */
  checkStatus(req: PaymentRequestRow): Promise<VerifiedPayment>;
}
