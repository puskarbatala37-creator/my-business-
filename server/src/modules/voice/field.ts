import { addDays } from '@slay/shared';
import * as L from './lexicon.js';
import { devanagariToAscii, normalizeNumbers, wordValue } from './numbers.js';
import { categorySynonyms, findAny, isNum, parseOrderSpeech, splitWords, tokenMatches, type VoiceCatalogVariant } from './parser.js';

/**
 * Voice for ONE field at a time. The person taps the mic next to a field and says just that value;
 * this turns the words into exactly what that field expects – a date, a size from the product's
 * own list, an amount, a product from the catalog… Knowing the field makes it far more reliable
 * than guessing which part of a long sentence belongs where.
 */
export const FIELD_KINDS = [
  'text', 'name', 'handle', 'phone', 'tracking', 'number', 'money', 'date', 'size',
  'platform', 'payment_status', 'payment_method', 'category', 'product', 'option',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface FieldRequest {
  kind: FieldKind;
  text: string;
  /** Allowed values for `size` (the product's sizes) or `option` (value + spoken label). */
  options?: { value: string; label: string }[];
  /** Dates: a delivery date is in the future, an order date today or in the past. */
  prefer?: 'future' | 'past';
}

export type FieldResult =
  | { ok: true; value: string | number; display: string }
  /** Several products match: the app lets the person pick between them. */
  | { ok: true; candidates: number[]; display: string }
  | { ok: false; message: string };

export interface FieldContext {
  today: string;
  catalog: VoiceCatalogVariant[];
  categories: { id: number; name: string; voice_aliases: string }[];
}

const fail = (message: string): FieldResult => ({ ok: false, message });
const clean = (s: string) => s.replace(/[.!?।]+$/g, '').trim();

export function interpretField(req: FieldRequest, ctx: FieldContext): FieldResult {
  const raw = clean(req.text);
  if (!raw) return fail('Didn’t hear anything. Tap the mic and speak again.');
  switch (req.kind) {
    case 'text':
      return { ok: true, value: raw, display: raw };
    case 'name': {
      // Latin names get capital letters ("sita sharma" → "Sita Sharma"); Nepali script stays as heard.
      const v = raw.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      return { ok: true, value: v, display: v };
    }
    case 'handle': {
      const v = raw
        .toLowerCase()
        .replace(/\b(at the rate|at)\b/g, '@')
        .replace(/\bunderscore\b/g, '_')
        .replace(/\bdot\b/g, '.')
        .replace(/\s+/g, '');
      return { ok: true, value: v, display: v };
    }
    case 'phone':
      return phone(raw);
    case 'tracking':
      return tracking(raw);
    case 'number': {
      const n = firstNumber(raw);
      if (n === undefined || n < 0) return fail('Didn’t hear a number. Say just the number, e.g. “three”.');
      const v = Math.round(n);
      return { ok: true, value: v, display: String(v) };
    }
    case 'money': {
      const n = firstNumber(raw);
      if (n === undefined || n < 0) return fail('Didn’t hear an amount. Say just the amount, e.g. “two thousand five hundred”.');
      return { ok: true, value: n, display: `Rs ${n.toLocaleString('en-IN')}` };
    }
    case 'date':
      return date(raw, ctx.today, req.prefer ?? 'future');
    case 'size':
      return size(raw, req.options ?? []);
    case 'platform':
      return choose(raw, L.PLATFORM_WORDS, { tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp' }, 'Say TikTok, Facebook, Instagram or WhatsApp.');
    case 'payment_status': {
      // "not paid" contains "paid": check cash-on-delivery first.
      const words = { unpaid: L.PAYMENT.cod, partial: L.PAYMENT.partial, paid: [...L.PAYMENT.paid, 'full', 'फुल', 'पूरा', 'पुरा', 'pura'] };
      return choose(raw, words, { unpaid: 'COD (pays on delivery)', partial: 'Partial', paid: 'Paid in full' }, 'Say “paid”, “partial” or “cash on delivery”.');
    }
    case 'payment_method':
      return choose(raw, L.METHODS, { esewa: 'eSewa', khalti: 'Khalti', bank: 'Bank / QR', cash: 'Cash' }, 'Say cash, eSewa, Khalti or bank.');
    case 'category': {
      const words: Record<string, string[]> = {};
      const labels: Record<string, string> = {};
      for (const c of ctx.categories) {
        words[String(c.id)] = [...categorySynonyms(c.name), ...c.voice_aliases.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)];
        labels[String(c.id)] = c.name;
      }
      const r = choose(raw, words, labels, `Say one of: ${ctx.categories.map((c) => c.name).join(', ')}.`);
      return r.ok && 'value' in r ? { ...r, value: Number(r.value) } : r;
    }
    case 'option': {
      const opts = req.options ?? [];
      const words = Object.fromEntries(opts.map((o) => [o.value, [o.label, o.value]]));
      const labels = Object.fromEntries(opts.map((o) => [o.value, o.label]));
      return choose(raw, words, labels, `Say one of: ${opts.map((o) => o.label).join(', ')}.`);
    }
    case 'product':
      return product(raw, ctx);
  }
}

// ── Numbers ───────────────────────────────────────────────────────────────

/** Ordinals and the words that are numbers only in a number field ("छ" = six, also "is"). */
const ORDINALS: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
  eleventh: '11', twelfth: '12', thirteenth: '13', fourteenth: '14', fifteenth: '15', sixteenth: '16', seventeenth: '17',
  eighteenth: '18', nineteenth: '19', twentieth: '20', thirtieth: '30',
};
const BARE: Record<string, number> = { छ: 6, नौ: 9, chha: 6, nau: 9, tin: 3, char: 4, sat: 7, ek: 1, a: 1, an: 1 };

function numberTokens(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
    .replace(/\b(twenty|thirty)[\s-]+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, tens, o) => String((tens === 'twenty' ? 20 : 30) + Number(ORDINALS[o])))
    .replace(new RegExp(`\\b(${Object.keys(ORDINALS).join('|')})\\b`, 'g'), (o) => ORDINALS[o]);
  return normalizeNumbers(t).split(/\s+/).filter(Boolean);
}

