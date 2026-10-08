/** Nepali / English number handling for voice transcripts. */

const DEV_DIGITS = '०१२३४५६७८९';

export function devanagariToAscii(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
}

// Nepali has a distinct word for every number 1–99. Common spelling variants included.
const NE_WORDS: Record<string, number> = {
  शून्य: 0, सुन्य: 0,
  एक: 1, एउटा: 1, एटा: 1, दुई: 2, दुइ: 2, दुईटा: 2, तीन: 3, तिन: 3, तीनटा: 3, चार: 4, चारटा: 4, पाँच: 5, पाच: 5, पाँचटा: 5,
  छ: 6, छवटा: 6, सात: 7, आठ: 8, नौ: 9, दश: 10, दस: 10,
  एघार: 11, बाह्र: 12, बाहृ: 12, तेह्र: 13, चौध: 14, पन्ध्र: 15, सोह्र: 16, सत्र: 17, अठार: 18, अठाह्र: 18, उन्नाइस: 19, उन्नाईस: 19,
  बीस: 20, बिस: 20, एक्काइस: 21, बाइस: 22, तेइस: 23, चौबीस: 24, चौबिस: 24, पच्चीस: 25, पच्चिस: 25, छब्बीस: 26, सत्ताइस: 27, अट्ठाइस: 28, उनन्तीस: 29,
  तीस: 30, तिस: 30, एकतीस: 31, बत्तीस: 32, तेत्तीस: 33, चौंतीस: 34, पैंतीस: 35, पैतिस: 35, छत्तीस: 36, सैंतीस: 37, अठतीस: 38, अड्तीस: 38, उनन्चालीस: 39,
  चालीस: 40, चालिस: 40, एकचालीस: 41, बयालीस: 42, त्रिचालीस: 43, चवालीस: 44, पैंतालीस: 45, पैतालिस: 45, छयालीस: 46, सतचालीस: 47, अठचालीस: 48, उनन्चास: 49,
  पचास: 50, एकाउन्न: 51, बाउन्न: 52, त्रिपन्न: 53, चउन्न: 54, पचपन्न: 55, छपन्न: 56, सन्ताउन्न: 57, अन्ठाउन्न: 58, उनसाठी: 59, उनन्साठी: 59,
  साठी: 60, साठ्ठी: 60, एकसट्ठी: 61, बयसट्ठी: 62, त्रिसट्ठी: 63, चौंसट्ठी: 64, पैंसट्ठी: 65, छयसट्ठी: 66, सतसट्ठी: 67, अठसट्ठी: 68, उनन्सत्तरी: 69,
  सत्तरी: 70, एकहत्तर: 71, बहत्तर: 72, त्रिहत्तर: 73, चौहत्तर: 74, पचहत्तर: 75, छयहत्तर: 76, सतहत्तर: 77, अठहत्तर: 78, उनासी: 79,
  असी: 80, एकासी: 81, बयासी: 82, त्रियासी: 83, चौरासी: 84, पचासी: 85, छयासी: 86, सतासी: 87, अठासी: 88, उनान्नब्बे: 89,
  नब्बे: 90, एकान्नब्बे: 91, बयान्नब्बे: 92, त्रियान्नब्बे: 93, चौरान्नब्बे: 94, पन्चानब्बे: 95, छयान्नब्बे: 96, सन्तान्नब्बे: 97, अन्ठान्नब्बे: 98, उनान्सय: 99,
  डेढ: 1.5, अढाई: 2.5, साढे: 0.5,
  // English said in Nepali script
  वान: 1, टु: 2, थ्री: 3, फोर: 4, फाइभ: 5, सिक्स: 6, सेभेन: 7, एट: 8, नाइन: 9, टेन: 10,
};

/** Romanised Nepali numbers (from an English recogniser hearing Nepali). */
const ROMAN_NE: Record<string, number> = {
  ek: 1, euta: 1, dui: 2, duita: 2, tin: 3, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chha: 6, saat: 7, sat: 7, aath: 8, nau: 9, das: 10, dus: 10,
  bis: 20, pachis: 25, tis: 30, chalis: 40, pachas: 50, sathi: 60, sattari: 70, asi: 80, nabbe: 90,
  dedh: 1.5, dhedh: 1.5, adhai: 2.5,
};

