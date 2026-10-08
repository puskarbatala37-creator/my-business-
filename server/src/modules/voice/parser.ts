import { addDays, money, type PaymentMethod, type PaymentStatus } from '@slay/shared';
import * as L from './lexicon.js';
import { COUNTER_WORDS, normalizeNumbers } from './numbers.js';

/** Minimal catalog view the parser needs (one row per sellable colour variant). */
export interface VoiceCatalogVariant {
  id: number;
  color: string;
  price: number;
  stock: number;
  voice_aliases: string;
  product_id: number;
  product_name: string;
  product_aliases: string;
  category_id: number;
  category_name: string;
  category_aliases: string;
}

export interface DraftItem {
  variant_id: number | null;
  label: string;
  quantity: number;
  size: string;
  unit_price: number | null;
  /** Other variants that matched equally well – the UI lets the user pick. */
  candidates: number[];
  heard: string;
}

export interface OrderDraft {
  transcript: string;
  normalized: string;
  items: DraftItem[];
  customer: { name?: string; phone?: string; address?: string };
  payment: { status?: PaymentStatus; amount?: number; method?: PaymentMethod };
  delivery_due_date?: string;
  prep_time_days?: number;
  delivery_charge?: number;
  warnings: string[];
}

type MatchKind = 'product' | 'category' | 'color';
interface Match {
  start: number;
  end: number; // exclusive
  kind: MatchKind;
  variantIds: Set<number>;
}

const isNum = (t: string | undefined) => !!t && /^\d+(\.\d+)?$/.test(t);
const lower = (s: string) => s.toLowerCase().trim();
const splitWords = (s: string) => normalizeNumbers(lower(s)).split(/\s+/).filter(Boolean);
const aliasList = (s: string) => s.split(/[,;\n]/).map((x) => lower(x)).filter(Boolean);
const isDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

/** Token equality that tolerates Nepali suffixes: "साडीको", "रातोमा", "साडीहरू". */
function tokenMatches(token: string, term: string, last: boolean) {
  if (token === term) return true;
  if (last && isDevanagari(term) && term.length >= 2 && token.startsWith(term) && token.length - term.length <= 4) return true;
  if (last && !isDevanagari(term) && term.length >= 4 && (token === term + 's' || token === term + 'es')) return true;
  return false;
}

function findPhrase(tokens: string[], phrase: string[], from = 0): number {
  outer: for (let i = from; i <= tokens.length - phrase.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (!tokenMatches(tokens[i + j], phrase[j], j === phrase.length - 1)) continue outer;
    }
    return i;
  }
  return -1;
}

function findAny(tokens: string[], phrases: string[]): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const p of phrases) {
    const words = splitWords(p);
    if (!words.length) continue;
    const i = findPhrase(tokens, words);
    if (i >= 0 && (!best || i < best.index || (i === best.index && words.length > best.length))) best = { index: i, length: words.length };
  }
  return best;
}

export function colorSynonyms(color: string): string[] {
  const c = lower(color);
  const out = new Set<string>([c]);
  for (const [key, words] of Object.entries(L.COLOR_WORDS)) {
    if (key === c || words.includes(c)) words.forEach((w) => out.add(w)), out.add(key);
  }
  // "dark green" → "गाढा हरियो"
  const parts = c.split(/\s+/);
  if (parts.length === 2 && L.COLOR_MODIFIERS[parts[0]] && L.COLOR_WORDS[parts[1]]) {
    for (const m of L.COLOR_MODIFIERS[parts[0]]) for (const w of L.COLOR_WORDS[parts[1]]) out.add(`${m} ${w}`);
  }
  return [...out];
}

export function categorySynonyms(name: string): string[] {
  const n = lower(name);
  const out = new Set<string>([n]);
  for (const [key, words] of Object.entries(L.CATEGORY_WORDS)) {
    if (key === n || words.includes(n) || n === key + 's') words.forEach((w) => out.add(w)), out.add(key);
  }
  return [...out];
}

