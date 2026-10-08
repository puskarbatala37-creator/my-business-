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
