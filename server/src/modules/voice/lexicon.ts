/**
 * Nepali vocabulary for voice entry. Extend freely – every list is plain data.
 * Shop-specific words can also be added per category/product/colour in the app
 * ("Voice words" field), without code changes.
 */

export const COLOR_WORDS: Record<string, string[]> = {
  red: ['रातो', 'राता', 'लाल', 'रेड', 'red'],
  blue: ['निलो', 'नीलो', 'नीला', 'ब्लु', 'ब्लू', 'blue'],
  'sky blue': ['आकाशे', 'आकासे', 'स्काई ब्लु', 'sky blue', 'skyblue'],
  navy: ['नेभी', 'नेवी', 'navy', 'navy blue'],
  green: ['हरियो', 'हरिया', 'ग्रीन', 'ग्रिन', 'green'],
  yellow: ['पहेंलो', 'पहेँलो', 'पहेलो', 'येलो', 'yellow'],
  black: ['कालो', 'काला', 'ब्ल्याक', 'black'],
  white: ['सेतो', 'सेता', 'ह्वाइट', 'वाइट', 'white'],
  pink: ['गुलाबी', 'पिंक', 'पिङ्क', 'pink'],
  purple: ['बैजनी', 'बैंगनी', 'पर्पल', 'purple', 'violet'],
  orange: ['सुन्तला', 'सुन्तले', 'ओरेन्ज', 'orange'],
  maroon: ['मरुन', 'मेरुन', 'maroon'],
  brown: ['खैरो', 'ब्राउन', 'brown'],
  grey: ['खरानी', 'ग्रे', 'grey', 'gray'],
  golden: ['सुनौलो', 'गोल्डेन', 'गोल्डन', 'golden', 'gold'],
  silver: ['चाँदी', 'चाँदीको', 'सिल्भर', 'silver'],
  cream: ['क्रिम', 'क्रीम', 'cream', 'off white', 'offwhite'],
  beige: ['बेज', 'beige'],
  peach: ['पीच', 'पिच', 'peach'],
  magenta: ['म्याजेन्टा', 'magenta'],
  'rani pink': ['रानी', 'रानी पिंक', 'rani', 'rani pink'],
  teal: ['टिल', 'teal'],
  mustard: ['मस्टर्ड', 'mustard'],
  wine: ['वाइन', 'wine'],
  multicolor: ['रंगीचंगी', 'मल्टिकलर', 'multicolor', 'multi'],
};

export const COLOR_MODIFIERS: Record<string, string[]> = {
  dark: ['गाढा', 'डार्क', 'dark'],
  light: ['हल्का', 'फिक्का', 'लाइट', 'light'],
};

export const CATEGORY_WORDS: Record<string, string[]> = {
  sari: ['साडी', 'सारी', 'सारि', 'साडि', 'saree', 'sari', 'sadi'],
  kurta: ['कुर्था', 'कुर्ता', 'कुर्ती', 'kurta', 'kurti', 'kurtha'],
  lehenga: ['लेहेंगा', 'लहंगा', 'लेहेङ्गा', 'lehenga'],
  blouse: ['ब्लाउज', 'blouse', 'चोलो', 'cholo'],
  shawl: ['सल', 'शल', 'shawl'],
  dupatta: ['दुपट्टा', 'dupatta'],
  dress: ['ड्रेस', 'dress', 'फ्रक', 'frock'],
  gown: ['गाउन', 'gown'],
  top: ['टप', 'top'],
  pant: ['प्यान्ट', 'pant', 'pants'],
  suit: ['सुट', 'suit'],
  jacket: ['ज्याकेट', 'jacket'],
  shirt: ['सर्ट', 'शर्ट', 'shirt'],
};

export const SEPARATORS = [',', 'र', 'अनि', 'and', 'then', 'अर्को', 'plus', 'साथै'];

export const CURRENCY = ['रुपैयाँ', 'रुपैयां', 'रुपैया', 'रूपैयाँ', 'रुपियाँ', 'रुपिया', 'रुपये', 'रु', 'रू', 'rs', 'rs.', 'npr', 'rupees', 'rupee', 'rupaiya', 'को', 'मा'];
export const PRICE_WORDS = ['मूल्य', 'मुल्य', 'दाम', 'पर्छ', 'पर्ने', 'price', 'rate', 'रेट', 'प्राइस'];
export const PER_UNIT_WORDS = ['प्रति', 'एउटाको', 'एकको', 'each', 'per', 'वटाको'];
export const TOTAL_WORDS = ['जम्मा', 'सबै', 'total', 'टोटल', 'सबैको'];

