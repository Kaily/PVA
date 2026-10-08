import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faCircleCheck,
  faEarListen,
  faEye,
  faFlagCheckered,
  faMinus,
  faPause,
  faPlay,
  faPlus,
  faRepeat,
  faRotateLeft,
  faShoePrints,
  faStar,
  faStopwatch,
  faTriangleExclamation,
  faVolumeHigh,
  faWrench,
  faXmark,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { useStore } from '../../core/store';
import { services } from '../../services';
import * as act from '../../state/actions';
import type { AppState } from '../../state/appState';
import { PanelButton } from '../../ui/controls/PanelButton';
import { useApp } from '../../ui/hooks';
import { closeAcademy, computerKeyFor, lessonWarnings, prepareInstrumentForLesson } from '../actions';
import { LANG_NAME, LANGS, say, ui, type Lang, type UiKey } from '../i18n';
import type { AcademyState, NoteMark, PracticeMode } from '../LessonEngine';
import { dayKey, lessonCompletion, recommendedMode, weakestNotes } from '../progress';
import { PASS_ACCURACY, type PracticeResult } from '../scoring';
import { durationLabel, FINGER_NAMES, noteSeconds, type TimedNote } from '../song';
import { HandDiagram } from './HandDiagram';

/* ------------------------------------------------------------------ */
/* plumbing                                                             */
/* ------------------------------------------------------------------ */

const academy = () => services().academy;

function useAcademy<S>(selector: (s: AcademyState) => S): S {
  return useStore(academy().store, selector);
}

/** The teaching language and a label lookup for it. Hindi until a language is chosen. */
function useLang(): { lang: Lang; t: (key: UiKey) => string } {
  const lang = useAcademy((s) => s.lang ?? 'hi');
  return { lang, t: (key) => ui(key, lang) };
}

/** A small panel switch that never takes keyboard focus (so the computer keys keep playing notes). */
function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      className={`ac-toggle${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      title={hint}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onChange(!on)}
    >
      <span className="ac-toggle__led" aria-hidden="true" />
      <span className="ac-toggle__label">{label}</span>
    </button>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ac-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`ac-seg__btn${o.value === value ? ' is-on' : ''}`}
          title={o.title}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  return (
    <section className={`sec ${className}`} aria-label={title}>
      <h2 className="sec__title">
        <span>{title}</span>
      </h2>
      <div className="sec__body ac-col">{children}</div>
    </section>
  );
}

const MODES: { id: PracticeMode; letter: string; name: string; sub: UiKey; icon: IconDefinition }[] = [
  { id: 'watch', letter: 'A', name: 'Watch & Listen', sub: 'modeWatchSub', icon: faEye },
  { id: 'step', letter: 'B', name: 'Step-by-Step', sub: 'modeStepSub', icon: faShoePrints },
  { id: 'guided', letter: 'C', name: 'Guided Practice', sub: 'modeGuidedSub', icon: faStopwatch },
  { id: 'perform', letter: 'D', name: 'Independent', sub: 'modePerformSub', icon: faStar },
];

const MODE_NAME: Record<PracticeMode, string> = { watch: 'Watch & Listen', step: 'Step-by-Step', guided: 'Guided Practice', perform: 'Independent Performance' };

const BEAT_FRACTION: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '1.5': '1½' };
const beatsText = (b: number): string => BEAT_FRACTION[String(b)] ?? String(b);

/* ------------------------------------------------------------------ */
/* the panel                                                            */
/* ------------------------------------------------------------------ */

/** The Piano Academy, shown in place of the control panel. The keybed below stays the instrument's own. */
export function AcademyPanel() {
  const chosen = useAcademy((s) => s.lang !== null);
  const lang = useAcademy((s) => s.lang ?? 'hi');
  return (
    <div className="panel panel--academy" role="region" aria-label="Piano Academy" lang={lang}>
      <LessonColumn />
      <TeachScreen />
      <PracticeColumn />
      <ProgressColumn />
      {!chosen && <LanguageChooser />}
    </div>
  );
}

/** First visit: the teaching language must be chosen before the lesson starts. */
function LanguageChooser() {
  return (
    <div className="ac-langpick" role="dialog" aria-modal="true" aria-label="भाषा चुनें · Choose your language">
      <div className="ac-langpick__card">
        <h2>
          {ui('chooseTitle', 'hi')} <span>·</span> {ui('chooseTitle', 'en')}
        </h2>
        <div className="ac-langpick__options">
          {LANGS.map((l) => (
            <button key={l} type="button" lang={l} className="ac-langpick__btn" onPointerDown={(e) => e.preventDefault()} onClick={() => academy().setLang(l)}>
              <b>{LANG_NAME[l]}</b>
              <small>{ui('chooseHint', l)}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact language switch for the screen header. */
function LanguageSwitch() {
  const { lang, t } = useLang();
  return (
    <div className="ac-seg ac-seg--lcd" role="radiogroup" aria-label={t('language')}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          lang={l}
          aria-checked={l === lang}
          className={`ac-seg__btn${l === lang ? ' is-on' : ''}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => academy().setLang(l)}
        >
          {l === 'hi' ? 'हिंदी' : 'EN'}
        </button>
      ))}
    </div>
  );
}

