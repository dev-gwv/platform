import type { AssistantLang } from '@ipc/contracts'

/**
 * The panel's own words in the three languages a studio can pick.
 *
 * Only the panel's chrome -- the answers come back from the server already in
 * the picked language. Button names the app prints (Help, Enter) stay in
 * English, the same rule the answers follow. Neutral in gender throughout:
 * Hindi verbs carry the speaker's gender, and the assistant has none.
 */
export interface PanelCopy {
  intro: string
  openers: readonly string[]
  placeholder: string
  spentPlaceholder: string
  opensTomorrow: string
  enterToSend: string
  leftToday: (n: number) => string
  lookingUp: string
  tryAgain: string
  bookCall: string
  /** Opens Report a problem with this conversation (support requests, 0271). */
  tellTeam: string
  copy: string
  copied: string
  copyFailed: string
  didItHelp: string
  glad: string
  thanks: string
  /** The help bubble's own header and the line above the people to talk to. */
  bubbleHello: string
  ratherPerson: string
}

export const COPY: Record<AssistantLang, PanelCopy> = {
  en: {
    intro: 'Ask how to do something in the app and I will tell you where it is.',
    openers: [
      'How do I add my team?',
      'How do I send a quotation?',
      'How do I book crew for a shoot day?',
      'How do I give someone access to money?',
    ],
    placeholder: 'Ask about anything in the app…',
    spentPlaceholder: 'You have used today’s questions.',
    opensTomorrow: 'The assistant opens again tomorrow.',
    enterToSend: 'Enter to send',
    leftToday: (n) => `${n} left today`,
    lookingUp: 'Looking it up…',
    tryAgain: 'Try again',
    bookCall: 'Book a call',
    tellTeam: 'Tell the team',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy — select the answer and copy it by hand',
    didItHelp: 'Did this help?',
    glad: '· Glad that helped',
    thanks: '· Thanks for saying. Press Help at the foot of the menu and we will answer.',
    bubbleHello: 'Hi! How can we help?',
    ratherPerson: 'Rather talk to a person?',
  },
  hi: {
    intro: 'ऐप में कोई भी काम कैसे करें, यहाँ पूछिए।',
    openers: ['टीम कैसे जोड़ें?', 'कोटेशन कैसे भेजें?', 'शूट के लिए क्रू कैसे बुक करें?', 'किसी को पैसों का एक्सेस कैसे दें?'],
    placeholder: 'ऐप के बारे में कुछ भी पूछें…',
    spentPlaceholder: 'आज के सवाल पूरे हो गए।',
    opensTomorrow: 'असिस्टेंट कल फिर खुलेगा।',
    enterToSend: 'भेजने के लिए Enter',
    leftToday: (n) => `आज ${n} बाकी`,
    lookingUp: 'देख रहे हैं…',
    tryAgain: 'फिर से पूछें',
    bookCall: 'कॉल बुक करें',
    tellTeam: 'टीम को बताएं',
    copy: 'कॉपी',
    copied: 'कॉपी हो गया',
    copyFailed: 'कॉपी नहीं हो सका — जवाब चुनकर खुद कॉपी करें',
    didItHelp: 'क्या इससे मदद मिली?',
    glad: '· अच्छा लगा कि मदद मिली',
    thanks: '· बताने के लिए धन्यवाद। मेन्यू के नीचे Help दबाएँ, हम जवाब देंगे।',
    bubbleHello: 'नमस्ते! हम कैसे मदद करें?',
    ratherPerson: 'किसी व्यक्ति से बात करनी है?',
  },
  hinglish: {
    intro: 'App mein koi bhi kaam kaise karein, yahan poochhiye.',
    openers: [
      'Team kaise jodein?',
      'Quotation kaise bhejein?',
      'Shoot ke liye crew kaise book karein?',
      'Kisi ko money ka access kaise dein?',
    ],
    placeholder: 'App ke baare mein kuch bhi poochhiye…',
    spentPlaceholder: 'Aaj ke sawal poore ho gaye.',
    opensTomorrow: 'Assistant kal phir khulega.',
    enterToSend: 'Bhejne ke liye Enter',
    leftToday: (n) => `Aaj ${n} baaki`,
    lookingUp: 'Dekh rahe hain…',
    tryAgain: 'Phir se poochhiye',
    bookCall: 'Call book karein',
    tellTeam: 'Team ko batayein',
    copy: 'Copy',
    copied: 'Copy ho gaya',
    copyFailed: 'Copy nahi ho saka — answer select karke khud copy kariye',
    didItHelp: 'Kya isse madad mili?',
    glad: '· Achha laga ki madad mili',
    thanks: '· Batane ke liye shukriya. Menu ke neeche Help dabaiye, hum jawab denge.',
    bubbleHello: 'Namaste! Hum kaise madad karein?',
    ratherPerson: 'Kisi person se baat karni hai?',
  },
}

/**
 * How each choice is named on its own button: in its own script, so whoever
 * reads Hindi finds हिन्दी without reading English first.
 */
export const LANG_CHOICES: readonly { lang: AssistantLang; label: string; sample: string }[] = [
  { lang: 'en', label: 'English', sample: 'Answers in English' },
  { lang: 'hi', label: 'हिन्दी', sample: 'जवाब हिन्दी में' },
  { lang: 'hinglish', label: 'Hinglish', sample: 'Jawab Hindi mein, English letters mein' },
]