function productTerms(v: VoiceCatalogVariant): string[] {
  const name = lower(v.product_name);
  const catWords = new Set(categorySynonyms(v.category_name));
  const words = name.split(/\s+/).filter((w) => w.length >= 4 && !catWords.has(w));
  return [name, ...words, ...aliasList(v.product_aliases)];
}

function findMatches(tokens: string[], catalog: VoiceCatalogVariant[]): Match[] {
  const raw: Match[] = [];
  const add = (kind: MatchKind, terms: string[], ids: number[]) => {
    for (const term of terms) {
      const words = splitWords(term);
      if (!words.length) continue;
      let i = findPhrase(tokens, words);
      while (i >= 0) {
        raw.push({ start: i, end: i + words.length, kind, variantIds: new Set(ids) });
        i = findPhrase(tokens, words, i + 1);
      }
    }
  };
  const byCategory = new Map<number, VoiceCatalogVariant[]>();
  const byProduct = new Map<number, VoiceCatalogVariant[]>();
  for (const v of catalog) {
    (byCategory.get(v.category_id) ?? byCategory.set(v.category_id, []).get(v.category_id)!).push(v);
    (byProduct.get(v.product_id) ?? byProduct.set(v.product_id, []).get(v.product_id)!).push(v);
    add('color', [...colorSynonyms(v.color), ...aliasList(v.voice_aliases)], [v.id]);
  }
  for (const vs of byProduct.values()) add('product', productTerms(vs[0]), vs.map((v) => v.id));
  for (const vs of byCategory.values()) add('category', [...categorySynonyms(vs[0].category_name), ...aliasList(vs[0].category_aliases)], vs.map((v) => v.id));

  // Merge identical spans of the same kind (e.g. two variants both "red"), prefer longer spans.
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const merged: Match[] = [];
  for (const m of raw) {
    const same = merged.find((x) => x.kind === m.kind && x.start === m.start && x.end === m.end);
    if (same) m.variantIds.forEach((id) => same.variantIds.add(id));
    else if (!merged.some((x) => x.kind === m.kind && m.start >= x.start && m.end <= x.end)) merged.push(m);
  }
  return merged;
}

function resolveDate(tokens: string[], today: string, used: Set<number>): string | undefined {
  // Relative words: आज / भोलि / पर्सि
  for (const [word, offset] of Object.entries(L.RELATIVE_DAYS)) {
    const words = splitWords(word);
    const i = findPhrase(tokens, words);
    if (i >= 0) {
      for (let k = 0; k < words.length; k++) used.add(i + k);
      return addDays(today, offset);
    }
  }
  for (const [word, dow] of Object.entries(L.WEEKDAYS)) {
    const i = tokens.findIndex((t) => tokenMatches(t, word, true));
    if (i >= 0) {
      used.add(i);
      const todayDow = new Date(today + 'T00:00:00Z').getUTCDay();
      let diff = (dow - todayDow + 7) % 7;
      if (diff === 0) diff = 7;
      return addDays(today, diff);
    }
  }
  return undefined;
}

/** Finds "N दिन" / "N हप्ता" expressions → number of days. */
function durations(tokens: string[]) {
  const out: { index: number; days: number }[] = [];
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    if (!isNum(t) || !next) return;
    if (L.DAY_WORDS.some((w) => tokenMatches(next, w, true))) out.push({ index: i, days: Number(t) });
    else if (L.WEEK_WORDS.some((w) => tokenMatches(next, w, true))) out.push({ index: i, days: Number(t) * 7 });
  });
  // bare "हप्ता" = one week
  tokens.forEach((t, i) => {
    if (!isNum(tokens[i - 1]) && L.WEEK_WORDS.some((w) => tokenMatches(t, w, true))) out.push({ index: i, days: 7 });
  });
  return out;
}