function firstNumber(text: string): number | undefined {
  const tokens = numberTokens(text);
  const n = tokens.find((t) => isNum(t));
  if (n !== undefined) return Number(n);
  for (const t of tokens) if (BARE[t] !== undefined) return BARE[t];
  return undefined;
}

// ── Phone & tracking numbers: digit by digit ──────────────────────────────

const DIGITS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  शून्य: '0', सुन्ना: '0', एक: '1', दुई: '2', तीन: '3', तिन: '3', चार: '4', पाँच: '5', पाच: '5', छ: '6', सात: '7', आठ: '8', नौ: '9',
};

function spokenDigits(text: string): string[] {
  const words = devanagariToAscii(text.toLowerCase()).replace(/[-–,.]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const times = w === 'double' || w === 'डबल' ? 2 : w === 'triple' || w === 'ट्रिपल' ? 3 : 1;
    const target = times > 1 ? words[++i] ?? '' : w;
    const d = /^\d+$/.test(target) ? target : DIGITS[target] ?? (wordValue(target) !== undefined && wordValue(target)! < 10 ? String(wordValue(target)) : undefined);
    if (d !== undefined) out.push(d.repeat(times));
    else out.push(target);
  }
  return out;
}

function phone(text: string): FieldResult {
  let digits = spokenDigits(text).join('').replace(/\D/g, '');
  if (!digits) {
    // "nine thousand eight hundred…" style – fall back to normal number reading.
    digits = numberTokens(text).filter(isNum).join('');
  }
  digits = digits.replace(/^(00977|977)(?=9\d{9}$)/, '');
  if (!digits) return fail('Didn’t hear a phone number. Say the digits one by one, e.g. “nine eight four one…”.');
  if (digits.length !== 10) return { ok: true, value: digits, display: `${digits} – that’s ${digits.length} digits, please check` };
  return { ok: true, value: digits, display: digits };
}