const EN_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1, an: 1,
};

const MULTIPLIERS: Record<string, number> = {
  सय: 100, सये: 100, hundred: 100, saya: 100, say: 100, हन्ड्रेड: 100,
  हजार: 1000, thousand: 1000, k: 1000, hajar: 1000, hazar: 1000, hajaar: 1000, थाउजेन्ड: 1000,
  लाख: 100000, lakh: 100000, lac: 100000,
};

export const COUNTER_WORDS = ['वटा', 'ओटा', 'थान', 'पिस', 'पीस', 'pcs', 'pc', 'piece', 'pieces', 'ota', 'wota', 'vata', 'wata', 'ta', 'than', 'thaan', 'पिसेज'];

/** Words that are numbers only when followed by a counter/multiplier ("छ" also means "is"). */
const AMBIGUOUS = new Set(['छ', 'a', 'an', 'नौ', 'chha', 'tin', 'sat', 'say', 'char', 'ek', 'टु', 'एट']);

function wordValue(tok: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  return NE_WORDS[tok] ?? EN_WORDS[tok.toLowerCase()] ?? ROMAN_NE[tok.toLowerCase()];
}

/**
 * Normalises a transcript: Devanagari digits → ASCII, spelled-out numbers → digits,
 * punctuation split into tokens. Examples:
 *  "दुई हजार पाँच सय" → "2500", "डेढ हजार" → "1500", "साढे तीन हजार" → "3500",
 *  "दुईवटा" → "2 वटा", "two thousand five hundred" → "2500", "5k" → "5000".
 */
export function normalizeNumbers(text: string): string {
  const pre = devanagariToAscii(text)
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[।,;!?]/g, ' , ')
    .replace(/(\d)([^\d\s.,:/-])/g, '$1 $2')
    .replace(/([^\d\s.,:/+-])(\d)/g, '$1 $2');

  const raw = pre.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const t of raw) {
    const m = t.match(/^(.+?)(वटा|ओटा|टा|थान)$/);
    if (m && wordValue(m[1]) !== undefined) tokens.push(m[1], m[2] === 'टा' ? 'वटा' : m[2]);
    else tokens.push(t);
  }

  const out: string[] = [];
  let phrase: { total: number; current: number; half: boolean; afterMult: boolean } | null = null;
  const flush = () => {
    if (!phrase) return;
    const v = phrase.total + phrase.current;
    out.push(String(Math.round(v * 100) / 100));
    phrase = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();
    const next = (tokens[i + 1] ?? '').toLowerCase();
    if (lower === 'and' && phrase) continue;
    if (tok === 'साढे') {
      flush();
      phrase = { total: 0, current: 0, half: true, afterMult: false };
      continue;
    }
    const mult = MULTIPLIERS[tok] ?? MULTIPLIERS[lower];
    if (mult && (phrase || ['हजार', 'सय', 'thousand', 'hundred', 'hajar', 'hazar', 'saya'].includes(lower))) {
      if (!phrase) phrase = { total: 0, current: 0, half: false, afterMult: false };
      if (mult >= 1000) {
        phrase.total += (phrase.current || 1) * mult;
        phrase.current = 0;
      } else {
        phrase.current = (phrase.current || 1) * mult;
      }
      phrase.afterMult = true;
      continue;
    }
    let v = wordValue(tok);
    if (v !== undefined && AMBIGUOUS.has(lower) && !(MULTIPLIERS[next] || COUNTER_WORDS.includes(next))) v = undefined;
    if (v !== undefined) {
      if (!phrase) phrase = { total: 0, current: v, half: false, afterMult: false };
      else if (phrase.half) (phrase.current = v + 0.5), (phrase.half = false);
      else if (phrase.current === 0 && phrase.afterMult) phrase.current = v;
      else if (phrase.current >= 20 && phrase.current < 100 && phrase.current % 10 === 0 && v < 10 && !/^\d/.test(tok)) phrase.current += v;
      else {
        flush();
        phrase = { total: 0, current: v, half: false, afterMult: false };
      }
      phrase.afterMult = false;
      continue;
    }
    flush();
    out.push(tok);
  }
  flush();
  return out.join(' ');
}