const near = (tokens: string[], i: number, words: string[], before = 3, after = 3) => {
  for (let k = Math.max(0, i - before); k <= Math.min(tokens.length - 1, i + after); k++) {
    if (k === i) continue;
    if (words.some((w) => tokenMatches(tokens[k], w, true))) return true;
  }
  return false;
};

/**
 * Turns a spoken order (Nepali, English or mixed) into a draft order. The draft is
 * always shown to the user to confirm before saving – the parser never saves anything.
 */
export function parseOrderSpeech(transcript: string, catalog: VoiceCatalogVariant[], today: string): OrderDraft {
  const normalized = normalizeNumbers(lower(transcript));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const used = new Set<number>();
  const draft: OrderDraft = { transcript, normalized, items: [], customer: {}, payment: {}, warnings: [] };
  const joined = ' ' + tokens.join(' ') + ' ';

  // ── Phone number ──
  tokens.forEach((t, i) => {
    if (/^(\+?977)?9[678]\d{8}$/.test(t)) {
      draft.customer.phone = t.replace(/^\+?977/, '');
      used.add(i);
    }
  });

  // ── Customer name / address ("नाम सीता शर्मा", "address Baneshwor") ──
  const stop = new Set([...L.SEPARATORS, ...L.ADDRESS_WORDS, ...L.NAME_WORDS, 'फोन', 'phone', 'नम्बर', 'number', 'हो', 'is']);
  const grab = (keywords: string[], max: number) => {
    const hit = findAny(tokens, keywords);
    if (!hit) return undefined;
    let i = hit.index + hit.length;
    if (tokens[i] === 'is' || tokens[i] === 'हो') i++;
    const words: string[] = [];
    while (i < tokens.length && words.length < max && !stop.has(tokens[i]) && !isNum(tokens[i])) {
      used.add(i);
      words.push(tokens[i++]);
    }
    for (let k = hit.index; k < hit.index + hit.length; k++) used.add(k);
    return words.length ? words.join(' ') : undefined;
  };
  const name = grab(L.NAME_WORDS, 3);
  if (name) draft.customer.name = name.replace(/(को|लाई)$/, '').replace(/\b\w/g, (c) => c.toUpperCase());
  const address = grab(L.ADDRESS_WORDS, 4);
  if (address) draft.customer.address = address.replace(/\b\w/g, (c) => c.toUpperCase());

  // ── Delivery charge ──
  const dc = findAny(tokens, L.DELIVERY_CHARGE_WORDS);
  if (dc) {
    for (let k = dc.index; k < Math.min(tokens.length, dc.index + dc.length + 4); k++) {
      if (isNum(tokens[k])) {
        draft.delivery_charge = Number(tokens[k]);
        used.add(k);
        break;
      }
    }
    for (let k = dc.index; k < dc.index + dc.length; k++) used.add(k);
  }

  // ── Preparation time & delivery due date ──
  for (const d of durations(tokens)) {
    if (used.has(d.index)) continue;
    if (near(tokens, d.index, L.PREP_WORDS, 3, 4)) {
      draft.prep_time_days = d.days;
      used.add(d.index);
    } else if (near(tokens, d.index, L.DELIVERY_WORDS, 3, 4) || draft.delivery_due_date === undefined) {
      if (!near(tokens, d.index, L.PREP_WORDS, 3, 4)) {
        draft.delivery_due_date = addDays(today, d.days);
        used.add(d.index);
      }
    }
  }
  if (!draft.delivery_due_date) draft.delivery_due_date = resolveDate(tokens, today, used);

  // ── Payment status / amount / method ──
  for (const [method, words] of Object.entries(L.METHODS)) {
    if (method === 'cash' && /cash on delivery|क्यास अन डेलि/.test(joined)) continue;
    if (findAny(tokens, words)) {
      draft.payment.method = method as PaymentMethod;
      break;
    }
  }
  const amountNear = (hitIndex: number, len: number) => {
    // Prefer a number right after the keyword, then right before it.
    // Nepali puts the verb last ("२००० तिर्यो"), English puts it first ("paid 2000").
    const verbLast = isDevanagari(tokens[hitIndex] ?? '');
    const order = verbLast
      ? [hitIndex - 1, hitIndex + len, hitIndex - 2, hitIndex + len + 1]
      : [hitIndex + len, hitIndex - 1, hitIndex + len + 1, hitIndex - 2];
    for (const k of order) {
      if (isNum(tokens[k]) && !used.has(k) && Number(tokens[k]) > 0) {
        used.add(k);
        return Number(tokens[k]);
      }
    }
    return undefined;
  };
  const cod = findAny(tokens, L.PAYMENT.cod);
  const partial = findAny(tokens, L.PAYMENT.partial);
  const paid = findAny(tokens, L.PAYMENT.paid);
  const remaining = findAny(tokens, L.PAYMENT.remaining);
  if (partial) {
    draft.payment.status = 'partial';
    draft.payment.amount = amountNear(partial.index, partial.length);
  } else if (cod) {
    draft.payment.status = 'unpaid';
  } else if (paid) {
    const amount = amountNear(paid.index, paid.length);
    if (remaining && amount !== undefined) {
      // "1000 तिर्यो 2000 बाँकी" → partial
      draft.payment.status = 'partial';
      draft.payment.amount = amount;
      amountNear(remaining.index, remaining.length);
    } else {
      draft.payment.status = 'paid';
      if (amount !== undefined) draft.payment.amount = amount;
    }
  }

  // ── Items ──
  const matches = findMatches(tokens, catalog).filter((m) => !used.has(m.start));
  // Segments: split on separators, and start a new segment when a 2nd colour appears.
  const segments: { start: number; end: number; matches: Match[] }[] = [];
  let cur = { start: 0, end: 0, matches: [] as Match[] };
  const sepAt = (i: number) => L.SEPARATORS.includes(tokens[i]);
  const matchStarting = (i: number) => matches.filter((m) => m.start === i);
  for (let i = 0; i < tokens.length; i++) {
    const starting = matchStarting(i);
    const startsColor = starting.some((m) => m.kind === 'color');
    if (sepAt(i) || (startsColor && cur.matches.some((m) => m.kind === 'color'))) {
      cur.end = i;
      segments.push(cur);
      cur = { start: sepAt(i) ? i + 1 : i, end: 0, matches: [] };
      if (sepAt(i)) continue;
    }
    cur.matches.push(...starting);
  }
  cur.end = tokens.length;
  segments.push(cur);

  const itemSegs = segments.filter((s) => s.matches.length);
  const byId = new Map(catalog.map((v) => [v.id, v]));
  const globalTotalWord = findAny(tokens, L.TOTAL_WORDS);

  itemSegs.forEach((seg, idx) => {
    const kinds = (k: MatchKind) => seg.matches.filter((m) => m.kind === k);
    let products = kinds('product');
    let categories = kinds('category');
    const colors = kinds('color');
    // "रातो र निलो साडी": the first colour borrows the product/category from a neighbour.
    if (!products.length && !categories.length) {
      const neighbour = [...itemSegs.slice(idx + 1), ...itemSegs.slice(0, idx).reverse()].find((s) => s.matches.some((m) => m.kind !== 'color'));
      if (neighbour) {
        products = neighbour.matches.filter((m) => m.kind === 'product');
        categories = neighbour.matches.filter((m) => m.kind === 'category');
      }
    }
    let pool = new Set<number>(catalog.map((v) => v.id));
    const narrow = (ms: Match[]) => {
      if (!ms.length) return;
      const ids = new Set<number>();
      ms.forEach((m) => m.variantIds.forEach((id) => ids.add(id)));
      const next = new Set([...pool].filter((id) => ids.has(id)));
      if (next.size) pool = next;
    };
    narrow(categories);
    narrow(products);
    narrow(colors);
    // A segment that only names a colour and nothing narrowed it to a product stays ambiguous.
    let candidates = [...pool].map((id) => byId.get(id)!).filter(Boolean);
    if (candidates.length > 1) {
      const inStock = candidates.filter((c) => c.stock > 0);
      if (inStock.length) candidates = inStock;
    }

    // Quantity, size and price inside this segment
    let quantity = 1;
    let quantitySet = false;
    let size = '';
    let price: number | null = null;
    let isTotal = !!globalTotalWord && itemSegs.length === 1;
    const matchTokens = new Set<number>();
    seg.matches.forEach((m) => {
      for (let k = m.start; k < m.end; k++) matchTokens.add(k);
    });
    for (let i = seg.start; i < seg.end; i++) {
      if (used.has(i) || matchTokens.has(i)) continue;
      const t = tokens[i];
      const next = tokens[i + 1];
      const prev = tokens[i - 1];
      if (L.SIZE_WORDS.some((w) => tokenMatches(t, w, true)) && next) {
        const two = `${next} ${tokens[i + 2] ?? ''}`.trim();
        size = L.SIZES[two] ?? L.SIZES[next] ?? next.toUpperCase();
        used.add(i + 1);
        continue;
      }
      if (!size && /^(xs|xl|xxl|xxxl|2xl|3xl|फ्री)$/.test(t)) {
        size = L.SIZES[t];
        continue;
      }
      if (L.TOTAL_WORDS.includes(t)) isTotal = true;
      if (!isNum(t)) continue;
      const n = Number(t);
      if (next && COUNTER_WORDS.some((w) => tokenMatches(next, w, true))) {
        if (!quantitySet) quantity = Math.max(1, Math.round(n));
        quantitySet = true;
        continue;
      }
      if (next && L.SIZE_WORDS.includes(next)) {
        size = t;
        continue;
      }
      const currencyNext = next && L.CURRENCY.some((w) => tokenMatches(next, w, true));
      const priceWordBefore = prev && (L.PRICE_WORDS.includes(prev) || ['rs', 'rs.', 'रु', 'npr'].includes(prev));
      if (currencyNext || priceWordBefore || n >= 100) {
        price = n;
        if (next && L.PER_UNIT_WORDS.includes(next)) isTotal = false;
        continue;
      }
      // A small bare number just before the item ("2 रातो साडी") is the quantity.
      if (!quantitySet && n <= 50 && Number.isInteger(n) && (matchTokens.has(i + 1) || matchTokens.has(i + 2))) {
        quantity = n;
        quantitySet = true;
      }
    }

    const chosen = candidates.length === 1 ? candidates[0] : undefined;
    const unitPrice = price !== null ? money(isTotal && quantity > 1 ? price / quantity : price) : chosen ? chosen.price : null;
    draft.items.push({
      variant_id: chosen?.id ?? null,
      label: chosen ? `${chosen.product_name} – ${chosen.color}` : candidates.length ? `${candidates.length} possible matches` : 'Unknown item',
      quantity,
      size,
      unit_price: unitPrice,
      candidates: chosen ? [] : candidates.slice(0, 12).map((c) => c.id),
      heard: tokens.slice(seg.start, seg.end).join(' '),
    });
  });

  // A single item with no price inside its own segment: use a leftover price-looking number.
  if (draft.items.length === 1 && draft.items[0].unit_price === null) {
    const k = tokens.findIndex((t, i) => !used.has(i) && isNum(t) && Number(t) >= 100);
    if (k >= 0) draft.items[0].unit_price = Number(tokens[k]);
  }

  if (!draft.items.length) draft.warnings.push('No product recognised – pick the item manually, or add "voice words" to the product.');
  if (draft.items.some((i) => !i.variant_id)) draft.warnings.push('Some items matched more than one colour/product – please choose.');
  for (const it of draft.items) {
    const v = it.variant_id ? byId.get(it.variant_id) : undefined;
    if (v && v.stock < it.quantity) draft.warnings.push(`${v.product_name} (${v.color}) has only ${v.stock} in stock.`);
  }
  return draft;
}
