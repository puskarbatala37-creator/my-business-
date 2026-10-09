import { describe, expect, it } from 'vitest';
import { interpretField, type FieldContext, type FieldRequest } from '../src/modules/voice/field.js';
import type { VoiceCatalogVariant } from '../src/modules/voice/parser.js';
import { login, seedCatalog, setup, w } from './helpers.js';

const base = { voice_aliases: '', product_aliases: '', category_aliases: '' };
const catalog: VoiceCatalogVariant[] = [
  { ...base, id: 1, color: 'Red', price: 3500, stock: 5, product_id: 10, product_name: 'Banarasi Silk', category_id: 1, category_name: 'Sari' },
  { ...base, id: 2, color: 'Blue', price: 3500, stock: 5, product_id: 10, product_name: 'Banarasi Silk', category_id: 1, category_name: 'Sari' },
  { ...base, id: 5, color: 'Black', price: 1800, stock: 4, product_id: 20, product_name: 'Cotton Kurta', category_id: 2, category_name: 'Kurta' },
];
// Friday 9 October 2026
const ctx: FieldContext = { today: '2026-10-09', catalog, categories: [{ id: 1, name: 'Sari', voice_aliases: '' }, { id: 2, name: 'Kurta', voice_aliases: 'कुर्था, कुर्ता' }, { id: 3, name: 'Gown', voice_aliases: '' }] };
const f = (kind: FieldRequest['kind'], text: string, extra: Partial<FieldRequest> = {}) => interpretField({ kind, text, ...extra }, ctx);
const value = (kind: FieldRequest['kind'], text: string, extra: Partial<FieldRequest> = {}) => {
  const r = f(kind, text, extra);
  return r.ok && 'value' in r ? r.value : r;
};
const sizes = ['40', '41', '42'].map((s) => ({ value: s, label: s }));
const letterSizes = ['S', 'M', 'L', 'XL'].map((s) => ({ value: s, label: s }));

