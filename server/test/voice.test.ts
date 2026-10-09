import { describe, expect, it } from 'vitest';
import { normalizeNumbers } from '../src/modules/voice/numbers.js';
import { parseOrderSpeech, type VoiceCatalogVariant } from '../src/modules/voice/parser.js';

const base = { voice_aliases: '', product_aliases: '', category_aliases: '', category_id: 1, category_name: 'Sari' };
const catalog: VoiceCatalogVariant[] = [
  { ...base, id: 1, color: 'Red', price: 3500, stock: 5, product_id: 10, product_name: 'Banarasi Silk' },
  { ...base, id: 2, color: 'Blue', price: 3500, stock: 5, product_id: 10, product_name: 'Banarasi Silk' },
  { ...base, id: 3, color: 'Red', price: 2200, stock: 5, product_id: 11, product_name: 'Cotton Daily', product_aliases: 'सुती' },
  { ...base, id: 4, color: 'Green', price: 2200, stock: 0, product_id: 11, product_name: 'Cotton Daily', product_aliases: 'सुती' },
  { ...base, id: 5, color: 'Black', price: 1800, stock: 4, product_id: 20, product_name: 'Kurta Set', category_id: 2, category_name: 'Kurta' },
];
const TODAY = '2026-10-08'; // a Thursday

describe('number normalisation', () => {
  it.each([
    ['दुई हजार पाँच सय', '2500'],
    ['डेढ हजार', '1500'],
    ['साढे तीन हजार', '3500'],
    ['२५००', '2500'],
    ['दुईवटा', '2 वटा'],
    ['two thousand five hundred', '2500'],
    ['3,500', '3500'],
    ['5k', '5000'],
    ['यो रातो छ', 'यो रातो छ'],
    ['छ वटा', '6 वटा'],
  ])('%s → %s', (input, out) => expect(normalizeNumbers(input)).toBe(out));
});

describe('Nepali voice order parsing', () => {
  it('parses a full Nepali order', () => {
    const d = parseOrderSpeech(
      'बनारसी रातो साडी दुई वटा तीन हजार पाँच सय रुपैयाँ, एक हजार एडभान्स इसेवाबाट, भोलि डेलिभरी, तयार गर्न दुई दिन लाग्छ, नाम सीता शर्मा फोन ९८४१२३४५६७',
      catalog.map((v) => (v.product_id === 10 ? { ...v, product_aliases: 'बनारसी' } : v)),
      TODAY,
    );
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ variant_id: 1, quantity: 2, unit_price: 3500 });
    expect(d.payment).toEqual({ status: 'partial', amount: 1000, method: 'esewa' });
    expect(d.delivery_due_date).toBe('2026-10-09');
    expect(d.prep_time_days).toBe(2);
    expect(d.customer.phone).toBe('9841234567');
    expect(d.customer.name).toBe('सीता शर्मा');
  });

  it('handles COD and multiple items', () => {
    const d = parseOrderSpeech('एउटा निलो साडी र कालो कुर्था साइज M, क्यास अन डेलिभरी, पर्सि पठाउनु', catalog, TODAY);
    expect(d.items.map((i) => i.variant_id)).toEqual([2, 5]);
    expect(d.items[1].size).toBe('M');
    expect(d.payment.status).toBe('unpaid');
    expect(d.delivery_due_date).toBe('2026-10-10');
  });

  it('asks the user to choose when the colour is ambiguous and prefers in-stock', () => {
    const d = parseOrderSpeech('रातो साडी', catalog, TODAY);
    expect(d.items[0].variant_id).toBeNull();
    expect(d.items[0].candidates.sort()).toEqual([1, 3]);
    const g = parseOrderSpeech('सुती हरियो साडी', catalog, TODAY);
    expect(g.items[0].variant_id).toBe(4);
    expect(g.warnings.join(' ')).toContain('only 0');
  });

  it('understands English / mixed speech', () => {
    const d = parseOrderSpeech('2 black kurta 1800 rupees each, fully paid by khalti, delivery in 3 days', catalog, TODAY);
    expect(d.items[0]).toMatchObject({ variant_id: 5, quantity: 2, unit_price: 1800 });
    expect(d.payment).toMatchObject({ status: 'paid', method: 'khalti' });
    expect(d.delivery_due_date).toBe('2026-10-11');
  });

  it('finds the amount paid when the payment method comes between ("एक हजार इसेवा बाट तिरेको")', () => {
    const ne = parseOrderSpeech('कालो कुर्था दुई वटा, पच्चीस सय, एक हजार इसेवा बाट तिरेको, भोलि डेलिभरी', catalog, TODAY);
    expect(ne.payment).toMatchObject({ method: 'esewa', amount: 1000 });
    expect(ne.items[0]).toMatchObject({ quantity: 2, unit_price: 2500 });
    const en = parseOrderSpeech('two black kurta 2500 each, 1500 by esewa paid', catalog, TODAY);
    expect(en.payment).toMatchObject({ method: 'esewa', amount: 1500 });
    expect(en.items[0]).toMatchObject({ quantity: 2, unit_price: 2500 });
    // After a pause, "paid by eSewa" doesn't take the item's price as the payment.
    const full = parseOrderSpeech('कालो कुर्था एउटा २५००, इसेवा बाट तिरेको', catalog, TODAY);
    expect(full.payment).toMatchObject({ status: 'paid', method: 'esewa' });
    expect(full.payment.amount).toBeUndefined();
    expect(full.items[0]).toMatchObject({ unit_price: 2500 });
  });

  it('keeps the price and size with the item when there is a pause (comma) in between', () => {
    const a = parseOrderSpeech('कालो कुर्था दुई वटा, पच्चीस सय', catalog, TODAY);
    expect(a.items[0]).toMatchObject({ variant_id: 5, quantity: 2, unit_price: 2500 });
    const b = parseOrderSpeech('two black kurta size M, 2500 each, paid 2000 by eSewa', catalog, TODAY);
    expect(b.items[0]).toMatchObject({ quantity: 2, unit_price: 2500, size: 'M' });
    expect(b.payment).toMatchObject({ method: 'esewa', amount: 2000 });
    const c = parseOrderSpeech('black kurta, size M, 2500, paid by esewa', catalog, TODAY);
    expect(c.items[0]).toMatchObject({ quantity: 1, unit_price: 2500, size: 'M' });
    expect(c.payment).toMatchObject({ status: 'paid', method: 'esewa' });
    expect(c.payment.amount).toBeUndefined();
    // A part that says something else (an advance, a phone number) is not mistaken for the price.
    const d = parseOrderSpeech('black kurta, 1000 advance, 1500 baki', catalog, TODAY);
    expect(d.items[0].unit_price).toBe(1800);
    expect(d.payment).toMatchObject({ status: 'partial', amount: 1000 });
  });

  it('works out partial payment from "paid X, Y remaining"', () => {
    const d = parseOrderSpeech('कालो कुर्था २००० तिर्यो १६०० बाँकी शुक्रबार डेलिभरी', catalog, TODAY);
    expect(d.payment).toMatchObject({ status: 'partial', amount: 2000 });
    expect(d.delivery_due_date).toBe('2026-10-09');
  });
});