/* ---- left: mode and section ---------------------------------------- */

function LessonColumn() {
  const mode = useAcademy((s) => s.mode);
  const phrase = useAcademy((s) => s.phrase);
  const loop = useAcademy((s) => s.loop);
  const lesson = useAcademy((s) => s.progress.lessons[s.songId]);
  const { t } = useLang();
  const phrases = academy().compiled.phrases;
  return (
    <Section title="Lesson" className="ac-sec--lesson">
      <div className="ac-modes" role="radiogroup" aria-label="Practice mode">
        {MODES.map((m) => {
          const done = m.id === 'watch' ? !!lesson?.watched : !!lesson?.passed.includes(m.id as Exclude<PracticeMode, 'watch'>);
          const best = m.id === 'watch' ? undefined : lesson?.best[m.id as Exclude<PracticeMode, 'watch'>];
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={`ac-mode${mode === m.id ? ' is-on' : ''}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                act.unlockAudio();
                academy().setMode(m.id);
              }}
            >
              <span className="ac-mode__letter">{m.letter}</span>
              <span className="ac-mode__text">
                <b>
                  <FontAwesomeIcon icon={m.icon} /> {m.name}
                </b>
                <small>{t(m.sub)}</small>
              </span>
              <span className="ac-mode__score">
                {done && <FontAwesomeIcon icon={faCircleCheck} className="ac-ok" title={t('done')} />}
                {best !== undefined && <small>{best}%</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ac-field">
        <span className="ac-field__label">{t('section')}</span>
        <Segmented<number>
          label="Song section"
          value={phrase === null ? -1 : phrase}
          options={[{ value: -1, label: t('wholeSong'), title: 'Whole song' }, ...phrases.map((p) => ({ value: p.index, label: `P${p.index + 1}`, title: `${p.title}: ${p.lyric}` }))]}
          onChange={(v) => academy().setPhrase(v < 0 ? null : v)}
        />
      </div>
      <Toggle label={t('loop')} on={loop} onChange={(v) => academy().setLoop(v)} hint="Loop the selected section" />
    </Section>
  );
}

/* ---- centre: the teaching screen ----------------------------------- */

function TeachScreen() {
  const mode = useAcademy((s) => s.mode);
  const status = useAcademy((s) => s.status);
  const count = useAcademy((s) => s.count);
  const result = useAcademy((s) => s.result);
  const { lang, t } = useLang();
  const song = academy().compiled;
  const def = song.def;
  const hidden = mode === 'perform' && status !== 'finished';
  return (
    <div className="lcd ac-lcd">
      <div className="lcd__screen ac-screen">
        <header className="ac-head">
          <span className="ac-head__brand">PIANO ACADEMY</span>
          <span className="ac-head__title">{def.title}</span>
          <span className="ac-chip">{def.difficulty[lang]}</span>
          <span className="ac-chip">{def.keySignature}</span>
          <span className="ac-chip">{def.practice[lang]}</span>
          <span className="ac-chip">
            {def.timeSignature.beats}/{def.timeSignature.unit}
          </span>
          <span className="ac-head__mode">{MODE_NAME[mode]}</span>
          <LanguageSwitch />
        </header>
        <Warnings />
        <PhraseBar />
        {hidden ? <PerformFocus /> : <Focus />}
        {!hidden && <NoteStrip />}
        <Guidance />
        {count && (
          <div className="ac-count" aria-live="assertive">
            <span>{count}</span>
            <small>{t('counting')}</small>
          </div>
        )}
        {result && <ResultCard result={result} />}
      </div>
      <div className="lcd__glare" />
    </div>
  );
}

function Warnings() {
  const warnings = useApp((s: AppState) => lessonWarnings(s).join(','));
  const audio = useApp((s) => s.engine === 'running');
  const { t } = useLang();
  if (!warnings && audio) return null;
  return (
    <div className="ac-warn" role="alert">
      <FontAwesomeIcon icon={faTriangleExclamation} />
      <span className="ac-warn__text">
        {!audio && <span>{t('audioOff')}</span>}
        {warnings &&
          warnings.split(',').map((w) => (
            <span key={w}>{t(w as UiKey)}</span>
          ))}
      </span>
      {warnings && (
        <button type="button" className="ac-warn__fix" onPointerDown={(e) => e.preventDefault()} onClick={prepareInstrumentForLesson}>
          <FontAwesomeIcon icon={faWrench} /> {t('fix')}
        </button>
      )}
    </div>
  );
}

function PhraseBar() {
  const index = useAcademy((s) => s.index);
  const done = useAcademy((s) => s.phraseDone);
  const selected = useAcademy((s) => s.phrase);
  const mode = useAcademy((s) => s.mode);
  const status = useAcademy((s) => s.status);
  const song = academy().compiled;
  const current = song.notes[index]?.phrase ?? 0;
  const from = selected === null ? 0 : song.phrases[selected].first;
  const total = selected === null ? song.notes.length : song.phrases[selected].end - from;
  const position = mode === 'perform' && status !== 'finished' ? '—' : status === 'finished' ? `${total} / ${total} ✓` : `Note ${index - from + 1} / ${total}`;
  return (
    <div className="ac-phrases">
      {song.phrases.map((p) => (
        <div
          key={p.index}
          className={`ac-phrase${p.index === current ? ' is-current' : ''}${done[p.index] ? ' is-done' : ''}${selected !== null && selected !== p.index ? ' is-out' : ''}`}
        >
          <b>{p.title}</b>
          <span>{p.lyric}</span>
        </div>
      ))}
      <div className="ac-phrases__pos">{position}</div>
    </div>
  );
}

function NoteCard({ note, role, tempo }: { note: TimedNote | undefined; role: 'prev' | 'next'; tempo: number }) {
  const { t } = useLang();
  if (!note) return <div className={`ac-mini ac-mini--${role} is-empty`} />;
  return (
    <div className={`ac-mini ac-mini--${role}`}>
      <small>{t(role)}</small>
      <b>{note.name}</b>
      <span>
        {t('finger')} {note.finger} · {note.lyric}
      </span>
      <span className="ac-mini__dur">
        {beatsText(note.beats)} beat · {noteSeconds(note.beats, tempo).toFixed(2)} s
      </span>
    </div>
  );
}

function Focus() {
  const index = useAcademy((s) => s.index);
  const tempo = useAcademy((s) => s.tempo);
  const beat = useAcademy((s) => s.beat);
  const fingers = useAcademy((s) => s.showFingers);
  const mode = useAcademy((s) => s.mode);
  const keyMap = useApp((s) => s.keyMap);
  const { lang, t } = useLang();
  const song = academy().compiled;
  const note = song.notes[index];
  const dur = durationLabel(note.beats);
  const pcKey = computerKeyFor(keyMap, note.midi);
  const label = t(mode === 'watch' ? 'nowPlaying' : 'pressNow');
  const hold = say(
    {
      id: 'holdFor',
      p: { label: dur[lang], en: dur.en, beats: beatsText(note.beats), plural: note.beats > 1 ? 's' : '', sec: noteSeconds(note.beats, tempo).toFixed(2) },
    },
    lang,
  );
  return (
    <div className="ac-focus">
      <NoteCard note={song.notes[index - 1]} role="prev" tempo={tempo} />
      <div className="ac-now" aria-live="polite">
        <small className="ac-now__label">{label}</small>
        <div className="ac-now__row">
          <b className="ac-now__note">{note.name}</b>
          <div className="ac-now__facts">
            {fingers && (
              <span className="ac-now__finger">
                {t('finger')} <b>{note.finger}</b> — {FINGER_NAMES[note.finger][lang]}
              </span>
            )}
            <span className="ac-now__lyric">“{note.lyric}”</span>
          </div>
        </div>
        <div className="ac-now__dur">
          <span className="ac-durbar" style={{ ['--w' as string]: `${Math.min(1, note.beats / 3) * 100}%` }} />
          <span>{hold}</span>
        </div>
        <div className="ac-now__foot">
          {pcKey && (
            <span>
              {t('computerKey')}: <kbd>{pcKey}</kbd>
            </span>
          )}
          <span className="ac-beats" aria-label="Beat">
            {Array.from({ length: song.beatsPerBar }, (_, i) => (
              <i key={i} className={beat === i ? (i === 0 ? 'is-accent' : 'is-on') : ''} />
            ))}
          </span>
        </div>
      </div>
      <div className="ac-next">
        <NoteCard note={song.notes[index + 1]} role="next" tempo={tempo} />
        <NoteCard note={song.notes[index + 2]} role="next" tempo={tempo} />
      </div>
      {fingers && <HandDiagram finger={note.finger} caption={t('rightHand')} />}
    </div>
  );
}

function PerformFocus() {
  const played = useAcademy((s) => s.live.played);
  const status = useAcademy((s) => s.status);
  const song = academy().compiled;
  const phrase = useAcademy((s) => s.phrase);
  const { lang, t } = useLang();
  const first = song.notes[phrase === null ? 0 : song.phrases[phrase].first];
  return (
    <div className="ac-focus ac-focus--perform">
      <div className="ac-now">
        <small className="ac-now__label">Independent Performance</small>
        <b className="ac-now__big">{status === 'running' ? t('performPlaying') : say({ id: 'startOn', p: { note: first.name } }, lang)}</b>
        <span className="ac-now__lyric">{t('performHidden')}</span>
        <span className="ac-now__count">
          {t('notesPlayed')}: <b>{played}</b>
        </span>
      </div>
    </div>
  );
}

const MARK_TITLE: Record<NoteMark, UiKey | null> = { pending: null, ok: 'markOk', fixed: 'markFixed', bad: 'markBad', missed: 'markMissed' };

function NoteStrip() {
  const marks = useAcademy((s) => s.marks);
  const index = useAcademy((s) => s.index);
  const selected = useAcademy((s) => s.phrase);
  const status = useAcademy((s) => s.status);
  const { t } = useLang();
  const song = academy().compiled;
  return (
    <ol className="ac-strip" aria-label="Melody">
      {song.notes.map((n) => {
        const out = selected !== null && n.phrase !== selected;
        const first = n.indexInPhrase === 0 && n.index > 0;
        return (
          <li
            key={n.index}
            className={`ac-strip__n is-${marks[n.index]}${n.index === index && status !== 'finished' ? ' is-current' : ''}${out ? ' is-out' : ''}${first ? ' is-phrase' : ''}`}
            style={{ flexGrow: Math.max(1, n.beats) }}
            title={MARK_TITLE[marks[n.index]] ? t(MARK_TITLE[marks[n.index]]!) : undefined}
          >
            <b>{n.name}</b>
            <span>{n.lyric}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Guidance() {
  const feedback = useAcademy((s) => s.feedback);
  const index = useAcademy((s) => s.index);
  const mode = useAcademy((s) => s.mode);
  const status = useAcademy((s) => s.status);
  const { lang, t } = useLang();
  const song = academy().compiled;
  const note = song.notes[index];
  const phrase = song.phrases[note.phrase];
  const shift = note.shift && status !== 'finished' ? note.shift : null;
  const tip = mode === 'perform' ? song.def.intro[lang] : shift ? shift[lang] : phrase.tip[lang];
  const heading = mode === 'perform' ? t('remember') : shift ? t('moveHand') : phrase.title;
  return (
    <div className="ac-guide">
      <p className="ac-guide__tip">
        <b>{heading}:</b> {tip}
      </p>
      {feedback && (
        <p key={feedback.key} className={`ac-guide__fb is-${feedback.tone}`} aria-live="polite">
          {say(feedback.msg, lang)}
        </p>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: PracticeResult }) {
  const lesson = useAcademy((s) => s.progress.lessons[s.songId]);
  const { lang, t } = useLang();
  const song = academy().compiled;
  const next = recommendedMode(lesson);
  const passed = result.accuracy >= PASS_ACCURACY[result.mode];
  const rows: [string, number | string][] = [
    [t('correctNotes'), `${result.correct} / ${result.total}`],
    [t('wrongKeys'), result.wrong],
    [t('missedNotes'), result.missed],
  ];
  if (result.mode !== 'step') rows.push([t('extraNotes'), result.extra]);
  if (result.timing !== null) rows.push([t(result.mode === 'perform' ? 'rhythm' : 'onTime'), `${result.timing}%`]);
  if (result.playedBpm) rows.push([t('yourTempo'), `${result.playedBpm} BPM`]);
  rows.push([t('timeTaken'), `${result.duration} s`]);
  const issueNote = (i: PracticeResult['issues'][number]): string =>
    i.wrong > 0 ? t('issueWrong') : i.missed ? t('issueMissed') : i.timing === 'late' ? t('issueLate') : i.timing === 'early' ? t('issueEarly') : '';
  return (
    <div className="ac-result" role="dialog" aria-label="Practice result">
      <button type="button" className="ac-result__close" aria-label="Close result" onPointerDown={(e) => e.preventDefault()} onClick={() => academy().dismissResult()}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
      <div className={`ac-result__score${passed ? ' is-pass' : ''}`}>
        <b>{result.accuracy}%</b>
        <small>{MODE_NAME[result.mode]} · Accuracy</small>
        <span>{passed ? 'Pass ✓' : say({ id: 'passNeeds', p: { n: PASS_ACCURACY[result.mode] } }, lang)}</span>
        {result.range !== 'full' && <small>{say({ id: 'phraseOnly', p: { phrase: result.range.replace('phrase-', 'Phrase ') } }, lang)}</small>}
      </div>
      <div className="ac-result__body">
        <p className="ac-result__comment">{say({ id: result.commentKey }, lang)}</p>
        <dl className="ac-result__rows">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {result.issues.length > 0 && (
          <p className="ac-result__issues">
            {t('look')}:{' '}
            {result.issues.slice(0, 6).map((i) => {
              const n = song.notes[i.index];
              return (
                <span key={i.index} className="ac-tag">
                  P{n.phrase + 1} {n.name} “{n.lyric}” {issueNote(i)}
                </span>
              );
            })}
          </p>
        )}
        <div className="ac-result__actions">
          <button type="button" className="ac-btn" onPointerDown={(e) => e.preventDefault()} onClick={() => academy().start()}>
            <FontAwesomeIcon icon={faRotateLeft} /> {t('again')}
          </button>
          {next !== result.mode && (
            <button type="button" className="ac-btn ac-btn--go" onPointerDown={(e) => e.preventDefault()} onClick={() => academy().setMode(next)}>
              {t('nextMode')}: {MODE_NAME[next]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- right of the screen: transport and practice settings ---------- */

function PracticeColumn() {
  const status = useAcademy((s) => s.status);
  const mode = useAcademy((s) => s.mode);
  const tempo = useAcademy((s) => s.tempo);
  const metronome = useAcademy((s) => s.metronome);
  const guide = useAcademy((s) => s.guideMelody);
  const def = academy().compiled.def;
  const { t } = useLang();
  const running = status === 'running' || status === 'countin';
  const canPause = mode === 'watch' || mode === 'guided';
  const playLabel = running ? (canPause ? 'Pause' : 'Running') : status === 'paused' ? 'Resume' : 'Start';
  const a = academy();
  return (
    <Section title="Practice" className="ac-sec--practice">
      <div className="ac-transport">
        <PanelButton
          variant="wide"
          label={playLabel}
          ariaLabel={playLabel}
          cap={<FontAwesomeIcon icon={running ? faPause : faPlay} />}
          led={running}
          ledColor="green"
          disabled={running && !canPause}
          onPress={() => a.togglePlay()}
        />
        <PanelButton variant="wide" label="Restart" cap={<FontAwesomeIcon icon={faRotateLeft} />} onPress={() => a.start()} />
      </div>
      <div className="ac-transport">
        {mode === 'step' && (
          <>
            <PanelButton variant="wide" label={t('hearNote')} ariaLabel="Listen to the note" cap={<FontAwesomeIcon icon={faVolumeHigh} />} onPress={() => a.listen()} />
            <PanelButton variant="wide" label={t('hearPhrase')} ariaLabel="Listen to the phrase" cap={<FontAwesomeIcon icon={faEarListen} />} onPress={() => a.previewPhrase()} />
          </>
        )}
        {mode === 'perform' && (
          <PanelButton variant="wide" label="Finish" ariaLabel="Finish the performance" cap={<FontAwesomeIcon icon={faFlagCheckered} />} disabled={status !== 'running'} onPress={() => a.finishPerformance()} />
        )}
        {mode !== 'perform' && (
          <PanelButton variant="wide" label={t('repeatPhrase')} ariaLabel="Repeat this phrase" cap={<FontAwesomeIcon icon={faRepeat} />} onPress={() => a.repeatPhrase()} />
        )}
      </div>
      <div className="ac-tempo">
        <span className="ac-field__label">{t('tempo')}</span>
        <div className="ac-tempo__row">
          <PanelButton variant="small" cap={<FontAwesomeIcon icon={faMinus} />} ariaLabel={`Slower, now ${tempo}`} repeat onPress={() => a.setTempo(tempo - 2)} />
          <output className="ac-tempo__value">
            {tempo}
            <small>BPM</small>
          </output>
          <PanelButton variant="small" cap={<FontAwesomeIcon icon={faPlus} />} ariaLabel={`Faster, now ${tempo}`} repeat onPress={() => a.setTempo(tempo + 2)} />
        </div>
        <Segmented<number>
          label="Tempo presets"
          value={tempo}
          options={[40, def.tempo.default, 80, 100].map((v) => ({ value: v, label: String(v) }))}
          onChange={(v) => a.setTempo(v)}
        />
      </div>
      <Toggle label={t('metronome')} on={metronome} onChange={(v) => a.setMetronome(v)} />
      {mode === 'guided' && <Toggle label={t('guideMelody')} on={guide} onChange={(v) => a.setGuideMelody(v)} hint="Guide melody" />}
    </Section>
  );
}

/* ---- far right: progress, display and input ------------------------ */

function fmtDuration(sec: number, lang: Lang): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} ${ui('minutes', lang)}`;
  return `${Math.floor(m / 60)} ${ui('hours', lang)} ${m % 60} ${ui('minutes', lang)}`;
}

function ProgressColumn() {
  const progress = useAcademy((s) => s.progress);
  const songId = useAcademy((s) => s.songId);
  const fingers = useAcademy((s) => s.showFingers);
  const names = useAcademy((s) => s.showNames);
  const input = useAcademy((s) => s.input);
  const labels = useApp((s) => s.noteLabels);
  const midiStatus = useApp((s) => s.midiStatus);
  const midiInputs = useApp((s) => s.midiInputs);
  const midiInput = useApp((s) => s.midiInput);
  const { lang, t } = useLang();
  const song = academy().compiled;
  const lesson = progress.lessons[songId];
  const today = progress.daily[dayKey(new Date())] ?? 0;
  const completion = Math.round(lessonCompletion(lesson) * 100);
  const weak = weakestNotes(lesson, 3);
  const recent = progress.sessions.filter((s) => s.lessonId === songId).slice(-3).reverse();
  const connected = midiInputs.filter((i) => i.connected);
  return (
    <Section title="Progress" className="ac-sec--progress">
      <div className="ac-exit">
        <PanelButton variant="wide" label={t('back')} ariaLabel="Back to the instrument" cap={<FontAwesomeIcon icon={faArrowLeft} />} onPress={closeAcademy} />
      </div>
      <div className="ac-stats">
        <div>
          <small>{t('today')}</small>
          <b>{fmtDuration(today, lang)}</b>
        </div>
        <div>
          <small>{t('total')}</small>
          <b>{fmtDuration(progress.totalSeconds, lang)}</b>
        </div>
        <div>
          <small>Lesson</small>
          <b>{completion}%</b>
        </div>
      </div>
      <div className="ac-progressbar" aria-label={`Lesson ${completion}% complete`}>
        <span style={{ width: `${completion}%` }} />
      </div>
      {weak.length > 0 && (
        <p className="ac-weak">
          {t('weakNotes')}:{' '}
          {weak.map((i) => (
            <span key={i} className="ac-tag" title={`Phrase ${song.notes[i].phrase + 1}`}>
              P{song.notes[i].phrase + 1} {song.notes[i].name} “{song.notes[i].lyric}”
            </span>
          ))}
        </p>
      )}
      {recent.length > 0 && (
        <ul className="ac-recent" aria-label="Recent practice">
          {recent.map((r) => (
            <li key={r.at}>
              <span>{MODE_NAME[r.mode].split(' ')[0]}</span>
              <span>{r.range === 'full' ? t('wholeSong') : r.range.replace('phrase-', 'P')}</span>
              <b>{r.accuracy}%</b>
            </li>
          ))}
        </ul>
      )}
      <div className="ac-settings">
        <Toggle label={t('fingers')} on={fingers} onChange={(v) => academy().setShowFingers(v)} />
        <Toggle label={t('noteNames')} on={names} onChange={(v) => academy().setShowNames(v)} />
        <Toggle label={t('allLabels')} on={labels !== 'off'} onChange={(v) => act.setNoteLabels(v ? 'note' : 'off')} />
      </div>
      <div className="ac-field">
        <span className="ac-field__label">Input</span>
        <Segmented
          label="Input"
          value={input}
          options={[
            { value: 'all', label: t('all') },
            { value: 'computer', label: 'Computer', title: 'Mouse, touch and computer keys' },
            { value: 'midi', label: 'MIDI' },
          ]}
          onChange={(v) => academy().setInput(v)}
        />
        {midiStatus === 'ready' && connected.length > 0 ? (
          <select
            className="ac-select"
            aria-label="MIDI device"
            value={midiInput}
            onChange={(e) => {
              act.selectMidiInput(e.target.value);
              e.target.blur(); // keep the computer keys playing notes
            }}
          >
            <option value="all">{t('allMidi')}</option>
            {connected.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        ) : (
          <small className="ac-midi-note">
            {t(midiStatus === 'unsupported' ? 'midiUnsupported' : midiStatus === 'denied' ? 'midiDenied' : 'midiNone')}
          </small>
        )}
      </div>
    </Section>
  );
}
