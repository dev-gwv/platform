/**
 * Hindi and Hinglish words, read as the English the help is written in.
 *
 * The help is English and retrieval matches words, so a question typed in
 * Devanagari matched nothing at all -- and the model, handed no article,
 * answered from memory anyway: "शूट के लिए क्रू कैसे बुक करें?" came back with a
 * "Book team" button and a "Confirm" step, neither of which exists. Matching
 * what a studio types to the words we wrote is what stops that.
 *
 * Most of what a studio types in Hindi about this app is the app's own English
 * written in Devanagari (क्लाइंट, कोटेशन, इनवॉइस), plus a handful of Hindi words
 * for the same things (भुगतान, वेतन, छुट्टी) and the verbs (जोड़ें, भेजें). That is
 * a short list we can write out, which is why this is a table and not a
 * translation call: one more model call per question would spend the very
 * per-minute budget the assistant is short of.
 *
 * Used for matching only. Nothing here is sent to the model.
 *
 * To add a word: put it under the English word the help uses for it. Spelling
 * variants are cheap -- nukta and chandrabindu are folded away (फ़ोटो = फोटो,
 * करूँ = करूं), so only genuinely different spellings need their own entry.
 */

/** Fold the spellings that differ only by a dot or a moon. */
export function foldHindi(w: string): string {
  return w
    .normalize('NFD')
    .replace(/़/g, '') // nukta: फ़ → फ, ड़ → ड
    .replace(/ँ/g, 'ं') // chandrabindu → anusvara: करूँ → करूं
    .normalize('NFC')
}

const DEVANAGARI = /[ऀ-ॿ]/

/** The English word the help uses, and the Hindi a studio types for it. */
const HI: Record<string, readonly string[]> = {
  // People
  team: ['टीम'],
  staff: ['स्टाफ', 'कर्मचारी', 'स्टाफ़'],
  employee: ['एम्प्लॉई', 'एम्प्लॉयी'],
  photographer: ['फोटोग्राफर'],
  editor: ['एडिटर'],
  freelancer: ['फ्रीलांसर'],
  crew: ['क्रू'],
  client: ['क्लाइंट', 'ग्राहक', 'कस्टमर'],
  lead: ['लीड', 'लीड्स'],
  enquiry: ['इन्क्वायरी', 'इंक्वायरी', 'पूछताछ', 'एंक्वायरी'],
  role: ['रोल'],
  access: ['एक्सेस', 'अनुमति', 'परमिशन'],
  login: ['लॉगिन'],
  password: ['पासवर्ड'],
  // Work
  project: ['प्रोजेक्ट'],
  shoot: ['शूट', 'शूटिंग'],
  book: ['बुक'],
  booking: ['बुकिंग'],
  edit: ['एडिट'],
  editing: ['एडिटिंग'],
  work: ['काम'],
  task: ['टास्क'],
  review: ['रिव्यू'],
  approve: ['अप्रूव', 'मंजूर', 'मंज़ूर'],
  assign: ['असाइन'],
  delivery: ['डिलीवरी'],
  deliver: ['डिलीवर'],
  data: ['डेटा', 'डाटा'],
  backup: ['बैकअप'],
  card: ['कार्ड'],
  disk: ['डिस्क'],
  album: ['एल्बम', 'अल्बम'],
  photo: ['फोटो', 'तस्वीर'],
  video: ['वीडियो'],
  teaser: ['टीजर'],
  wedding: ['शादी', 'वेडिंग', 'विवाह'],
  haldi: ['हल्दी'],
  mehndi: ['मेहंदी', 'मेंहदी'],
  sangeet: ['संगीत'],
  reception: ['रिसेप्शन'],
  event: ['इवेंट'],
  function: ['फंक्शन'],
  date: ['तारीख', 'डेट'],
  calendar: ['कैलेंडर'],
  guests: ['मेहमान', 'गेस्ट'],
  // Money
  quotation: ['कोटेशन', 'क्वोटेशन', 'कोटेशन्स'],
  quote: ['कोट'],
  invoice: ['इनवॉइस', 'इनवॉयस', 'इन्वॉइस', 'इनवाइस'],
  bill: ['बिल'],
  payment: ['पेमेंट', 'भुगतान'],
  money: ['पैसा', 'पैसे', 'पैसों'],
  amount: ['रकम', 'राशि', 'अमाउंट'],
  advance: ['एडवांस'],
  receipt: ['रसीद'],
  expense: ['खर्च', 'खर्चा', 'खर्चे', 'एक्सपेंस'],
  gst: ['जीएसटी'],
  // Not कर: it is "tax", but far more often "do" (कैसे करें), so it is a stop word.
  tax: ['टैक्स'],
  profit: ['मुनाफा', 'प्रॉफिट', 'लाभ'],
  salary: ['सैलरी', 'वेतन', 'तनख्वाह', 'तनखा'],
  payroll: ['पेरोल'],
  payout: ['पेआउट'],
  upi: ['यूपीआई'],
  bank: ['बैंक'],
  package: ['पैकेज'],
  plan: ['प्लान'],
  subscription: ['सब्सक्रिप्शन'],
  // Time
  attendance: ['अटेंडेंस', 'हाजिरी', 'उपस्थिति'],
  leave: ['छुट्टी', 'छुट्टियां', 'लीव'],
  // The app
  report: ['रिपोर्ट'],
  settings: ['सेटिंग', 'सेटिंग्स'],
  form: ['फॉर्म', 'फार्म'],
  logo: ['लोगो'],
  branding: ['ब्रांडिंग'],
  terms: ['टर्म्स', 'शर्तें', 'शर्तों'],
  signature: ['हस्ताक्षर', 'सिग्नेचर'],
  sign: ['साइन'],
  template: ['टेम्पलेट', 'टेंपलेट'],
  referral: ['रेफरल'],
  whatsapp: ['व्हाट्सएप', 'व्हाट्सऐप', 'वॉट्सऐप'],
  facebook: ['फेसबुक'],
  email: ['ईमेल'],
  link: ['लिंक'],
  share: ['शेयर'],
  print: ['प्रिंट'],
  download: ['डाउनलोड'],
  export: ['एक्सपोर्ट'],
  search: ['सर्च', 'ढूंढें', 'ढूंढना'],
  // Verbs
  add: ['जोड़ें', 'जोड़ना', 'जोड़ूं', 'जोड़', 'जोड़े', 'ऐड', 'एड'],
  send: ['भेजें', 'भेजना', 'भेजूं', 'भेज', 'भेजे', 'सेंड'],
  create: ['बनाएं', 'बनाना', 'बनाऊं', 'बनाये', 'बनाए'],
  change: ['बदलें', 'बदलना', 'बदलूं', 'चेंज'],
  delete: ['हटाएं', 'हटाना', 'हटाऊं', 'डिलीट'],
  record: ['रिकॉर्ड', 'रिकार्ड', 'दर्ज'],
  new: ['नया', 'नई', 'नए', 'नये'],
}

