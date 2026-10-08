import crypto from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { service } from '../src/core/context.js';
import { EsewaProvider, esewaSignature } from '../src/modules/payments/esewa.js';
import type { OnlinePaymentService } from '../src/modules/payments/service.js';
import { login, seedCatalog, setup, w } from './helpers.js';

describe('eSewa', () => {
  it('signs "field=value,..." of the signed fields with HMAC-SHA256 (base64)', () => {
    const secret = '8gBm/:&EnhH.1/q';
    const sig = esewaSignature(secret, { total_amount: '100', transaction_uuid: '11-201-13', product_code: 'EPAYTEST', extra: 'x' }, 'total_amount,transaction_uuid,product_code');
    const expected = crypto.createHmac('sha256', secret).update('total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST').digest('base64');
    expect(sig).toBe(expected);
  });

  it('verifies the callback, confirms with the status API and marks the order paid', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const order = (await teza.post('/api/orders', { platform: 'instagram', customer: { name: 'Ram', phone: '9812345678' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }], payment: { status: 'partial', amount: 500, method: 'cash' } })).body;

    const link = (await teza.post('/api/payments/requests', { order_id: order.id })).body;
    expect(link.amount).toBe(3000);
    expect(link.url).toContain('/pay/');

    const pub = (await request(s.app).get(`/api/pay/${link.token}`)).body;
    expect(pub.checkout.fields.total_amount).toBe('3000');
    expect(pub.checkout.fields.product_code).toBe('EPAYTEST');
    expect(pub.checkout.action).toContain('rc-epay.esewa.com.np');
    const uuid = pub.checkout.fields.transaction_uuid;

    // Mock eSewa's status API.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ product_code: 'EPAYTEST', transaction_uuid: uuid, total_amount: 3000, status: 'COMPLETE', ref_id: '000AE01' })));
    const payments = service<OnlinePaymentService>(s.ctx, 'onlinePayments');
    payments.register(new EsewaProvider(s.config.esewa, fetchMock as any));

    const data: Record<string, string> = { transaction_code: '000AE01', status: 'COMPLETE', total_amount: '3,000.0', transaction_uuid: uuid, product_code: 'EPAYTEST', signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names' };
    data.signature = esewaSignature(s.config.esewa.secretKey, data, data.signed_field_names);
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64');

    // Tampered data is rejected.
    const bad = Buffer.from(JSON.stringify({ ...data, total_amount: '1.0' })).toString('base64');
    const r1 = await request(s.app).get(`/api/pay/esewa/return?token=${link.token}&data=${encodeURIComponent(bad)}`);
    expect(r1.headers.location).toContain('result=failed');

    const r2 = await request(s.app).get(`/api/pay/esewa/return?token=${link.token}&data=${encodeURIComponent(encoded)}`);
    expect(r2.status).toBe(302);
    expect(r2.headers.location).toContain('result=success');
    expect(fetchMock).toHaveBeenCalledOnce();

    const after = (await teza.get(`/api/orders/${order.id}`)).body;
    expect(after.payment_status).toBe('paid');
    expect(after.payments.find((p: any) => p.method === 'esewa').provider_ref).toBe('000AE01');

    // Replaying the callback does not double-count.
    await request(s.app).get(`/api/pay/esewa/return?token=${link.token}&data=${encodeURIComponent(encoded)}`);
    expect((await teza.get(`/api/orders/${order.id}`)).body.amount_paid).toBe(3500);
  });

  it('background reconciliation completes payments whose redirect was lost', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const order = (await teza.post('/api/orders', { platform: 'instagram', customer: { name: 'Hari' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 1000 }] })).body;
    await teza.post('/api/payments/requests', { order_id: order.id });
    const payments = service<OnlinePaymentService>(s.ctx, 'onlinePayments');
    payments.register(new EsewaProvider(s.config.esewa, (async () => new Response(JSON.stringify({ status: 'COMPLETE', total_amount: 1000, ref_id: 'X1' }))) as any));
    await payments.reconcilePending();
    expect((await teza.get(`/api/orders/${order.id}`)).body.payment_status).toBe('paid');
  });
});