function tracking(text: string): FieldResult {
  const words = spokenDigits(text.replace(/\b(tracking|number|no|code|नम्बर|ट्रयाकिङ)\b/gi, ' '));
  const v = words.join('').replace(/[^0-9a-zऀ-ॿ-]/gi, '').toUpperCase();
  if (!v) return fail('Didn’t hear a tracking number. Say the letters and digits, e.g. “N C M one two three”.');
  return { ok: true, value: v, display: v };
}

// ── Dates ─────────────────────────────────────────────────────────────────

const MONTHS: [number, string[]][] = [
  [1, ['january', 'jan', 'जनवरी', 'जनुअरी', 'जनावरी']],
  [2, ['february', 'feb', 'फेब्रुअरी', 'फेब्रुवरी', 'फेब्रवरी']],
  [3, ['march', 'mar', 'मार्च']],
  [4, ['april', 'apr', 'अप्रिल', 'एप्रिल', 'अप्रैल']],
  [5, ['may', 'मे', 'मई']],
  [6, ['june', 'jun', 'जुन', 'जून']],
  [7, ['july', 'jul', 'जुलाई', 'जुलाइ']],
  [8, ['august', 'aug', 'अगस्ट', 'अगष्ट', 'अगस्त']],
  [9, ['september', 'sept', 'sep', 'सेप्टेम्बर', 'सेप्टेम्बर', 'सेप्टेंबर', 'सितम्बर']],
  [10, ['october', 'oct', 'अक्टोबर', 'अक्टुबर', 'अक्टूबर', 'अक्तुबर']],
  [11, ['november', 'nov', 'नोभेम्बर', 'नोवेम्बर', 'नवम्बर']],
  [12, ['december', 'dec', 'डिसेम्बर', 'दिसम्बर', 'डिसेंबर']],
];
/** Nepali (Bikram Sambat) months – recognised so we can say plainly that Slay uses English dates. */
const BS_MONTHS = ['बैशाख', 'वैशाख', 'जेठ', 'असार', 'आषाढ', 'साउन', 'श्रावण', 'भदौ', 'असोज', 'आश्विन', 'कात्तिक', 'कार्तिक', 'मंसिर', 'मङ्सिर', 'पुस', 'पौष', 'माघ', 'फागुन', 'फाल्गुन', 'चैत', 'चैत्र', 'baisakh', 'jestha', 'asar', 'shrawan', 'bhadra', 'asoj', 'kartik', 'mangsir', 'poush', 'magh', 'falgun', 'chaitra', 'गते', 'gate'];
const PAST_DAYS: Record<string, number> = { हिजो: -1, yesterday: -1, hijo: -1, अस्ति: -2, asti: -2 };

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDay = (y: number, m: number, d: number) => d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const nice = (isoDate: string) => new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function date(text: string, today: string, prefer: 'future' | 'past'): FieldResult {
  const lowerText = text.toLowerCase();
  const tokens = numberTokens(text);
  const done = (d: string): FieldResult => ({ ok: true, value: d, display: nice(d) });

  for (const [w, offset] of Object.entries({ ...L.RELATIVE_DAYS, ...PAST_DAYS })) {
    if (findAny(tokens, [w])) return done(addDays(today, offset));
  }
  // "in 3 days" / "३ दिनमा" / "a week"
  const dayIdx = tokens.findIndex((t, i) => isNum(tokens[i - 1]) && L.DAY_WORDS.some((w) => tokenMatches(t, w, true)));
  if (dayIdx > 0) return done(addDays(today, (prefer === 'past' ? -1 : 1) * Number(tokens[dayIdx - 1])));
  const weekIdx = tokens.findIndex((t) => L.WEEK_WORDS.some((w) => tokenMatches(t, w, true)));
  if (weekIdx >= 0) return done(addDays(today, (prefer === 'past' ? -7 : 7) * (isNum(tokens[weekIdx - 1]) ? Number(tokens[weekIdx - 1]) : 1)));

  if (BS_MONTHS.some((m) => tokens.some((t) => tokenMatches(t, m, true)))) {
    return fail('Slay uses English dates. Say it like “October 10” or “अक्टोबर १०”.');
  }

  const [ty, tm, td] = today.split('-').map(Number);
  const month = MONTHS.find(([, names]) => names.some((n) => tokens.some((t) => t === n || tokenMatches(t, n, true))))?.[0];
  const nums = tokens.filter(isNum).map(Number);
  const year = nums.find((n) => n >= 2000 && n <= 2100);
  const day = nums.find((n) => n >= 1 && n <= 31);

  if (month && day) {
    let y = year ?? ty;
    if (!year) {
      const candidate = iso(y, month, day);
      if (prefer === 'future' && candidate < today) y++;
      if (prefer === 'past' && candidate > today) y--;
    }
    if (!validDay(y, month, day)) return fail(`${MONTHS[month - 1][1][0].replace(/^./, (c) => c.toUpperCase())} doesn’t have ${day} days. Say the date again.`);
    return done(iso(y, month, day));
  }

  // Weekday: the next one for a delivery date, the last one for an order date.
  for (const [w, dow] of Object.entries(L.WEEKDAYS)) {
    if (tokens.some((t) => tokenMatches(t, w, true))) {
      const todayDow = new Date(today + 'T00:00:00Z').getUTCDay();
      const ahead = (dow - todayDow + 7) % 7 || 7;
      return done(addDays(today, prefer === 'past' ? ahead - 7 : ahead));
    }
  }

  // Only a day number ("the 15th"): this month, or the next/previous one if that day has passed/not come.
  if (day && !month && nums.length === 1 && !/\d{4}/.test(lowerText)) {
    let y = ty;
    let m = tm;
    if (prefer === 'future' && day < td) m++;
    if (prefer === 'past' && day > td) m--;
    if (m === 13) (m = 1), y++;
    if (m === 0) (m = 12), y--;
    if (validDay(y, m, day)) return done(iso(y, m, day));
  }
  return fail('Didn’t catch a date. Say it like “October 10”, “tomorrow” or “भोलि”.');
}

