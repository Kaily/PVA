import { Emitter } from '../core/Emitter';

/**
 * MidiManager — Web MIDI input.
 *
 * Parses the raw byte stream into musical events; it knows nothing about the
 * sound engine. KeyboardController subscribes and routes the events.
 *
 * Handled: Note On/Off (velocity, Note On with velocity 0 = Off), CC, pitch
 * bend (14-bit), channel aftertouch, program change, plus hot-plug of
 * devices. Running status and real-time bytes are handled by the browser.
 */

export type MidiStatus = 'unsupported' | 'idle' | 'requesting' | 'denied' | 'ready';

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

export type MidiEvents = {
  noteOn: { note: number; velocity: number; channel: number };
  noteOff: { note: number; channel: number };
  cc: { controller: number; value: number; channel: number };
  /** −1 … +1 */
  pitchBend: { value: number; channel: number };
  /** 0 … 1 */
  aftertouch: { value: number; channel: number };
  program: { program: number; channel: number };
  /** Device list or permission state changed. */
  devices: { status: MidiStatus; inputs: MidiInputInfo[]; error?: string };
  /** A device that was in use has gone away. */
  disconnected: { id: string; name: string };
  /** Any message arrived (for the activity LED). */
  activity: { bytes: Uint8Array };
};

export const ALL_INPUTS = 'all';

export class MidiManager {
  readonly events = new Emitter<MidiEvents>();
  status: MidiStatus = 'idle';

  private access: MIDIAccess | null = null;
  private selected: string = ALL_INPUTS;
  private readonly bound = new Map<string, MIDIInput>();

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  /** Ask the browser for MIDI access. Safe to call again after a denial. */
  async init(): Promise<void> {
    if (!this.supported) {
      this.status = 'unsupported';
      this.publish();
      return;
    }
    if (this.status === 'requesting' || this.status === 'ready') return;
    this.status = 'requesting';
    this.publish();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = (e) => this.onStateChange(e as MIDIConnectionEvent);
      this.status = 'ready';
      this.rebind();
      this.publish();
    } catch (err) {
      this.status = 'denied';
      this.publish(err instanceof Error ? err.message : 'MIDI access was refused.');
    }
  }

  inputs(): MidiInputInfo[] {
    if (!this.access) return [];
    const list: MidiInputInfo[] = [];
    this.access.inputs.forEach((input) => {
      list.push({
        id: input.id,
        name: input.name || 'MIDI input',
        manufacturer: input.manufacturer || '',
        connected: input.state === 'connected',
      });
    });
    return list;
  }

  get selectedInput(): string {
    return this.selected;
  }

  /** `ALL_INPUTS` listens to every connected device. */
  selectInput(id: string): void {
    this.selected = id;
    this.rebind();
    this.publish();
  }

  private rebind(): void {
    if (!this.access) return;
    for (const input of this.bound.values()) input.onmidimessage = null;
    this.bound.clear();
    this.access.inputs.forEach((input) => {
      if (input.state !== 'connected') return;
      if (this.selected !== ALL_INPUTS && input.id !== this.selected) return;
      input.onmidimessage = (e) => {
        if (e.data) this.handleMessage(e.data);
      };
      this.bound.set(input.id, input);
    });
  }

  private onStateChange(e: MIDIConnectionEvent): void {
    const port = e.port;
    if (port && port.type === 'input' && port.state === 'disconnected' && this.bound.has(port.id)) {
      this.events.emit('disconnected', { id: port.id, name: port.name || 'MIDI input' });
    }
    this.rebind();
    this.publish();
  }

  private publish(error?: string): void {
    this.events.emit('devices', { status: this.status, inputs: this.inputs(), error });
  }

  /** Decode one MIDI message. Public so tests and virtual sources can inject data. */
  handleMessage(data: Uint8Array): void {
    if (data.length === 0) return;
    const status = data[0];
    if (status >= 0xf0) return; // system messages: clock, active sensing, sysex …
    this.events.emit('activity', { bytes: data });

    const type = status & 0xf0;
    const channel = status & 0x0f;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;

    switch (type) {
      case 0x90:
        if (d2 > 0) this.events.emit('noteOn', { note: d1, velocity: d2, channel });
        else this.events.emit('noteOff', { note: d1, channel });
        break;
      case 0x80:
        this.events.emit('noteOff', { note: d1, channel });
        break;
      case 0xb0:
        this.events.emit('cc', { controller: d1, value: d2, channel });
        break;
      case 0xe0: {
        const raw = (d2 << 7) | d1; // 0 … 16383, centre 8192
        const value = raw >= 8192 ? (raw - 8192) / 8191 : (raw - 8192) / 8192;
        this.events.emit('pitchBend', { value, channel });
        break;
      }
      case 0xd0:
        this.events.emit('aftertouch', { value: d1 / 127, channel });
        break;
      case 0xc0:
        this.events.emit('program', { program: d1, channel });
        break;
      default:
        break; // 0xA0 polyphonic aftertouch: not used by this instrument
    }
  }
}

/** Human-readable form of a message for the MIDI monitor line. */
export function describeMidi(data: Uint8Array): string {
  const status = data[0] ?? 0;
  const ch = (status & 0x0f) + 1;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;
  switch (status & 0xf0) {
    case 0x90:
      return d2 > 0 ? `Ch${ch} Note On ${d1} vel ${d2}` : `Ch${ch} Note Off ${d1}`;
    case 0x80:
      return `Ch${ch} Note Off ${d1}`;
    case 0xb0:
      return `Ch${ch} CC${d1} = ${d2}`;
    case 0xe0:
      return `Ch${ch} Pitch Bend ${((d2 << 7) | d1) - 8192}`;
    case 0xd0:
      return `Ch${ch} Aftertouch ${d1}`;
    case 0xc0:
      return `Ch${ch} Program ${d1 + 1}`;
    default:
      return `Ch${ch} 0x${status.toString(16).toUpperCase()}`;
  }
}