describe('payment amount next to the keyword', () => {
  it('does not take the item price as the advance', () => {
    const d = parseOrderSpeech('कालो कुर्था ३५०० रुपैयाँ एडभान्स १०००', catalog, TODAY);
    expect(d.payment).toMatchObject({ status: 'partial', amount: 1000 });
    expect(d.items[0].unit_price).toBe(3500);
  });
});

describe('speak in whichever language feels natural', () => {
  it('plain English', () => {
    const d = parseOrderSpeech('one blue sari 3500 rupees, advance 1000 by esewa, delivery tomorrow, takes 2 days to prepare, customer name Sita Sharma phone 9841234567', catalog, TODAY);
    expect(d.items[0]).toMatchObject({ variant_id: 2, quantity: 1, unit_price: 3500 });
    expect(d.payment).toEqual({ status: 'partial', amount: 1000, method: 'esewa' });
    expect(d.delivery_due_date).toBe('2026-10-09');
    expect(d.prep_time_days).toBe(2);
    expect(d.customer).toMatchObject({ name: 'Sita Sharma', phone: '9841234567' });
  });

  it('Nepali heard by the English recogniser (romanised)', () => {
    const d = parseOrderSpeech('dui wota nilo sadi tin hajar paanch saya, 2000 tiryo baki COD, bholi pathaune', catalog, TODAY);
    expect(d.items[0]).toMatchObject({ variant_id: 2, quantity: 2, unit_price: 3500 });
    expect(d.payment).toMatchObject({ status: 'partial', amount: 2000 });
    expect(d.delivery_due_date).toBe('2026-10-09');
  });

  it('English words inside Nepali speech (Devanagari loanwords)', () => {
    const d = parseOrderSpeech('ब्ल्याक कुर्था टु पीस, फुल पेड खल्ती, फ्राइडे डेलिभरी', catalog, TODAY);
    expect(d.items[0]).toMatchObject({ variant_id: 5, quantity: 2, unit_price: 1800 });
    expect(d.payment).toMatchObject({ status: 'paid', method: 'khalti' });
    expect(d.delivery_due_date).toBe('2026-10-09');
  });

  it('switching language half-way through one order', () => {
    const d = parseOrderSpeech('कालो कुर्था एउटा 1800 रुपैयाँ and one blue sari 3500, cash on delivery, पर्सि डेलिभरी', catalog, TODAY);
    expect(d.items.map((i) => [i.variant_id, i.unit_price])).toEqual([
      [5, 1800],
      [2, 3500],
    ]);
    expect(d.payment.status).toBe('unpaid');
    expect(d.delivery_due_date).toBe('2026-10-10');
  });
});

describe('COD phrases that contain the word "paid"', () => {
  it.each(['black kurta not paid yet', 'कालो कुर्था पैसा तिरेको छैन', 'kalo kurtha tireko chhaina'])('%s → unpaid', (t) => {
    expect(parseOrderSpeech(t, catalog, TODAY).payment.status).toBe('unpaid');
  });
  it('"paid 1000, rest cash on delivery" → partial', () => {
    expect(parseOrderSpeech('black kurta 1800, paid 1000, rest cash on delivery', catalog, TODAY).payment).toMatchObject({ status: 'partial', amount: 1000 });
  });
});

describe('order source (platform) by voice', () => {
  it.each([
    ['कालो कुर्था इन्स्टाग्रामबाट अर्डर', 'instagram'],
    ['black kurta from tiktok', 'tiktok'],
    ['व्हाट्सएपमा आएको अर्डर कालो कुर्था', 'whatsapp'],
    ['facebook messenger order, black kurta', 'facebook'],
  ])('%s → %s', (text, platform) => {
    const d = parseOrderSpeech(text, catalog, TODAY);
    expect(d.platform).toBe(platform);
    expect(d.items[0].variant_id).toBe(5);
  });
  it('a platform word is not taken as part of the customer name', () => {
    const d = parseOrderSpeech('नाम सीता शर्मा whatsapp बाट, कालो कुर्था', catalog, TODAY);
    expect(d.customer.name).toBe('सीता शर्मा');
    expect(d.platform).toBe('whatsapp');
  });
});