/**
 * Hindi words that tell two articles nothing apart: how, do, of, for, my.
 * The English list in retrieve.ts does the same job for English.
 */
const HI_STOP = [
  'कैसे', 'करें', 'करूं', 'करना', 'करे', 'करते', 'करता', 'करती', 'कर', 'के', 'का', 'की', 'को',
  'में', 'से', 'पर', 'लिए', 'है', 'हैं', 'मैं', 'मेरा', 'मेरी', 'मेरे', 'हम', 'हमारा', 'हमारे', 'आप',
  'अपना', 'अपने', 'अपनी', 'क्या', 'कहां', 'कब', 'कौन', 'और', 'या', 'एक', 'यह', 'ये', 'वह', 'वो',
  'तो', 'भी', 'ही', 'नहीं', 'सकते', 'सकता', 'सकती', 'होता', 'होती', 'हो', 'था', 'थी', 'गया',
  'गई', 'चाहिए', 'दें', 'दे', 'देना', 'जी', 'कृपया', 'बताएं', 'बताइए', 'बताओ',
]

/**
 * Hinglish -- Hindi in English letters -- for the words that are not English
 * already. Most of a Hinglish question is English ("client ka payment kaise
 * record karu") and needs nothing; these are the rest. Kept to words that are
 * never English, because this table is applied to the help's own text too.
 */
const HINGLISH: Record<string, readonly string[]> = {
  work: ['kaam', 'kam'],
  send: ['bhejna', 'bheju', 'bhejo', 'bhejein', 'bhejen', 'bhej'],
  add: ['jodna', 'jodu', 'jodo', 'jodein', 'joden', 'jod'],
  create: ['banana', 'banau', 'banao', 'banaye', 'banayein'],
  delete: ['hatana', 'hatau', 'hatao'],
  change: ['badalna', 'badlu', 'badlo'],
  money: ['paisa', 'paise'],
  expense: ['kharcha', 'kharche', 'kharch'],
  leave: ['chutti', 'chhutti', 'chuttiyan'],
  wedding: ['shaadi', 'shadi', 'vivah'],
  salary: ['tankhwah', 'tankha', 'vetan'],
  attendance: ['hazri', 'hajri', 'haziri'],
  client: ['grahak'],
  new: ['naya', 'nayi', 'naye'],
}

const HINGLISH_STOP = [
  'kaise', 'kese', 'karu', 'karun', 'karna', 'kare', 'karein', 'karen', 'karte', 'karta', 'kar',
  // Not 'main': it is also English, and the help says "main disk".
  'ka', 'ki', 'ke', 'ko', 'mein', 'mai', 'se', 'pe', 'hai', 'hain', 'kya', 'kahan',
  'kidhar', 'kab', 'aur', 'ya', 'apna', 'apne', 'apni', 'mera', 'meri', 'mere', 'hum', 'humara',
  'aap', 'sakte', 'sakta', 'chahiye', 'batao', 'bataiye', 'please', 'plz', 'kuch', 'bhi',
]

/** Folded Hindi word or Hinglish word → English words. An empty list is a stop word. */
const TABLE: ReadonlyMap<string, readonly string[]> = (() => {
  const t = new Map<string, readonly string[]>()
  for (const [en, his] of Object.entries(HI)) for (const h of his) t.set(foldHindi(h), [en])
  for (const s of HI_STOP) t.set(foldHindi(s), [])
  for (const [en, ws] of Object.entries(HINGLISH)) for (const w of ws) t.set(w, [en])
  for (const s of HINGLISH_STOP) t.set(s, [])
  return t
})()

/**
 * One word of a question, as the English the help would use.
 *
 * Returns the English word(s); an empty list for a word that carries no
 * meaning; or null when the word is not in the table, in which case the
 * caller keeps it as it is.
 */
export function asEnglish(word: string): readonly string[] | null {
  const key = DEVANAGARI.test(word) ? foldHindi(word) : word
  return TABLE.get(key) ?? null
}
