import { useEffect, useRef, useState } from 'react';
import { pad } from '../../core/math';
import { toneById } from '../../data/tones';
import { noteName } from '../../music/notes';
import { services } from '../../services';
import * as act from '../../state/actions';
import { setCursor } from '../../state/actions';
import { MAIN_GRID, PAGE_GROUPS, PAGE_TITLE, PARAMS, activateParam, type ParamGroup } from '../../state/params';
import { PART_LABEL, type AppState, type LcdPage, type PartId } from '../../state/appState';
import { beatBus } from '../beat';
import { useApp, useFrame } from '../hooks';
import { EqGraph } from './EqGraph';
import { TonePage } from './TonePage';

/**
 * The centre display. Everything on it is drawn from panel state; the three
 * live read-outs (velocity bar, beat dots, voice count) are updated
 * imperatively so they cost nothing while playing.
 */
export function Lcd() {
  const power = useApp((s) => s.power);
  const booting = useApp((s) => s.booting);
  const page = useApp((s) => s.lcdPage);

  return (
    <div className={`lcd${power ? '' : ' lcd--off'}`}>
      <div className="lcd__screen" aria-live="off">
        {power && booting && <BootScreen />}
        {power && !booting && (
          <>
            <StatusBar />
            <div className="lcd__page" key={page}>
              <Page page={page} />
            </div>
            <MessageLine />
            <Popup />
          </>
        )}
      </div>
      <div className="lcd__glare" aria-hidden="true" />
    </div>
  );
}