export const PAYMENT = {
  cod: ['cod', 'c.o.d', 'cash on delivery', 'क्यास अन डेलिभरी', 'क्यास अन डेलिवरी', 'डेलिभरीमा तिर्ने', 'डेलिभरीमा पैसा', 'डेलिभरी पछि तिर्ने', 'नतिरेको', 'तिर्न बाँकी', 'तिरेको छैन', 'तिरेकै छैन', 'पैसा आएको छैन', 'unpaid', 'not paid', 'पेमेन्ट बाँकी'],
  partial: ['advance', 'एडभान्स', 'एड्भान्स', 'एडवान्स', 'अग्रिम', 'बैना', 'partial', 'पार्सियल', 'आधा', 'केही तिर्यो', 'केही तिरेको'],
  paid: ['full paid', 'fully paid', 'paid', 'पेड', 'पूरा तिर्यो', 'पुरा तिर्यो', 'पूरा पैसा', 'पुरा पैसा', 'पूरै', 'पुरै', 'तिरिसक्यो', 'तिरिसकेको', 'तिर्यो', 'तिरेको', 'भुक्तानी भयो', 'पेमेन्ट भयो', 'पेमेन्ट गर्यो', 'पेमेन्ट आयो', 'पैसा आयो'],
  remaining: ['बाँकी', 'बाकी', 'remaining', 'balance', 'due'],
};

export const METHODS: Record<string, string[]> = {
  esewa: ['esewa', 'e-sewa', 'e sewa', 'इसेवा', 'ईसेवा', 'ई-सेवा', 'इ-सेवा', 'ई सेवा', 'इ सेवा'],
  khalti: ['khalti', 'खल्ती'],
  bank: ['bank', 'बैंक', 'बैङ्क', 'मोबाइल बैंकिङ', 'fonepay', 'फोनपे', 'qr', 'क्युआर'],
  cash: ['cash', 'क्यास', 'नगद', 'हातमा'],
};

export const DELIVERY_WORDS = ['डेलिभरी', 'डेलिवरी', 'डेलिभर', 'delivery', 'deliver', 'पठाउने', 'पठाउनु', 'पठाउन', 'पठाइदिनु', 'पुर्याउनु', 'पुर्याउने', 'चाहियो', 'चाहिन्छ', 'due', 'send', 'सेन्ड'];
export const PREP_WORDS = ['तयार', 'बनाउन', 'बनाउने', 'बन्न', 'सिलाउन', 'सिलाउने', 'सिलाई', 'prep', 'preparation', 'ready', 'लाग्छ', 'लाग्ने', 'make', 'stitch'];
export const DAY_WORDS = ['दिन', 'दिनमा', 'दिनभित्र', 'दिनपछि', 'day', 'days'];
export const WEEK_WORDS = ['हप्ता', 'हप्तामा', 'हप्ताभित्र', 'week', 'weeks'];
export const DELIVERY_CHARGE_WORDS = ['डेलिभरी चार्ज', 'डेलिवरी चार्ज', 'delivery charge', 'ढुवानी', 'shipping'];

export const RELATIVE_DAYS: Record<string, number> = {
  आज: 0, today: 0,
  भोलि: 1, भोली: 1, tomorrow: 1,
  पर्सि: 2, पर्सी: 2, 'day after tomorrow': 2,
};

/** JS getDay(): 0 = Sunday. */
export const WEEKDAYS: Record<string, number> = {
  आइतबार: 0, आइतवार: 0, sunday: 0,
  सोमबार: 1, सोमवार: 1, monday: 1,
  मंगलबार: 2, मङ्गलबार: 2, मंगलवार: 2, tuesday: 2,
  बुधबार: 3, बुधवार: 3, wednesday: 3,
  बिहीबार: 4, बिहिबार: 4, बिहीवार: 4, thursday: 4,
  शुक्रबार: 5, शुक्रवार: 5, friday: 5,
  शनिबार: 6, शनिवार: 6, saturday: 6,
};

export const SIZE_WORDS = ['साइज', 'size', 'साईज'];
export const SIZES: Record<string, string> = {
  xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL', '2xl': 'XXL', xxxl: 'XXXL', '3xl': 'XXXL',
  small: 'S', medium: 'M', large: 'L', free: 'Free', फ्री: 'Free', स्मल: 'S', मिडियम: 'M', लार्ज: 'L',
  एक्सएल: 'XL', 'एक्स्ट्रा लार्ज': 'XL', डबलएक्सएल: 'XXL',
};

export const NAME_WORDS = ['नाम', 'name', 'customer', 'ग्राहक', 'कस्टमर'];
export const ADDRESS_WORDS = ['ठेगाना', 'address', 'घर'];
