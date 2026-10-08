import { useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCaretDown,
  faCaretLeft,
  faCaretRight,
  faCaretUp,
  faExpand,
  faCompress,
  faKeyboard,
  faMinus,
  faPlus,
  faPowerOff,
  faStar,
} from '@fortawesome/free-solid-svg-icons';
import { CATEGORY_LABEL, CATEGORY_ORDER, toneById } from '../../data/tones';
import { services } from '../../services';
import * as act from '../../state/actions';
import { PART_IDS, PART_LABEL, type PartId } from '../../state/appState';
import { activateSelected, adjustSelected, exitPage, moveCursor, toggleMenu } from '../../state/params';
import { beatBus } from '../beat';
import { DataWheel } from '../controls/DataWheel';
import { Knob } from '../controls/Knob';
import { PanelButton } from '../controls/PanelButton';
import { StereoMeter } from '../controls/StereoMeter';
import { useApp } from '../hooks';
import { Lcd } from '../lcd/Lcd';

/* The upper control panel, section by section (left → right). */

function Section({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return (
    <section className={`sec ${className}`} aria-label={title}>
      <h2 className="sec__title">
        <span>{title}</span>
      </h2>
      <div className="sec__body">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* MASTER: power, volume, output meter                                */
/* ---------------------------------------------------------------- */

export function MasterSection() {
  const power = useApp((s) => s.power);
  const volume = useApp((s) => s.masterVolume);
  return (
    <Section title="Master" className="sec--master">
      <div className="master">
        <div className="master__left">
          <PanelButton
            variant="round"
            label="Power"
            cap={<FontAwesomeIcon icon={faPowerOff} />}
            led={power}
            ledColor="red"
            latched={power}
            onPress={act.togglePower}
          />
          <Knob label="Volume" value={volume} min={0} max={100} defaultValue={75} onChange={(v) => act.setMasterVolume(v)} />
        </div>
        <StereoMeter />
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- */
/* TONE: parts, layer / split, categories                             */
/* ---------------------------------------------------------------- */

function selectPartFromPanel(id: PartId): void {
  const s = services().store.get();
  if (s.selectedPart === id) {
    // second press: the part's mixer page
    act.togglePage('part', 'partVolume');
    return;
  }
  act.selectPart(id);
  if (s.lcdPage !== 'tones') act.popup(PART_LABEL[id].toUpperCase(), toneById(s.parts[id].toneId)?.name ?? '');
}

export function ToneSection() {
  const power = useApp((s) => s.power);
  const page = useApp((s) => s.lcdPage);
  const tab = useApp((s) => s.browserTab);
  const selected = useApp((s) => s.selectedPart);
  const layer = useApp((s) => s.layerOn);
  const split = useApp((s) => s.splitOn);
  const toneId = useApp((s) => s.parts[s.selectedPart].toneId);
  const favorite = useApp((s) => s.favorites.includes(s.parts[s.selectedPart].toneId));
  const browserCategory = useApp((s) => s.browserCategory);
  const tone = toneById(toneId);
  // While the browser is open the lamp follows the list that is shown, otherwise the tone that plays.
  const litCategory = page === 'tones' ? (tab === 'category' ? browserCategory : null) : (tone?.category ?? null);
  const lit = (on: boolean): boolean => power && on;

  return (
    <Section title="Tone" className="sec--tone">
      <div className="tone">
        <div className="tone__row">
          {PART_IDS.map((id) => (
            <PanelButton
              key={id}
              variant="slim"
              label={PART_LABEL[id]}
              ariaLabel={`Select ${PART_LABEL[id]}`}
              title="Select this part. Press again for its volume, pan and sends."
              led={lit(selected === id)}
              ledColor="green"
              latched={selected === id}
              disabled={!power}
              onPress={() => selectPartFromPanel(id)}
            />
          ))}
          <PanelButton
            variant="slim"
            label="Layer"
            ariaLabel="Layer: Upper 2 on or off"
            title="Upper 2 sounds together with Upper 1. Hold for its settings."
            led={lit(layer)}
            latched={layer}
            disabled={!power}
            onPress={act.toggleLayer}
            onHold={() => {
              act.toggleLayer();
              act.selectPart('upper2');
              act.showPage('part', 'partVolume');
            }}
          />
          <PanelButton
            variant="slim"
            label="Split"
            ariaLabel="Split: Lower part on or off"
            title="The keys below the split point play the Lower part. Hold to set the split point."
            led={lit(split)}
            latched={split}
            disabled={!power}
            onPress={act.toggleSplit}
            onHold={() => {
              act.toggleSplit();
              act.showPage('part', 'splitPoint');
            }}
          />
          <PanelButton
            variant="slim"
            label="Tone"
            ariaLabel="Tone browser"
            cap="List"
            led={lit(page === 'tones')}
            latched={page === 'tones'}
            disabled={!power}
            onPress={act.openToneBrowser}
          />
        </div>

        <div className="tone__cats" role="group" aria-label="Tone categories">
          {CATEGORY_ORDER.map((c) => (
            <PanelButton
              key={c}
              variant="cat"
              cap={CATEGORY_LABEL[c]}
              ariaLabel={`${CATEGORY_LABEL[c]} tones`}
              led={lit(litCategory === c)}
              disabled={!power}
              onPress={() => act.openCategory(c)}
            />
          ))}
        </div>

        <div className="tone__row tone__row--tools">
          <div className="pair">
            <span className="pair__legend">Tone</span>
            <div className="pair__buttons">
              <PanelButton variant="small" cap={<FontAwesomeIcon icon={faMinus} />} ariaLabel="Previous tone" repeat disabled={!power} onPress={() => act.nudgeTone(-1)} />
              <PanelButton variant="small" cap={<FontAwesomeIcon icon={faPlus} />} ariaLabel="Next tone" repeat disabled={!power} onPress={() => act.nudgeTone(+1)} />
            </div>
          </div>
          <PanelButton
            variant="slim"
            label="Fav"
            ariaLabel={favorite ? 'Remove the current tone from the favourites' : 'Add the current tone to the favourites'}
            cap={<FontAwesomeIcon icon={faStar} />}
            led={lit(favorite)}
            latched={favorite}
            disabled={!power}
            onPress={() => act.toggleFavorite(toneId)}
          />
          <PanelButton
            variant="slim"
            label="Fav list"
            ariaLabel="Favourite tones"
            led={lit(page === 'tones' && tab === 'favorites')}
            latched={page === 'tones' && tab === 'favorites'}
            disabled={!power}
            onPress={act.openFavorites}
          />
          <PanelButton
            variant="slim"
            label="Mixer"
            ariaLabel="Part mixer: volume, pan, octave and effect sends"
            led={lit(page === 'part')}
            latched={page === 'part'}
            disabled={!power}
            onPress={() => act.togglePage('part', 'partVolume')}
          />
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- */
/* EFFECTS / PERFORM                                                  */
/* ---------------------------------------------------------------- */

export function PerformSection() {
  const power = useApp((s) => s.power);
  const page = useApp((s) => s.lcdPage);
  const touch = useApp((s) => s.touchMode);
  const sustainLatch = useApp((s) => s.sustainLatch);
  const sustainDown = useApp((s) => s.sustainDown);
  const sostenuto = useApp((s) => s.sostenutoDown);
  const soft = useApp((s) => s.softDown);
  const reverb = useApp((s) => s.reverbOn);
  const chorus = useApp((s) => s.chorusOn);
  const delay = useApp((s) => s.delayOn);
  const dsp = useApp((s) => s.parts[s.selectedPart].dspOn);
  const eq = useApp((s) => s.eqPreset !== 'flat');
  const arp = useApp((s) => s.arp.on);
  const harmony = useApp((s) => s.harmonyOn);
  const labels = useApp((s) => s.noteLabels);
  const lit = (on: boolean): boolean => power && on;
  const hold = 'Hold for the settings.';

  return (
    <Section title="Perform" className="sec--perform">
      <div className="perform">
        <PanelButton
          label="Reverb"
          title={hold}
          led={lit(reverb)}
          latched={reverb}
          disabled={!power}
          onPress={act.toggleReverb}
          onHold={() => {
            act.toggleReverb();
            act.showPage('reverb', 'reverbType');
          }}
        />
        <PanelButton
          label="Chorus"
          title={hold}
          led={lit(chorus)}
          latched={chorus}
          disabled={!power}
          onPress={act.toggleChorus}
          onHold={() => {
            act.toggleChorus();
            act.showPage('chorus', 'chorusType');
          }}
        />
        <PanelButton
          label="Delay"
          title={hold}
          led={lit(delay)}
          latched={delay}
          disabled={!power}
          onPress={act.toggleDelay}
          onHold={() => {
            act.toggleDelay();
            act.showPage('delay', 'delayType');
          }}
        />
        <PanelButton
          label="DSP"
          ariaLabel="DSP insert effect of the selected part"
          title={hold}
          led={lit(dsp)}
          latched={dsp}
          disabled={!power}
          onPress={act.toggleDsp}
          onHold={() => {
            act.toggleDsp();
            act.showPage('dsp', 'partDspType');
          }}
        />
        <PanelButton
          label="EQ"
          ariaLabel="Master equaliser"
          led={lit(eq)}
          latched={page === 'eq'}
          disabled={!power}
          onPress={() => act.togglePage('eq', 'eqPreset')}
        />
        <PanelButton label="Touch" ariaLabel={`Touch response: ${touch}`} led={lit(touch !== 'off')} disabled={!power} onPress={act.cycleTouchMode} />
        <PanelButton
          label="Arpeggio"
          title={hold}
          led={lit(arp)}
          latched={arp}
          disabled={!power}
          onPress={act.toggleArp}
          onHold={() => {
            act.toggleArp();
            act.showPage('arp', 'arpMode');
          }}
        />
        <PanelButton
          label="Harmony"
          ariaLabel="Auto harmonize"
          title={hold}
          led={lit(harmony)}
          latched={harmony}
          disabled={!power}
          onPress={act.toggleHarmony}
          onHold={() => {
            act.toggleHarmony();
            act.showPage('harmony', 'harmonyMode');
          }}
        />
        <PanelButton label="Sustain" led={lit(sustainDown)} latched={sustainLatch} disabled={!power} onPress={act.toggleSustainLatch} />
        <PanelButton
          label="Labels"
          ariaLabel="Note labels on the keys"
          led={lit(labels !== 'off')}
          latched={labels !== 'off'}
          disabled={!power}
          onPress={act.cycleNoteLabels}
        />
        <ul className="pedals" aria-label="Pedal indicators">
          <li className={lit(sostenuto) ? 'is-on' : ''}>
            <i />
            Sost.
          </li>
          <li className={lit(soft) ? 'is-on' : ''}>
            <i />
            Soft
          </li>
        </ul>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- */
/* DISPLAY: LCD, data wheel, navigation                               */
/* ---------------------------------------------------------------- */

export function DisplaySection() {
  const power = useApp((s) => s.power);
  const page = useApp((s) => s.lcdPage);
  return (
    <section className="sec sec--display" aria-label="Display">
      <div className="display">
        <div className="display__left">
          <Lcd />
          <div className="display__keys">
            <PanelButton variant="wide" cap="Exit" ariaLabel="Exit to main screen" disabled={!power} onPress={exitPage} />
            <PanelButton
              variant="wide"
              cap="Function"
              ariaLabel="Function menu"
              led={power && page === 'menu'}
              latched={page === 'menu'}
              disabled={!power}
              onPress={toggleMenu}
            />
            <div className="display__spacer" />
            <PanelButton variant="small" cap={<FontAwesomeIcon icon={faCaretLeft} />} ariaLabel="Cursor left" repeat disabled={!power} onPress={() => moveCursor('left')} />
            <PanelButton variant="small" cap={<FontAwesomeIcon icon={faCaretUp} />} ariaLabel="Cursor up" repeat disabled={!power} onPress={() => moveCursor('up')} />
            <PanelButton variant="small" cap={<FontAwesomeIcon icon={faCaretDown} />} ariaLabel="Cursor down" repeat disabled={!power} onPress={() => moveCursor('down')} />
            <PanelButton variant="small" cap={<FontAwesomeIcon icon={faCaretRight} />} ariaLabel="Cursor right" repeat disabled={!power} onPress={() => moveCursor('right')} />
            <PanelButton variant="wide" cap="Enter" disabled={!power} onPress={activateSelected} />
          </div>
        </div>
        <div className="display__right">
          <span className="display__legend">Data</span>
          <DataWheel onStep={adjustSelected} />
          <div className="display__value">
            <PanelButton variant="small" cap={<FontAwesomeIcon icon={faMinus} />} ariaLabel="Value down" repeat disabled={!power} onPress={() => adjustSelected(-1)} />
            <PanelButton variant="small" cap={<FontAwesomeIcon icon={faPlus} />} ariaLabel="Value up" repeat disabled={!power} onPress={() => adjustSelected(+1)} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* TEMPO / PITCH                                                      */
/* ---------------------------------------------------------------- */

/** Four beat lamps: the first is red (bar accent), the rest green. */
function BeatLeds() {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clear = (): void => row.current?.querySelectorAll('.is-on').forEach((n) => n.classList.remove('is-on'));
    const offBeat = beatBus.on('beat', ({ inBar, accent, beats }) => {
      const lamps = row.current?.children;
      if (!lamps) return;
      clear();
      // Lamp 1 = accented beat; without an accent every beat uses lamp 2.
      const index = beats === 0 ? 1 : accent ? 0 : 1 + ((inBar - 1) % 3);
      const lamp = lamps[index] as HTMLElement;
      lamp.classList.add('is-on');
      window.setTimeout(() => lamp.classList.remove('is-on'), 95);
    });
    const offStop = beatBus.on('stop', clear);
    return () => {
      offBeat();
      offStop();
    };
  }, []);
  return (
    <div ref={row} className="beatleds" aria-hidden="true">
      <i className="beatleds__accent" />
      <i />
      <i />
      <i />
    </div>
  );
}

/** Right-hand column: tempo / pitch above, system below. */
export function ControlColumn() {
  return (
    <div className="sec-stack">
      <TempoSection />
      <SystemSection />
    </div>
  );
}

function TempoSection() {
  const power = useApp((s) => s.power);
  const metronome = useApp((s) => s.metronomeOn);
  const tempo = useApp((s) => s.tempo);
  const transpose = useApp((s) => s.transpose);
  const octave = useApp((s) => s.octave);
  const minus = <FontAwesomeIcon icon={faMinus} />;
  const plus = <FontAwesomeIcon icon={faPlus} />;

  return (
    <Section title="Tempo / Pitch" className="sec--tempo">
      <div className="tempo">
        <div className="pair">
          <span className="pair__legend">Tempo</span>
          <div className="pair__buttons">
            <PanelButton variant="small" cap={minus} ariaLabel={`Tempo down, now ${tempo}`} repeat disabled={!power} onPress={() => act.nudgeTempo(-1)} />
            <PanelButton variant="small" cap={plus} ariaLabel={`Tempo up, now ${tempo}`} repeat disabled={!power} onPress={() => act.nudgeTempo(+1)} />
          </div>
        </div>
        <PanelButton label="Tap tempo" cap="Tap" disabled={!power} onPress={act.tapTempo} />
        <div className="tempo__metro">
          <PanelButton label="Metronome" led={power && metronome} latched={metronome} disabled={!power} onPress={act.toggleMetronome} />
          <BeatLeds />
        </div>
        <div className="pair">
          <span className="pair__legend">Transpose</span>
          <div className="pair__buttons">
            <PanelButton variant="small" cap={minus} ariaLabel={`Transpose down, now ${transpose}`} repeat disabled={!power} onPress={() => act.nudgeTranspose(-1)} />
            <PanelButton variant="small" cap={plus} ariaLabel={`Transpose up, now ${transpose}`} repeat disabled={!power} onPress={() => act.nudgeTranspose(+1)} />
          </div>
        </div>
        <div className="pair">
          <span className="pair__legend">Octave</span>
          <div className="pair__buttons">
            <PanelButton variant="small" cap={minus} ariaLabel={`Octave down, now ${octave}`} disabled={!power} onPress={() => act.nudgeOctave(-1)} />
            <PanelButton variant="small" cap={plus} ariaLabel={`Octave up, now ${octave}`} disabled={!power} onPress={() => act.nudgeOctave(+1)} />
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- */
/* SYSTEM                                                             */
/* ---------------------------------------------------------------- */

function MidiLamp() {
  const lamp = useRef<HTMLSpanElement>(null);
  const connected = useApp((s) => s.power && s.midiStatus === 'ready' && s.midiInputs.some((i) => i.connected));
  useEffect(() => {
    let timer = 0;
    const off = services().midi.events.on('activity', () => {
      const el = lamp.current;
      if (!el || timer) return;
      el.classList.add('is-flash');
      timer = window.setTimeout(() => {
        el.classList.remove('is-flash');
        timer = 0;
      }, 70);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className={`midilamp${connected ? ' is-on' : ''}`}>
      <span ref={lamp} className="midilamp__led" aria-hidden="true" />
      <span className="midilamp__text">{connected ? 'MIDI connected' : 'MIDI'}</span>
    </div>
  );
}

function SystemSection() {
  const power = useApp((s) => s.power);
  const page = useApp((s) => s.lcdPage);
  const help = useApp((s) => s.helpOpen);
  const fullscreen = useApp((s) => s.fullscreen);
  return (
    <Section title="System" className="sec--system">
      <div className="system">
        <PanelButton
          label="MIDI"
          ariaLabel="MIDI devices"
          led={power && page === 'midi'}
          latched={page === 'midi'}
          disabled={!power}
          onPress={() => act.togglePage('midi', 'midiInput')}
        />
        <PanelButton variant="danger" label="All off" ariaLabel="All notes off (panic)" cap="Panic" disabled={!power} onPress={act.panic} />
        <PanelButton
          label="Key map"
          ariaLabel="Computer keyboard map"
          cap={<FontAwesomeIcon icon={faKeyboard} />}
          latched={help}
          onPress={() => act.toggleHelp()}
        />
        <PanelButton
          label="Screen"
          ariaLabel="Full screen"
          cap={<FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} />}
          latched={fullscreen}
          onPress={act.toggleFullscreen}
        />
        <MidiLamp />
      </div>
    </Section>
  );
}
