/**
 * Languages of the Piano Academy: simple Hindi (with the English musical
 * terms) and English.
 *
 * - `Text` is a pair used inside song data (tips, hand shifts, intro).
 * - `UI` holds the fixed labels of the Academy panel.
 * - Messages (`Msg`) are what the Lesson Engine says. The engine stores a
 *   message id with its parameters, not finished text, so switching the
 *   language also changes the message already on screen.
 *
 * Note names (G4), finger numbers and lyrics are the same in both languages.
 */
import { noteName } from '../music/notes';
import { isText, type Lang, type Text } from './text';
import { wrongKeyHint } from './validation';

export { isLang, isText, type Lang, type Text } from './text';
export const LANGS: readonly Lang[] = ['hi', 'en'];
export const LANG_NAME: Record<Lang, string> = { hi: 'हिंदी', en: 'English' };

/* ------------------------------------------------------------------ */
/* panel labels                                                          */
/* ------------------------------------------------------------------ */

export const UI = {
  modeWatchSub: { hi: 'सुनें और देखें', en: 'listen and watch' },
  modeStepSub: { hi: 'एक-एक note', en: 'one note at a time' },
  modeGuidedSub: { hi: 'metronome के साथ', en: 'with the metronome' },
  modePerformSub: { hi: 'बिना मदद के', en: 'on your own' },
  done: { hi: 'पूरा', en: 'Done' },
  section: { hi: 'अभ्यास का हिस्सा', en: 'Practise' },
  wholeSong: { hi: 'पूरा', en: 'All' },
  loop: { hi: 'Loop — बार-बार दोहराएँ', en: 'Loop — repeat again and again' },
  counting: { hi: 'गिनती…', en: 'count…' },
  audioOff: { hi: 'आवाज़ अभी बंद है — keyboard पर या कहीं भी एक बार क्लिक करें।', en: 'Sound is off — click the keyboard (or anywhere) once.' },
  warnShift: { hi: 'Transpose / Octave 0 नहीं है — keys की आवाज़ असली note से अलग सुनाई देगी।', en: 'Transpose / Octave is not 0 — keys will not sound the note they show.' },
  warnArp: { hi: 'Arpeggio चालू है — keys अकेले note नहीं बजाएँगी।', en: 'Arpeggio is on — keys will not play single notes.' },
  warnHarmony: { hi: 'Harmony चालू है — हर note के साथ और notes भी बजेंगे।', en: 'Harmony is on — extra notes will sound with each key.' },
  warnLayer: { hi: 'Layer चालू है — दो आवाज़ें एक साथ बजेंगी।', en: 'Layer is on — two sounds will play together.' },
  warnSplit: { hi: 'Split चालू है — lesson की कुछ keys दूसरी आवाज़ बजा सकती हैं।', en: 'Split is on — some lesson keys may play another sound.' },
  fix: { hi: 'ठीक करें', en: 'Fix it' },
  prev: { hi: 'पिछला', en: 'Previous' },
  next: { hi: 'अगला', en: 'Next' },
  finger: { hi: 'उँगली', en: 'Finger' },
  nowPlaying: { hi: 'अभी बज रहा है', en: 'Playing now' },
  pressNow: { hi: 'अब यह key दबाएँ', en: 'Press this key now' },
  computerKey: { hi: 'Computer key', en: 'Computer key' },
  rightHand: { hi: 'दायाँ हाथ', en: 'Right hand' },
  performPlaying: { hi: 'अपनी याद से बजाएँ…', en: 'Play from memory…' },
  performHidden: { hi: 'आगे के notes छिपे हैं। बजाने के बाद पूरा हिसाब दिखेगा।', en: 'The notes are hidden. You will see the full result when you finish.' },
  notesPlayed: { hi: 'बजाए गए notes', en: 'Notes played' },
  markOk: { hi: 'सही', en: 'Correct' },
  markFixed: { hi: 'सही (दूसरी कोशिश / समय थोड़ा हटकर)', en: 'Correct (second try / slightly off time)' },
  markBad: { hi: 'गलत key दबाई', en: 'Wrong key pressed' },
  markMissed: { hi: 'छूट गया', en: 'Missed' },
  remember: { hi: 'याद रखें', en: 'Remember' },
  moveHand: { hi: 'हाथ खिसकाएँ', en: 'Move your hand' },
  attention: { hi: 'ध्यान दें', en: 'Watch out' },
  correctNotes: { hi: 'सही notes', en: 'Correct notes' },
  wrongKeys: { hi: 'गलत keys', en: 'Wrong keys' },
  missedNotes: { hi: 'छूटे notes', en: 'Missed notes' },
  extraNotes: { hi: 'फालतू notes', en: 'Extra notes' },
  rhythm: { hi: 'Rhythm (लय)', en: 'Rhythm' },
  onTime: { hi: 'समय पर (timing)', en: 'On time' },
  yourTempo: { hi: 'आपकी रफ़्तार', en: 'Your tempo' },
  timeTaken: { hi: 'समय लगा', en: 'Time taken' },
  look: { hi: 'ध्यान दें', en: 'Look at' },
  issueWrong: { hi: 'गलत key', en: 'wrong key' },
  issueMissed: { hi: 'छूटा', en: 'missed' },
  issueLate: { hi: 'देर से', en: 'late' },
  issueEarly: { hi: 'जल्दी', en: 'early' },
  again: { hi: 'फिर से', en: 'Again' },
  nextMode: { hi: 'आगे', en: 'Next' },
  hearNote: { hi: 'Note सुनें', en: 'Hear note' },
  hearPhrase: { hi: 'Phrase सुनें', en: 'Hear phrase' },
  repeatPhrase: { hi: 'Phrase दोहराएँ', en: 'Repeat phrase' },
  tempo: { hi: 'Tempo (रफ़्तार)', en: 'Tempo' },
  metronome: { hi: 'Metronome (टिक-टिक)', en: 'Metronome' },
  guideMelody: { hi: 'धीमी आवाज़ में धुन साथ बजे', en: 'Play the melody softly along' },
  back: { hi: 'Instrument पर लौटें', en: 'Back to instrument' },
  today: { hi: 'आज', en: 'Today' },
  total: { hi: 'कुल', en: 'Total' },
  weakNotes: { hi: 'कमज़ोर notes', en: 'Weak notes' },
  fingers: { hi: 'Finger numbers', en: 'Finger numbers' },
  noteNames: { hi: 'Key पर note का नाम', en: 'Note name on the key' },
  allLabels: { hi: 'सभी keys पर labels', en: 'Labels on all keys' },
  all: { hi: 'सभी', en: 'All' },
  allMidi: { hi: 'सभी MIDI devices', en: 'All MIDI devices' },
  midiUnsupported: { hi: 'यह browser MIDI नहीं चलाता — Chrome / Edge लें।', en: 'This browser has no MIDI — use Chrome or Edge.' },
  midiDenied: { hi: 'MIDI की अनुमति नहीं मिली।', en: 'MIDI access was refused.' },
  midiNone: { hi: 'कोई MIDI keyboard नहीं जुड़ा।', en: 'No MIDI keyboard connected.' },
  minutes: { hi: 'मिनट', en: 'min' },
  hours: { hi: 'घंटे', en: 'h' },
  language: { hi: 'भाषा', en: 'Language' },
  chooseTitle: { hi: 'भाषा चुनें', en: 'Choose your language' },
  chooseHint: {
    hi: 'Lesson की सारी बातें — निर्देश, सुझाव और नतीजे — इसी भाषा में होंगी। बाद में ऊपर से कभी भी बदल सकते हैं।',
    en: 'All lesson guidance — instructions, tips and results — will be in this language. You can change it at the top at any time.',
  },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof UI;

export const ui = (key: UiKey, lang: Lang): string => UI[key][lang];

/* ------------------------------------------------------------------ */
/* what the teacher says                                                 */
/* ------------------------------------------------------------------ */

type Value = string | number | Text | undefined;
export type MsgParams = Record<string, Value>;
type Plain = Record<string, string | number | undefined>;
type Say = (p: Plain) => string;

const MESSAGES = {
  midiGone: {
    hi: (p) => `MIDI keyboard "${p.name}" हट गया। दोबारा लगाएँ, या computer keyboard / mouse से बजाएँ।`,
    en: (p) => `MIDI keyboard "${p.name}" was disconnected. Plug it in again, or play with the computer keyboard / mouse.`,
  },
  readyWatch: {
    hi: () => 'Play दबाएँ — piano पूरा गाना बजाएगा और हर key हरी होकर दिखेगी। ध्यान से सुनें और देखें।',
    en: () => 'Press Play — the piano plays the whole song and lights each key green. Listen and watch carefully.',
  },
  readyStep: {
    hi: (p) => `हरी key दबाएँ: ${p.note}, उँगली ${p.finger}। समय की चिंता न करें — सही key पर lesson आगे बढ़ेगा।`,
    en: (p) => `Press the green key: ${p.note}, finger ${p.finger}. Don't worry about timing — the lesson moves on when the key is right.`,
  },
  readyGuided: {
    hi: (p) => `Start दबाएँ। पहले एक bar की गिनती (1-2-3) होगी, फिर "1-2" के बाद ${p.note} से शुरू करें।`,
    en: (p) => `Press Start. First you hear one bar of counting (1-2-3), then after "1-2" begin on ${p.note}.`,
  },
  readyPerform: {
    hi: (p) => `अब कोई मदद नहीं दिखेगी। Start दबाकर ${p.note} से शुरू करें और अपनी रफ़्तार से पूरा गाना बजाएँ।`,
    en: (p) => `No help is shown now. Press Start, begin on ${p.note} and play the whole song at your own speed.`,
  },
  startWatch: {
    hi: () => 'सुनिए… हर note के साथ उसकी key हरी होगी।',
    en: () => 'Listen… each key turns green as its note plays.',
  },
  startGuided: {
    hi: () => 'गिनती सुनें: 1 – 2 – 3, 1 – 2 … और बजाएँ!',
    en: () => 'Listen to the count: 1 – 2 – 3, 1 – 2 … and play!',
  },
  startPerform: {
    hi: (p) => `शुरू करें — ${p.note} से। ख़त्म होने पर "Finish" दबाएँ (या आख़िरी note के बाद अपने-आप रुक जाएगा)।`,
    en: (p) => `Begin on ${p.note}. Press "Finish" when you are done (or it stops by itself after the last note).`,
  },
  pausedGuided: {
    hi: (p) => `रुका हुआ। Resume पर ${p.phrase} फिर से (गिनती के साथ) शुरू होगा।`,
    en: (p) => `Paused. Resume starts ${p.phrase} again (with a count-in).`,
  },
  paused: {
    hi: () => 'रुका हुआ। Resume दबाएँ — यहीं से आगे चलेगा।',
    en: () => 'Paused. Press Resume to continue from here.',
  },
  resumeGuided: {
    hi: () => 'गिनती के बाद फिर से बजाएँ।',
    en: () => 'Play again after the count.',
  },
  repeatPhrase: {
    hi: (p) => `${p.phrase} फिर से — हरी key ${p.note} से।`,
    en: (p) => `${p.phrase} again — from the green key ${p.note}.`,
  },
  previewPhrase: {
    hi: (p) => `${p.phrase} सुनिए…`,
    en: (p) => `Listen to ${p.phrase}…`,
  },
  previewDone: {
    hi: (p) => `अब आप बजाएँ — हरी key ${p.note}।`,
    en: (p) => `Now you play — the green key ${p.note}.`,
  },
  missed: {
    hi: (p) => `${p.note} ("${p.lyric}") छूट गया — कोई बात नहीं, अगले note पर ध्यान दें।`,
    en: (p) => `${p.note} ("${p.lyric}") was missed — no problem, get ready for the next note.`,
  },
  shortHold: {
    hi: (p) => `${p.note} जल्दी छोड़ दिया। यह ${p.dur} का note है — गिनती पूरी होने तक दबाए रखें।`,
    en: (p) => `${p.note} was let go too soon. It is a ${p.dur} note — hold it until the count is over.`,
  },
  oneKey: {
    hi: () => 'एक समय में एक ही key दबाएँ।',
    en: () => 'Press one key at a time.',
  },
  wrongKey: {
    hi: (p) => wrongKeyHint(Number(p.expected), Number(p.pressed), 'hi'),
    en: (p) => wrongKeyHint(Number(p.expected), Number(p.pressed), 'en'),
  },
  phraseDoneNext: {
    hi: (p) => `${p.phrase} पूरा हुआ! अगला phrase: ${p.lyric}।`,
    en: (p) => `${p.phrase} complete! Next phrase: ${p.lyric}.`,
  },
  correctNext: {
    hi: (p) => `सही! ${p.note} ✓  अब ${p.next}, उँगली ${p.finger}।${p.shift ? ` ${p.shift}` : ''}`,
    en: (p) => `Right! ${p.note} ✓  Now ${p.next}, finger ${p.finger}.${p.shift ? ` ${p.shift}` : ''}`,
  },
  loopAgain: {
    hi: () => 'बहुत बढ़िया! फिर से — Loop चालू है।',
    en: () => 'Very good! Once more — Loop is on.',
  },
  pressStartFirst: {
    hi: () => 'पहले Start दबाएँ — गिनती के बाद बजाना है।',
    en: () => 'Press Start first — you play after the count.',
  },
  countingIn: {
    hi: () => 'अभी गिनती चल रही है… "1-2" के बाद बजाएँ।',
    en: () => 'Still counting… play after "1-2".',
  },
  hitOnTime: {
    hi: (p) => `सही! ${p.note} — समय पर ✓`,
    en: (p) => `Right! ${p.note} — on time ✓`,
  },
  hitEarly: {
    hi: (p) => `${p.note} सही key — पर थोड़ा जल्दी। गिनती के साथ बजाएँ।`,
    en: (p) => `${p.note} is the right key — but a little early. Play with the count.`,
  },
  hitLate: {
    hi: (p) => `${p.note} सही key — पर थोड़ा देर से। गिनती के साथ बजाएँ।`,
    en: (p) => `${p.note} is the right key — but a little late. Play with the count.`,
  },
  phraseClean: {
    hi: (p) => `${p.phrase} पूरा — हर note सही!`,
    en: (p) => `${p.phrase} complete — every note right!`,
  },
  guidedWrong: {
    hi: (p) => `गलत key: ${p.pressed} — चाहिए ${p.expected} (हरी key)।`,
    en: (p) => `Wrong key: ${p.pressed} — it should be ${p.expected} (the green key).`,
  },
  extra: {
    hi: () => 'अभी कोई note नहीं था — हरी key के समय का इंतज़ार करें।',
    en: () => 'No note was due — wait for the green key’s turn.',
  },
  watchDone: {
    hi: () => 'पूरा गाना सुन लिया! अब "Step-by-Step" mode में ख़ुद बजाकर देखें।',
    en: () => 'You have heard the whole song! Now try playing it yourself in "Step-by-Step" mode.',
  },
  lastPass: {
    hi: (p) => `पिछला दौर: ${p.acc}% सही।`,
    en: (p) => `Last round: ${p.acc}% correct.`,
  },
  phraseOnly: {
    hi: (p) => `सिर्फ़ ${p.phrase} — mode पूरा करने के लिए पूरा गाना बजाएँ`,
    en: (p) => `${p.phrase} only — play the whole song to complete the mode`,
  },
  passNeeds: {
    hi: (p) => `Pass के लिए ${p.n}%`,
    en: (p) => `${p.n}% needed to pass`,
  },
  holdFor: {
    hi: (p) => `${p.label} (${p.en}) · ${p.beats} beat ≈ ${p.sec} सेकंड दबाए रखें`,
    en: (p) => `${p.label} · ${p.beats} beat${p.plural} ≈ hold for ${p.sec} s`,
  },
  startOn: {
    hi: (p) => `शुरुआत ${p.note} से`,
    en: (p) => `Start on ${p.note}`,
  },
  comment_excellent: {
    hi: () => 'शानदार! लगभग हर note सही था। अगला mode आज़माएँ।',
    en: () => 'Excellent! Almost every note was right. Try the next mode.',
  },
  comment_timing: {
    hi: () => 'Notes अच्छे थे। अब गिनती पर ध्यान दें — metronome के साथ धीरे बजाएँ।',
    en: () => 'Good notes. Now work on the count — play slowly with the metronome.',
  },
  comment_good: {
    hi: () => 'बहुत अच्छा! ज़्यादातर notes सही थे। लाल निशान वाले notes एक बार और देख लें।',
    en: () => 'Very good! Most notes were right. Look once more at the ones marked red.',
  },
  comment_half: {
    hi: () => 'अच्छी कोशिश! आधे से ज़्यादा सही। मुश्किल phrase को "Loop" करके दो-तीन बार अभ्यास करें।',
    en: () => 'Good try! More than half right. Loop the difficult phrase and practise it two or three times.',
  },
  comment_start: {
    hi: () => 'कोई बात नहीं — शुरुआत ऐसे ही होती है। Step-by-Step mode में एक-एक note धीरे से सीखें।',
    en: () => 'No problem — everyone starts like this. Learn it slowly, note by note, in Step-by-Step mode.',
  },
} satisfies Record<string, Record<Lang, Say>>;

export type MsgId = keyof typeof MESSAGES;

export const MESSAGE_IDS = Object.keys(MESSAGES) as MsgId[];

export interface Msg {
  id: MsgId;
  p?: MsgParams;
}

/** Render a message in a language. Text parameters are resolved to that language first. */
export function say(m: Msg, lang: Lang): string {
  const plain: Plain = {};
  for (const [k, v] of Object.entries(m.p ?? {})) plain[k] = isText(v) ? v[lang] : v;
  return (MESSAGES[m.id][lang] as Say)(plain);
}

/** Convenience for messages that name two keys by MIDI number. */
export const names = (pressed: number, expected: number): MsgParams => ({ pressed: noteName(pressed), expected: noteName(expected) });