function Page({ page }: { page: LcdPage }) {
  switch (page) {
    case 'main':
      return <MainPage />;
    case 'tones':
      return <TonePage />;
    case 'midi':
      return <MidiPage />;
    case 'monitor':
      return <MonitorPage />;
    case 'eq':
      return (
        <>
          <EqGraph />
          <ParamList groups={PAGE_GROUPS.eq ?? []} label="Equaliser" compact />
        </>
      );
    default:
      return <ParamList groups={PAGE_GROUPS[page] ?? []} label={PAGE_TITLE[page]} />;
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                 */
/* ------------------------------------------------------------------ */

function BootScreen() {
  const load = useApp((s) => s.load);
  const tone = useApp((s) => toneById(s.parts.upper1.toneId)?.name ?? '');
  // During boot only the core layer matters for "ready".
  const corePart = load.total > 0 ? Math.min(1, (load.loaded / load.total) * 6) : 0;
  return (
    <div className="lcd-boot">
      <div className="lcd-boot__mark">
        PVA<span>61</span>
      </div>
      <div className="lcd-boot__sub">Professional Arranger</div>
      <div className="lcd-boot__bar">
        <span style={{ transform: `scaleX(${load.phase === 'core' ? corePart : load.phase === 'idle' ? 0 : 1})` }} />
      </div>
      <div className="lcd-boot__text">{load.phase === 'error' ? 'Sample library not found' : `Loading ${tone}`}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* status bar                                                           */
/* ------------------------------------------------------------------ */

function StatusBar() {
  const midiStatus = useApp((s) => s.midiStatus);
  const connected = useApp((s) => s.midiInputs.filter((i) => i.connected).length);
  const page = useApp((s) => s.lcdPage);
  const part = useApp((s) => s.selectedPart);
  const voices = useRef<HTMLSpanElement>(null);
  const last = useRef(-1);
  const tick = useRef(0);

  useFrame((_now, dt) => {
    tick.current += dt;
    if (tick.current < 120) return;
    tick.current = 0;
    const n = services().voices.stats().active;
    if (n !== last.current && voices.current) {
      last.current = n;
      voices.current.textContent = pad(n, 2);
    }
  });

  const perPart = page === 'tones' || page === 'part' || page === 'dsp';
  const title = perPart ? `${PAGE_TITLE[page]} · ${PART_LABEL[part]}` : PAGE_TITLE[page];
  const midiText =
    midiStatus === 'ready'
      ? connected > 0
        ? 'MIDI CONNECTED'
        : 'MIDI no device'
      : midiStatus === 'denied'
        ? 'MIDI blocked'
        : midiStatus === 'unsupported'
          ? 'MIDI n/a'
          : 'MIDI …';

  return (
    <div className="lcd-status">
      <span className="lcd-status__title">{title}</span>
      <span className={`lcd-status__midi${midiStatus === 'ready' && connected > 0 ? ' is-on' : ''}`}>{midiText}</span>
      <span className="lcd-status__voices">
        Voices <span ref={voices}>00</span>/{services().voices.maxVoices}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* main (performance) page                                              */
/* ------------------------------------------------------------------ */

const PART_TAG: Record<PartId, string> = { upper1: 'U1', upper2: 'U2', lower: 'L' };

/** One line per extra part: tone, and whether the part sounds. */
function PartLine({ id }: { id: 'upper2' | 'lower' }) {
  const tone = useApp((s) => toneById(s.parts[id].toneId));
  const on = useApp((s) => (id === 'upper2' ? s.layerOn : s.splitOn));
  const selected = useApp((s) => s.selectedPart === id);
  const split = useApp((s) => s.splitPoint);
  return (
    <button
      type="button"
      className={`lcd-part${on ? ' is-on' : ''}${selected ? ' is-selected' : ''}`}
      aria-label={`${PART_LABEL[id]}: ${tone?.name ?? ''}, ${on ? 'on' : 'off'}`}
      onPointerDown={(e) => {
        e.preventDefault();
        act.selectPart(id);
      }}
    >
      <span className="lcd-part__tag">{PART_TAG[id]}</span>
      <span className="lcd-part__num">{pad(tone?.number ?? 0, 3)}</span>
      <span className="lcd-part__name">{tone?.name ?? '—'}</span>
      <span className="lcd-part__state">{on ? (id === 'lower' ? `below ${noteName(split)}` : 'ON') : 'OFF'}</span>
    </button>
  );
}

/** Small lamps for the performance functions. */
function Flags() {
  const arp = useApp((s) => s.arp.on);
  const harmony = useApp((s) => s.harmonyOn);
  const dsp = useApp((s) => s.parts.upper1.dspOn || (s.layerOn && s.parts.upper2.dspOn) || (s.splitOn && s.parts.lower.dspOn));
  const chorus = useApp((s) => s.chorusOn);
  const delay = useApp((s) => s.delayOn);
  const eq = useApp((s) => s.eqPreset !== 'flat');
  const flag = (label: string, on: boolean) => <span className={on ? 'is-on' : ''}>{label}</span>;
  return (
    <div className="lcd-flags" aria-hidden="true">
      {flag('ARP', arp)}
      {flag('HARM', harmony)}
      {flag('DSP', dsp)}
      {flag('CHO', chorus)}
      {flag('DLY', delay)}
      {flag('EQ', eq)}
    </div>
  );
}

function MainPage() {
  const tone = useApp((s) => toneById(s.parts.upper1.toneId));
  const upperSelected = useApp((s) => s.selectedPart === 'upper1');
  const chord = useApp((s) => s.chord);
  const cursor = useApp((s) => s.cursor);
  // Subscribe to everything the tiles print.
  const snapshot = useApp(tileSignature);
  const state = services().store.get();
  void snapshot;

  return (
    <div className="lcd-main">
      <div className="lcd-main__head">
        <div className="lcd-tone">
          <button
            type="button"
            className={`lcd-tone__main${upperSelected ? ' is-selected' : ''}`}
            aria-label={`Upper 1: ${tone?.name ?? ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              act.selectPart('upper1');
            }}
          >
            <span className="lcd-tone__cat">
              <b>U1</b>
              {tone?.category ?? ''}
            </span>
            <span className="lcd-tone__name">
              <span className="lcd-tone__num">{pad(tone?.number ?? 0, 3)}</span>
              {tone?.name ?? 'No tone'}
            </span>
          </button>
          <PartLine id="upper2" />
          <PartLine id="lower" />
          <VelocityBar />
        </div>
        <div className="lcd-side">
          <div className="lcd-chord">
            <div className="lcd-chord__label">Chord</div>
            <div className={`lcd-chord__name${chord ? '' : ' is-empty'}`}>{chord ?? '– –'}</div>
          </div>
          <Flags />
        </div>
      </div>
      <div className="lcd-tiles" role="listbox" aria-label="Performance settings">
        {MAIN_GRID.flat().map((id) => {
          const p = PARAMS[id];
          const selected = cursor === id;
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`lcd-tile${selected ? ' is-selected' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                if (selected) activateParam(id);
                else setCursor(id);
              }}
            >
              <span className="lcd-tile__label">{p.short ?? p.label}</span>
              <span className="lcd-tile__value">
                {id === 'tempo' ? <TempoValue text={p.format(state)} /> : p.format(state)}
              </span>
              {id === 'beats' && <BeatDots count={state.metronomeBeats} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A string that changes whenever any tile value changes. */
function tileSignature(s: AppState): string {
  return MAIN_GRID.flat()
    .map((id) => PARAMS[id].format(s))
    .join('|');
}

function TempoValue({ text }: { text: string }) {
  return (
    <>
      {/* quarter note — drawn, because the display face has no music symbols */}
      <svg className="lcd-tile__note" viewBox="0 0 10 20" aria-hidden="true">
        <ellipse cx="3.6" cy="16.2" rx="3.5" ry="2.6" transform="rotate(-22 3.6 16.2)" />
        <rect x="6.2" y="1" width="1.3" height="15.2" />
      </svg>
      <span className="lcd-tile__unit">=</span>
      {text}
    </>
  );
}

function VelocityBar() {
  const fill = useRef<HTMLSpanElement>(null);
  const level = useRef(0);
  const shown = useRef(-1);

  useEffect(
    () =>
      services().controller.events.on('velocity', (v) => {
        level.current = v / 127;
      }),
    [],
  );

  useFrame((_now, dt) => {
    // Jump up with the strike, fall back smoothly.
    level.current = Math.max(0, level.current - dt / 900);
    const v = Math.round(level.current * 100);
    if (v !== shown.current && fill.current) {
      shown.current = v;
      fill.current.style.transform = `scaleX(${v / 100})`;
    }
  });

  return (
    <div className="lcd-vel" aria-hidden="true">
      <span className="lcd-vel__label">Velocity</span>
      <span className="lcd-vel__track">
        <span ref={fill} className="lcd-vel__fill" />
      </span>
    </div>
  );
}

function BeatDots({ count }: { count: number }) {
  const row = useRef<HTMLSpanElement>(null);
  const shown = Math.min(Math.max(count, 1), 8);

  useEffect(() => {
    const clear = (): void => {
      row.current?.querySelectorAll('.is-on').forEach((n) => n.classList.remove('is-on'));
    };
    const offBeat = beatBus.on('beat', ({ inBar }) => {
      clear();
      const dots = row.current?.children;
      if (!dots || dots.length === 0) return;
      const i = inBar < 0 ? 0 : inBar % dots.length;
      const dot = dots[i] as HTMLElement;
      dot.classList.add('is-on');
      window.setTimeout(() => dot.classList.remove('is-on'), 110);
    });
    const offStop = beatBus.on('stop', clear);
    return () => {
      offBeat();
      offStop();
    };
  }, [shown]);

  return (
    <span ref={row} className="lcd-beats" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <i key={i} className={i === 0 && count > 0 ? 'is-accent' : ''} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* parameter lists (function menu, part, effects, arpeggiator …)        */
/* ------------------------------------------------------------------ */

function ParamList({ groups, label, compact }: { groups: ParamGroup[]; label: string; compact?: boolean }) {
  const cursor = useApp((s) => s.cursor);
  const signature = useApp((s) =>
    groups
      .flatMap((g) => g.params)
      .map((id) => PARAMS[id].format(s))
      .join('|'),
  );
  void signature;
  const state = services().store.get();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('.is-selected');
    const box = list.current;
    if (!row || !box) return;
    // Keep the cursor row (and its group title) inside the visible window.
    const top = row.offsetTop; // .lcd-menu is the offset parent
    const margin = row.offsetHeight * 1.2;
    if (top - margin < box.scrollTop) box.scrollTop = Math.max(0, top - margin);
    else if (top + row.offsetHeight + margin > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + row.offsetHeight + margin - box.clientHeight;
    }
  }, [cursor]);

  return (
    <div className={`lcd-menu${compact ? ' lcd-menu--compact' : ''}`} ref={list} role="listbox" aria-label={label}>
      {groups.map((group) => (
        <div className="lcd-menu__group" key={group.title}>
          {!compact && <div className="lcd-menu__title">{group.title}</div>}
          {group.params.map((id) => {
            const p = PARAMS[id];
            if (p.kind === 'info') {
              return (
                <div key={id} className="lcd-row lcd-row--info">
                  <span className="lcd-row__label">{p.label}</span>
                  <span className="lcd-row__value">{p.format(state)}</span>
                </div>
              );
            }
            const selected = cursor === id;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`lcd-row${selected ? ' is-selected' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (selected || p.kind === 'link') activateParam(id);
                  setCursor(id);
                }}
              >
                <span className="lcd-row__label">{p.label}</span>
                <span className="lcd-row__value">{p.format(state)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MIDI page                                                            */
/* ------------------------------------------------------------------ */

function MidiPage() {
  const status = useApp((s) => s.midiStatus);
  const inputs = useApp((s) => s.midiInputs);
  const selected = useApp((s) => s.midiInput);
  const error = useApp((s) => s.midiError);
  const last = useApp((s) => s.midiLast);
  const cursor = useApp((s) => s.cursor);
  const p = PARAMS.midiInput;
  const state = services().store.get();

  const statusText: Record<typeof status, string> = {
    unsupported: 'This browser has no Web MIDI. Use Chrome or Edge.',
    idle: 'Starting MIDI…',
    requesting: 'Waiting for permission to use MIDI devices…',
    denied: `MIDI access was refused. Allow it in the browser's site settings, then press ENTER to retry.`,
    ready: inputs.some((i) => i.connected) ? 'MIDI CONNECTED' : 'No MIDI device found. Plug one in — it is detected automatically.',
  };

  return (
    <div className="lcd-midi">
      <div className={`lcd-midi__status${status === 'ready' && inputs.some((i) => i.connected) ? ' is-on' : ''}`}>
        {statusText[status]}
        {status === 'denied' && error ? ` (${error})` : ''}
      </div>
      <button
        type="button"
        className={`lcd-row${cursor === 'midiInput' ? ' is-selected' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          setCursor('midiInput');
          activateParam('midiInput');
        }}
      >
        <span className="lcd-row__label">{p.label}</span>
        <span className="lcd-row__value">{p.format(state)}</span>
      </button>
      <ul className="lcd-midi__list">
        {inputs.length === 0 && <li className="is-dim">—</li>}
        {inputs.slice(0, 3).map((i) => (
          <li key={i.id} className={i.connected ? '' : 'is-dim'}>
            <span className={`lcd-dot${i.connected && (selected === 'all' || selected === i.id) ? ' is-on' : ''}`} />
            {i.name}
            {i.manufacturer ? <em> {i.manufacturer}</em> : null}
          </li>
        ))}
      </ul>
      <div className="lcd-midi__monitor">
        <span>Last message</span>
        <b>{last ?? '—'}</b>
      </div>
      <div className="lcd-midi__map">
        <span>CC64 sustain</span>
        <span>CC66 sostenuto</span>
        <span>CC67 soft</span>
        <span>CC1 modulation</span>
        <span>CC7 volume</span>
        <span>CC11 expression</span>
        <span>CC0 bank + program change: tone</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* system monitor                                                       */
/* ------------------------------------------------------------------ */

interface MonitorData {
  rows: [string, string][];
}

function readMonitor(): MonitorData {
  const { engine, voices, samples, store, instruments } = services();
  const s = store.get();
  const lat = engine.latencyInfo();
  const v = voices.stats();
  const sm = samples.stats();
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const total = lat.baseMs + (lat.outputMs ?? 0);
  const mem = instruments.memory();
  const libraryText: Record<typeof s.library, string> = {
    idle: 'not loaded',
    loading: 'loading…',
    ready: `${mem.soundFontBuffers} samples decoded, ${mem.soundFontMb.toFixed(0)} MB`,
    error: 'could not be loaded',
  };
  return {
    rows: [
      ['Audio', `${s.engine}, ${(lat.sampleRate / 1000).toFixed(1)} kHz, ${engine.usingWorklet ? 'worklet master' : 'fallback master'}`],
      [
        'Latency',
        `${total.toFixed(1)} ms (buffer ${lat.baseMs.toFixed(1)}${lat.outputMs !== null ? ` + device ${lat.outputMs.toFixed(1)}` : ''})`,
      ],
      ['Voices', `${v.active} / ${v.max} · ${v.layers} layers · ${v.stolen} stolen`],
      ['Audio CPU', engine.cpuLoad !== null ? `${Math.round(engine.cpuLoad * 100)} %` : 'not reported by this browser'],
      ['Grand', `${sm.buffers} samples, ${sm.megabytes.toFixed(0)} MB${sm.pending ? `, ${sm.pending} loading` : ''}${sm.failed ? `, ${sm.failed} missing` : ''}`],
      ['Library', `${libraryText[s.library]}${mem.modelMb > 0 ? ` · models ${mem.modelMb.toFixed(0)} MB` : ''}`],
      ['Memory', heap ? `${(heap.usedJSHeapSize / 1048576).toFixed(0)} MB script heap` : 'not reported by this browser'],
      ['MIDI', `${s.midiStatus}, ${s.midiInputs.filter((i) => i.connected).length} device(s)`],
    ],
  };
}

function MonitorPage() {
  const [data, setData] = useState<MonitorData>(readMonitor);
  useEffect(() => {
    const id = window.setInterval(() => setData(readMonitor()), 400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <dl className="lcd-monitor">
      {data.rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* message line + popup                                                 */
/* ------------------------------------------------------------------ */

const PAGE_HINT: Partial<Record<LcdPage, string>> = {
  tones: '▲▼◀▶ or wheel: select   ENTER: done',
  eq: 'Drag a band, or ▲▼ select and ◀▶ change',
  midi: 'EXIT back',
  monitor: 'EXIT back',
};

function MessageLine() {
  const message = useApp((s) => s.message);
  const unlocked = useApp((s) => s.audioUnlocked);
  const load = useApp((s) => s.load);
  const library = useApp((s) => s.library);
  const loadingTone = useApp((s) => (s.toneLoading ? (toneById(s.toneLoading)?.name ?? null) : null));
  const page = useApp((s) => s.lcdPage);

  let text = message ?? '';
  let tone = 'info';
  if (!unlocked) {
    text = 'Press any key or click the keyboard to start the sound';
    tone = 'warn';
  } else if (!message && page !== 'main') {
    text = PAGE_HINT[page] ?? '▲▼ select   ◀▶ or wheel change   EXIT back';
  }
  const percent = load.total > 0 ? Math.round((load.loaded / load.total) * 100) : 0;
  let right: string | null = null;
  if (loadingTone) right = `Loading ${loadingTone}…`;
  else if (load.phase === 'library' || load.phase === 'core') right = `Loading grand piano… ${percent}%`;
  else if (library === 'loading') right = 'Loading tone library…';
  else if (library === 'error') right = 'Tone library missing';
  else if (load.phase === 'done' && load.failed > 0) right = `${load.failed} samples missing`;

  return (
    <div className={`lcd-msg lcd-msg--${tone}`} role="status">
      <span className="lcd-msg__text">{text}</span>
      {right && <span className="lcd-msg__load">{right}</span>}
    </div>
  );
}

function Popup() {
  const popup = useApp((s) => s.popup);
  if (!popup) return null;
  return (
    <div className="lcd-popup" key={popup.key}>
      <div className="lcd-popup__label">{popup.label}</div>
      <div className="lcd-popup__value">{popup.value}</div>
    </div>
  );
}
