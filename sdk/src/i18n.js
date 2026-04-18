/**
 * Swahili / English UI strings.
 * Detect language from: browser setting, page lang attr, org config, or user toggle.
 */

export const STRINGS = {
  sw: {
    inputHint: 'Uliza swali...',
    statusThinking: 'Nafikiri...',
    statusListening: 'Sikiliza...',
    statusTranscribing: 'Inabadilisha sauti...',
    statusError: 'Kuna tatizo. Jaribu tena.',
    statusNoSpeech: 'Sauti haikueleweka. Jaribu tena.',
    statusMicDenied: 'Ruhusa ya maikrofoni inahitajika.',
    clearTitle: 'Futa mazungumzo',
    closeTitle: 'Funga',
    langToggle: 'EN',
    pttTitle: 'Shikilia kusema',
    sendTitle: 'Tuma',
    poweredBy: 'Powered by Mwongozo',
    errorGeneric: 'Samahani, kuna tatizo la kiufundi. Tafadhali jaribu tena.',
  },
  en: {
    inputHint: 'Ask anything...',
    statusThinking: 'Thinking...',
    statusListening: 'Listening...',
    statusTranscribing: 'Transcribing voice...',
    statusError: 'Something went wrong. Please try again.',
    statusNoSpeech: 'Could not understand. Please try again.',
    statusMicDenied: 'Microphone permission required.',
    clearTitle: 'Clear conversation',
    closeTitle: 'Close',
    langToggle: 'SW',
    pttTitle: 'Hold to speak',
    sendTitle: 'Send',
    poweredBy: 'Powered by Mwongozo',
    errorGeneric: 'Sorry, a technical error occurred. Please try again.',
  },
};

const STORAGE_KEY = 'mwz_lang';

/**
 * Detect the best language to use.
 * Priority: user saved preference > org config > page lang attr > browser lang
 */
export function detectLang(orgLang) {
  // 1. User previously toggled
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'sw' || saved === 'en') return saved;

  // 2. Org config language hint
  if (orgLang) {
    if (orgLang.startsWith('sw')) return 'sw';
    if (orgLang.startsWith('en')) return 'en';
  }

  // 3. Page <html lang="...">
  const pageLang = document.documentElement.lang?.toLowerCase() || '';
  if (pageLang.startsWith('sw')) return 'sw';

  // 4. Browser language
  const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  if (nav.startsWith('sw')) return 'sw';

  return 'en';
}

export function saveLang(lang) {
  localStorage.setItem(STORAGE_KEY, lang);
}

export function t(lang, key) {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}
