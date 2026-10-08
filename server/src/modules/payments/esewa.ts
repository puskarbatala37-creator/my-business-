import crypto from 'node:crypto';
import { money } from '@slay/shared';
import type { Config } from '../../config.js';
import { badRequest } from '../../core/http.js';
import type { CheckoutForm, PaymentProvider, PaymentRequestRow, VerifiedPayment } from './provider.js';

type FetchFn = typeof fetch;

export function esewaSignature(secret: string, fields: Record<string, string>, signedFieldNames: string): string {
  const message = signedFieldNames
    .split(',')
    .map((name) => `${name}=${fields[name] ?? ''}`)
    .join(',');
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

/** eSewa sends amounts like "1,000.0" – normalise to a number. */
const toAmount = (v: unknown) => money(Number(String(v ?? '').replace(/,/g, '')));

const fmt = (n: number) => String(money(n));

/** eSewa ePay v2 (HMAC-SHA256 signed form post + status check API). */
export class EsewaProvider implements PaymentProvider {
  name = 'esewa';

  constructor(private cfg: Config['esewa'], private fetchImpl: FetchFn = fetch) {
    if (!cfg.productCode || !cfg.secretKey) {
      console.warn('[esewa] ESEWA_PRODUCT_CODE / ESEWA_SECRET_KEY are not set – eSewa payments will fail.');
    }
  }

  checkout(req: PaymentRequestRow, urls: { success: string; failure: string }): CheckoutForm {
    const fields: Record<string, string> = {
      amount: fmt(req.amount),
      tax_amount: '0',
      total_amount: fmt(req.amount),
      transaction_uuid: req.transaction_uuid,
      product_code: this.cfg.productCode,
      product_service_charge: '0',
      product_delivery_charge: '0',
      success_url: urls.success,
      failure_url: urls.failure,
      signed_field_names: 'total_amount,transaction_uuid,product_code',
    };
    fields.signature = esewaSignature(this.cfg.secretKey, fields, fields.signed_field_names);
    return { action: this.cfg.formUrl, method: 'POST', fields };
  }

  parseCallback(query: Record<string, unknown>): VerifiedPayment {
    const encoded = String(query.data ?? '');
    if (!encoded) throw badRequest('Missing eSewa response');
    let data: Record<string, string>;
    try {
      data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      throw badRequest('Malformed eSewa response');
    }
    const signed = data.signed_field_names;
    if (!signed || !data.signature) throw badRequest('Unsigned eSewa response');
    const expected = esewaSignature(this.cfg.secretKey, data, signed);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(data.signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw badRequest('eSewa signature does not match');
    if (data.product_code !== this.cfg.productCode) throw badRequest('eSewa product code mismatch');
    return {
      transactionUuid: data.transaction_uuid,
      amount: toAmount(data.total_amount),
      status: data.status === 'COMPLETE' ? 'complete' : 'pending',
      providerRef: data.transaction_code ?? null,
      raw: data,
    };
  }

  async checkStatus(req: PaymentRequestRow): Promise<VerifiedPayment> {
    const url = new URL(this.cfg.statusUrl);
    url.searchParams.set('product_code', this.cfg.productCode);
    url.searchParams.set('total_amount', fmt(req.amount));
    url.searchParams.set('transaction_uuid', req.transaction_uuid);
    const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`eSewa status check failed: HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, any>;
    const s = String(data.status ?? '').toUpperCase();
    return {
      transactionUuid: data.transaction_uuid ?? req.transaction_uuid,
      amount: toAmount(data.total_amount ?? req.amount),
      status: s === 'COMPLETE' ? 'complete' : s === 'PENDING' || s === 'AMBIGUOUS' ? 'pending' : 'failed',
      providerRef: data.ref_id ?? null,
      raw: data,
    };
  }
}