// ── Size, choices, product ────────────────────────────────────────────────

function size(text: string, options: { value: string; label: string }[]): FieldResult {
  const tokens = numberTokens(text).filter((t) => !L.SIZE_WORDS.some((w) => tokenMatches(t, w, true)));
  const joined = tokens.join(' ');
  const spoken = L.SIZES[joined] ?? L.SIZES[joined.replace(/\s+/g, '')] ?? (joined === 'extra large' ? 'XL' : joined === 'extra small' ? 'XS' : joined === 'double xl' || joined === 'double extra large' ? 'XXL' : undefined);
  const num = tokens.find(isNum);
  const guess = spoken ?? num ?? joined.toUpperCase();
  if (!options.length) return guess ? { ok: true, value: guess, display: guess } : fail('Didn’t catch a size. Say it like “42” or “medium”.');
  const hit = options.find((o) => [o.value, o.label].some((x) => x.toLowerCase() === guess.toLowerCase()));
  if (hit) return { ok: true, value: hit.value, display: hit.label };
  return fail(`This product comes in ${options.map((o) => o.label).join(', ')}. Say one of those.`);
}

function choose(text: string, words: Record<string, string[]>, labels: Record<string, string>, help: string): FieldResult {
  const tokens = splitWords(text);
  let best: { key: string; index: number; length: number } | null = null;
  for (const [key, list] of Object.entries(words)) {
    const hit = findAny(tokens, list);
    // Prefer the longest phrase heard (so "not paid" beats "paid").
    if (hit && (!best || hit.length > best.length)) best = { key, ...hit };
  }
  if (!best) return fail(`Didn’t catch that. ${help}`);
  return { ok: true, value: best.key, display: labels[best.key] ?? best.key };
}

function product(text: string, ctx: FieldContext): FieldResult {
  const draft = parseOrderSpeech(text, ctx.catalog, ctx.today);
  const item = draft.items[0];
  const byId = new Map(ctx.catalog.map((v) => [v.id, v]));
  if (item?.variant_id) {
    const v = byId.get(item.variant_id)!;
    return { ok: true, value: v.id, display: `${v.product_name} – ${v.color}` };
  }
  if (item?.candidates.length) return { ok: true, candidates: item.candidates, display: `${item.candidates.length} matches – choose one` };
  return fail('Didn’t find that product. Say its name as it appears under Stock, with the colour, e.g. “black cotton kurta”.');
}