describe('voice, one field at a time', () => {
  it('dates: "October 10" fills exactly that date, in English or Nepali words', () => {
    expect(value('date', 'October 10')).toBe('2026-10-10');
    expect(value('date', 'october 10th')).toBe('2026-10-10');
    expect(value('date', '10th of October')).toBe('2026-10-10');
    expect(value('date', 'अक्टोबर १०')).toBe('2026-10-10');
    expect(value('date', 'November twenty first')).toBe('2026-11-21');
    expect(value('date', 'January 5')).toBe('2027-01-05'); // delivery dates are in the future
    expect(value('date', 'September 30', { prefer: 'past' })).toBe('2026-09-30'); // order date
    expect(value('date', 'March 3 2027')).toBe('2027-03-03');
    expect(value('date', 'tomorrow')).toBe('2026-10-10');
    expect(value('date', 'भोलि')).toBe('2026-10-10');
    expect(value('date', 'पर्सि')).toBe('2026-10-11');
    expect(value('date', 'day after tomorrow')).toBe('2026-10-11');
    expect(value('date', 'today')).toBe('2026-10-09');
    expect(value('date', 'हिजो', { prefer: 'past' })).toBe('2026-10-08');
    expect(value('date', 'in 3 days')).toBe('2026-10-12');
    expect(value('date', '३ दिनमा')).toBe('2026-10-12');
    expect(value('date', 'next week')).toBe('2026-10-16');
    expect(value('date', 'Monday')).toBe('2026-10-12');
    expect(value('date', 'शुक्रबार')).toBe('2026-10-16'); // next Friday, not today
    expect(value('date', 'Tuesday', { prefer: 'past' })).toBe('2026-10-06');
    expect(value('date', 'the 15th')).toBe('2026-10-15');
    expect(value('date', 'the 3rd')).toBe('2026-11-03');
    expect(f('date', 'असोज २४')).toMatchObject({ ok: false, message: expect.stringContaining('English dates') });
    expect(f('date', 'February 30')).toMatchObject({ ok: false });
    expect(f('date', 'banana')).toMatchObject({ ok: false });
  });

  it('size: "42" fills 42 from the product’s own sizes', () => {
    expect(value('size', '42', { options: sizes })).toBe('42');
    expect(value('size', 'size 42', { options: sizes })).toBe('42');
    expect(value('size', 'forty two', { options: sizes })).toBe('42');
    expect(value('size', 'बयालीस', { options: sizes })).toBe('42');
    expect(value('size', '४१', { options: sizes })).toBe('41');
    expect(value('size', 'medium', { options: letterSizes })).toBe('M');
    expect(value('size', 'मिडियम', { options: letterSizes })).toBe('M');
    expect(value('size', 'extra large', { options: letterSizes })).toBe('XL');
    expect(value('size', 'XL', { options: letterSizes })).toBe('XL');
    expect(f('size', '44', { options: sizes })).toMatchObject({ ok: false, message: 'This product comes in 40, 41, 42. Say one of those.' });
    expect(value('size', 'free size')).toBe('Free');
  });

  it('product: a product name picks that product and colour from the catalog', () => {
    expect(f('product', 'black cotton kurta')).toEqual({ ok: true, value: 5, display: 'Cotton Kurta – Black' });
    expect(f('product', 'कालो कुर्ता')).toMatchObject({ ok: true, value: 5 });
    expect(f('product', 'banarasi silk blue')).toMatchObject({ ok: true, value: 2 });
    expect(f('product', 'banarasi silk')).toMatchObject({ ok: true, candidates: [1, 2] }); // which colour? → choose
    expect(f('product', 'something else entirely')).toMatchObject({ ok: false });
  });

  it('money and numbers', () => {
    expect(value('money', '2500')).toBe(2500);
    expect(value('money', 'पच्चीस सय')).toBe(2500);
    expect(value('money', 'दुई हजार पाँच सय रुपैयाँ')).toBe(2500);
    expect(value('money', 'two thousand five hundred')).toBe(2500);
    expect(value('money', 'Rs 3,500')).toBe(3500);
    expect(value('money', 'साढे तीन हजार')).toBe(3500);
    expect(value('number', 'two')).toBe(2);
    expect(value('number', 'दुई वटा')).toBe(2);
    expect(value('number', 'छ')).toBe(6); // also means "is" – in a number field it's six
    expect(value('number', 'एउटा')).toBe(1);
    expect(f('money', 'nothing')).toMatchObject({ ok: false });
  });

  it('choices: order source, payment status, payment method, category', () => {
    expect(value('platform', 'TikTok')).toBe('tiktok');
    expect(value('platform', 'इन्स्टाग्राम बाट')).toBe('instagram');
    expect(value('platform', 'whats app')).toBe('whatsapp');
    expect(value('payment_status', 'cash on delivery')).toBe('unpaid');
    expect(value('payment_status', 'not paid yet')).toBe('unpaid');
    expect(value('payment_status', 'तिरेको छैन')).toBe('unpaid');
    expect(value('payment_status', 'paid')).toBe('paid');
    expect(value('payment_status', 'फुल पेड')).toBe('paid');
    expect(value('payment_status', 'advance')).toBe('partial');
    expect(value('payment_status', 'आधा')).toBe('partial');
    expect(value('payment_method', 'इसेवा')).toBe('esewa');
    expect(value('payment_method', 'cash')).toBe('cash');
    expect(value('category', 'kurta')).toBe(2);
    expect(value('category', 'कुर्ता')).toBe(2);
    expect(value('category', 'saree')).toBe(1);
    expect(value('category', 'gown')).toBe(3);
  });

  it('phone and tracking numbers, digit by digit', () => {
    expect(value('phone', 'nine eight five one zero nine eight seven six five')).toBe('9851098765');
    expect(value('phone', '९८५१०९८७६५')).toBe('9851098765');
    expect(value('phone', '985 109 8765')).toBe('9851098765');
    expect(value('phone', 'nine eight four one double zero one two three four')).toBe('9841001234');
    expect(value('phone', 'नौ आठ चार एक शून्य शून्य एक दुई तीन चार')).toBe('9841001234');
    expect(f('phone', 'nine eight four one')).toMatchObject({ ok: true, value: '9841', display: expect.stringContaining('4 digits') });
    expect(value('tracking', 'N C M one two three four five')).toBe('NCM12345');
    expect(value('tracking', 'ncm 12345')).toBe('NCM12345');
  });

  it('text fields keep the words as said', () => {
    expect(value('name', 'sita sharma')).toBe('Sita Sharma');
    expect(value('name', 'सीता शर्मा')).toBe('सीता शर्मा');
    expect(value('text', 'Baneshwor, Kathmandu.')).toBe('Baneshwor, Kathmandu');
    expect(value('handle', 'sita underscore sharma')).toBe('sita_sharma');
  });

  it('is available to the app at /api/voice/field', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    await seedCatalog(teza);
    expect((await teza.post('/api/voice/field', { kind: 'product', text: 'red banarasi silk' })).body).toMatchObject({ ok: true, display: 'Banarasi Silk – Red' });
    expect((await teza.post('/api/voice/field', { kind: 'category', text: 'साडी' })).body).toMatchObject({ ok: true, display: 'Sari' });
    expect((await teza.post('/api/voice/field', { kind: 'nonsense', text: 'x' })).status).toBe(400);
  });
});
