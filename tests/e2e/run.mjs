/**
 * End-to-end quality-bar checks (TASKS.md §76) in a real browser with a real
 * AudioContext: the Phase 1 piano checks, then the Phase 2 performance
 * features (tones, layer, split, effects, EQ, DSP, arpeggiator, harmony).
 *
 *   npm run build && npm run test:e2e
 *
 * Uses the installed Chrome/Edge by default. Set PVA_BROWSER to the path of a
 * Chromium binary to use another one. The script starts `vite preview` itself.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4179;
const URL = `http://localhost:${PORT}/?debug=1`;
const outDir = join(root, 'tests', 'e2e', 'out');
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ not found — run "npm run build" first.');
  process.exit(1);
}

/* ---------- tiny test harness ---------- */
const results = [];
let failed = 0;
let index = 0;
/** PVA_FROM=n skips the checks before number n (the two start-up checks always run) — for working on one area. */
const FROM = Number(process.env.PVA_FROM ?? 0);
async function test(name, fn) {
  index++;
  if (index > 2 && index < FROM) return;
  try {
    const info = await fn();
    results.push({ name, ok: true, info });
    console.log(`  ok    ${name}${info ? `  — ${info}` : ''}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, info: String(err && err.message ? err.message : err) });
    console.log(`  FAIL  ${name}\n        ${err && err.message ? err.message : err}`);
    // Do not let one failure cascade into the checks that follow: let go of everything.
    await page
      .evaluate(() => {
        const { controller } = window.__pva;
        controller.releaseSources('');
        controller.panic();
      })
      .catch(() => undefined);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- server + browser ---------- */
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const stop = () => {
  try {
    server.kill();
  } catch {
    /* ignore */
  }
};
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('preview server did not start');
}

const launchOptions = { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] };
if (process.env.PVA_BROWSER) launchOptions.executablePath = process.env.PVA_BROWSER;
else launchOptions.channel = process.env.PVA_CHANNEL || 'chrome';

await waitForServer();
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 1920, height: 1000 }, hasTouch: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/* ---------- helpers that run inside the page ---------- */
const P = {
  stats: () => page.evaluate(() => window.__pva.voices.stats()),
  snapshot: () => page.evaluate(() => window.__pva.voices.snapshot()),
  state: () => page.evaluate(() => window.__pva.store.get()),
  held: () => page.evaluate(() => window.__pva.controller.heldKeys()),
  peak: () => page.evaluate(() => Math.max(window.__pva.engine.meter.peakL, window.__pva.engine.meter.peakR)),
  /** Highest output peak seen over `ms`. */
  maxPeak: (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const m = window.__pva.engine.meter;
          let max = 0;
          const t0 = performance.now();
          const tick = () => {
            max = Math.max(max, m.peakL, m.peakR);
            if (performance.now() - t0 >= ms) resolve(max);
            else requestAnimationFrame(tick);
          };
          tick();
        }),
      ms,
    ),
  down: (key, vel = 90, src = 'test') => page.evaluate(([k, v, s]) => window.__pva.controller.keyDown(s, k, v), [key, vel, src]),
  up: (key, src = 'test') => page.evaluate(([k, s]) => window.__pva.controller.keyUp(s, k), [key, src]),
  midi: (...bytes) => page.evaluate((b) => window.__pva.midi.handleMessage(new Uint8Array(b)), bytes),
  panic: () => page.evaluate(() => window.__pva.controller.panic()),
  keyBox: (note) =>
    page.evaluate((n) => {
      const r = document.querySelector(`.key[data-note="${n}"]`).getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, note),
  isDown: (note) => page.evaluate((n) => document.querySelector(`.key[data-note="${n}"]`).classList.contains('is-down'), note),
};

async function waitVoices(target, timeout = 6000) {
  const t0 = Date.now();
  for (;;) {
    const s = await P.stats();
    if (s.total <= target) return s;
    if (Date.now() - t0 > timeout) throw new Error(`voices did not settle: ${JSON.stringify(s)}`);
    await sleep(60);
  }
}

/** Point on a white key that is clear of the black keys (front part). */
async function whitePoint(note, depth = 0.85) {
  const b = await P.keyBox(note);
  return { x: b.x + b.w / 2, y: b.y + b.h * depth };
}

console.log('\nPVA-61 — end-to-end checks\n');
await page.goto(URL);

/* 1 ---------------------------------------------------------------- */
await test('boots, grand piano playable, default set-up', async () => {
  await page.waitForFunction(() => window.__pva && !window.__pva.store.get().booting, null, { timeout: 30000 });
  const s = await P.state();
  assert(s.parts.upper1.toneId === 'concert-grand', 'default tone is not the concert grand');
  assert(!s.layerOn && !s.splitOn && !s.arp.on && !s.harmonyOn, 'layer / split / arpeggio / harmony must start off');
  assert(s.tempo === 120 && s.transpose === 0 && s.octave === 0, 'tempo/transpose/octave defaults wrong');
  assert(s.masterVolume === 75 && !s.sustainLatch && !s.metronomeOn, 'volume/sustain/metronome defaults wrong');
  assert(s.reverbOn && s.reverbType === 'concert', 'default reverb is not Concert Hall');
  assert(s.load.phase !== 'error' && s.load.loaded > 0, 'no samples loaded');
  const keys = await page.locator('.key').count();
  const whites = await page.locator('.key--white').count();
  assert(keys === 61 && whites === 36, `expected 61 keys / 36 white, got ${keys} / ${whites}`);
  const worklet = await page.evaluate(() => window.__pva.engine.usingWorklet);
  return `61 keys, master stage: ${worklet ? 'AudioWorklet' : 'fallback'}`;
});

await test('whole library loads without a missing sample', async () => {
  await page.waitForFunction(() => window.__pva.store.get().load.phase === 'done', null, { timeout: 120000 });
  const s = await P.state();
  const st = await page.evaluate(() => window.__pva.samples.stats());
  assert(s.load.failed === 0 && st.failed === 0, `${st.failed} samples failed`);
  return `${st.buffers} buffers, ${st.megabytes.toFixed(0)} MB decoded`;
});

/* 2 ---------------------------------------------------------------- */
await test('sample attack starts at once (no leading silence)', async () => {
  // Time until each recording first exceeds 2 % of its attack peak.
  const onsets = await page.evaluate(() => {
    const inst = window.__pva.instruments.get('concert-grand');
    const out = [];
    for (let note = 36; note <= 96; note += 3) {
      for (const vel of [20, 60, 90, 127]) {
        const src = inst.pick(note, vel).layers[0];
        const d = src.buffer.getChannelData(0);
        const n = Math.min(d.length, Math.floor(src.buffer.sampleRate * 0.3));
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
        let onset = 0;
        while (onset < n && Math.abs(d[onset]) < peak * 0.02) onset++;
        out.push((onset / src.buffer.sampleRate) * 1000);
      }
    }
    return out.sort((a, b) => a - b);
  });
  const median = onsets[onsets.length >> 1];
  const worst = onsets[onsets.length - 1];
  assert(median < 1.5, `median sample onset is ${median.toFixed(2)} ms`);
  assert(worst < 6, `a sample starts ${worst.toFixed(1)} ms late`);
  return `onset median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms (${onsets.length} recordings)`;
});

/* 3 ---------------------------------------------------------------- */
await test('mouse: one click = one note, key travels, release ends it', async () => {
  const p = await whitePoint('C4');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(120);
  const s = await P.stats();
  assert(s.active === 1, `expected exactly 1 voice, got ${s.active} (double trigger?)`);
  assert(await P.isDown('C4'), 'key is not visually down');
  const peak = await P.maxPeak(150);
  assert(peak > 0.002, `no audio on the master bus (peak ${peak})`);
  await page.mouse.up();
  await sleep(60);
  assert(!(await P.isDown('C4')), 'key stayed visually down');
  await waitVoices(0);
  return `peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
});

await test('mouse glissando across keys', async () => {
  const a = await whitePoint('C3');
  const b = await whitePoint('C4');
  await page.evaluate(() => {
    window.__gliss = [];
    window.__glissOff = window.__pva.controller.events.on('key', (e) => e.down && window.__gliss.push(e.key));
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 40 });
  await sleep(50);
  const midHeld = await P.held();
  await page.mouse.up();
  const played = await page.evaluate(() => {
    window.__glissOff();
    return window.__gliss;
  });
  assert(midHeld.length === 1, `glissando should hold one key at a time, held ${midHeld.length}`);
  assert(played.length === 8, `expected the 8 white keys C3–C4, got ${played.length}: ${played}`);
  assert((await P.held()).length === 0, 'keys left held after the glissando');
  await waitVoices(0);
  return `played ${played.join(' ')}`;
});

await test('mouse leaving the keybed while held stops the note', async () => {
  const p = await whitePoint('E4');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.move(p.x, p.y - 420, { steps: 6 });
  await sleep(60);
  assert((await P.held()).length === 0, 'note still held after leaving the keys');
  await page.mouse.up();
  await waitVoices(0);
});

/* 4 ---------------------------------------------------------------- */
await test('velocity changes level and sample layer', async () => {
  const layers = await page.evaluate(() => {
    const inst = window.__pva.instruments.get('concert-grand');
    const soft = inst.pick(60, 25).layers[0];
    const loud = inst.pick(60, 122).layers[0];
    return { different: soft.buffer !== loud.buffer, softGain: soft.gain, loudGain: loud.gain };
  });
  assert(layers.different, 'soft and loud strikes use the same recording');
  await P.down(60, 25);
  const soft = await P.maxPeak(250);
  await P.up(60);
  await waitVoices(0);
  await sleep(3200); // let the reverb tail go
  await P.down(60, 122);
  const loud = await P.maxPeak(250);
  await P.up(60);
  await waitVoices(0);
  const diff = 20 * Math.log10(loud / soft);
  assert(diff > 15, `only ${diff.toFixed(1)} dB between pp and ff`);
  return `pp→ff ${diff.toFixed(1)} dB, separate recordings`;
});

await test('touch response curves (OFF / SOFT / NORMAL / HARD)', async () => {
  const out = await page.evaluate(async () => {
    const { controller } = window.__pva;
    const seen = {};
    let last = 0;
    const off = controller.events.on('velocity', (v) => (last = v));
    for (const mode of ['off', 'soft', 'normal', 'hard']) {
      controller.touchMode = mode;
      controller.keyDown('t', 72, 64);
      seen[mode] = last;
      controller.keyUp('t', 72);
    }
    controller.touchMode = 'normal';
    off();
    return seen;
  });
  assert(out.off === 100, `OFF should give the fixed velocity 100, got ${out.off}`);
  assert(out.soft > out.normal && out.normal > out.hard, `curves not ordered: ${JSON.stringify(out)}`);
  assert(out.normal === 64, 'NORMAL should be linear');
  await waitVoices(0);
  return `64 → soft ${out.soft}, normal ${out.normal}, hard ${out.hard}, off ${out.off}`;
});

/* 5 ---------------------------------------------------------------- */
await test('repeated notes on one key do not pile up', async () => {
  for (let i = 0; i < 24; i++) {
    await P.down(64, 80 + (i % 3) * 10);
    await sleep(35);
    await P.up(64);
    await sleep(25);
  }
  const s = await P.stats();
  assert(s.active <= 3, `${s.active} voices alive after a fast repetition on one key`);
  await waitVoices(0);
});

await test('fast trill and legato leave nothing behind', async () => {
  for (let i = 0; i < 40; i++) {
    const k = i % 2 ? 67 : 65;
    await P.down(k, 85);
    await sleep(18);
    await P.up(i % 2 ? 65 : 67); // legato: previous note lifts after the next one starts
  }
  await P.up(65);
  await P.up(67);
  assert((await P.held()).length === 0, 'keys still held');
  await waitVoices(0);
});

await test('10-note chord: 10 clean voices, no clipping', async () => {
  const chord = [36, 43, 48, 52, 55, 60, 64, 67, 72, 76];
  for (const k of chord) await P.down(k, 110);
  const s = await P.stats();
  assert(s.active === 10, `expected 10 voices, got ${s.active}`);
  const peak = await P.maxPeak(400);
  assert(peak <= 0.9, `output peak ${peak.toFixed(3)} exceeds the limiter ceiling`);
  for (const k of chord) await P.up(k);
  await waitVoices(0);
  return `peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
});

await test('rapid random playing (300 notes) stays clean', async () => {
  await page.evaluate(async () => {
    const { controller } = window.__pva;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const on = [];
    for (let i = 0; i < 300; i++) {
      const k = 36 + Math.floor(Math.random() * 61);
      controller.keyDown('rnd', k, 30 + Math.floor(Math.random() * 97));
      on.push(k);
      if (on.length > 6) controller.keyUp('rnd', on.shift());
      await wait(6);
    }
    for (const k of on) controller.keyUp('rnd', k);
  });
  assert((await P.held()).length === 0, 'keys still held');
  await waitVoices(0);
});

/* 6 ---------------------------------------------------------------- */
await test('sustain pedal holds notes and releases them naturally', async () => {
  await page.keyboard.down('Space');
  for (const k of [48, 55, 60, 64]) {
    await P.down(k, 90);
    await sleep(20);
    await P.up(k);
  }
  await sleep(300);
  let snap = await P.snapshot();
  assert(snap.filter((v) => v.state === 'sustained').length === 4, `expected 4 sustained voices, got ${JSON.stringify(snap.map((v) => v.state))}`);
  assert((await P.state()).sustainDown, 'display does not show sustain');
  await page.keyboard.up('Space');
  await sleep(40);
  snap = await P.snapshot();
  assert(snap.length > 0 && snap.every((v) => v.state === 'releasing'), `pedal up should start the release envelope, got ${JSON.stringify(snap.map((v) => v.state))}`);
  await waitVoices(0);
  return 'held → releasing → ended';
});

await test('sostenuto holds only the notes that were down', async () => {
  await P.down(48, 90);
  await P.midi(0xb0, 66, 127);
  await P.down(60, 90);
  await P.up(48);
  await P.up(60);
  await sleep(500);
  let snap = (await P.snapshot()).filter((v) => v.state === 'sustained');
  assert(snap.length === 1 && snap[0].note === 48, `only C3 should be held, got ${JSON.stringify(snap)}`);
  await P.midi(0xb0, 66, 0);
  await waitVoices(0);
});

await test('64-voice polyphony with voice stealing', async () => {
  await P.midi(0xb0, 64, 127);
  await page.evaluate(async () => {
    const { controller } = window.__pva;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Different octave shifts so that more than 64 distinct notes sound.
    for (let pass = 0; pass < 2; pass++) {
      controller.transpose = pass * 1;
      for (let k = 36; k <= 96; k++) {
        controller.keyDown('poly', k, 70);
        controller.keyUp('poly', k);
        await wait(4);
      }
    }
    controller.transpose = 0;
  });
  const s = await P.stats();
  assert(s.active <= 64, `polyphony exceeded: ${s.active}`);
  assert(s.active >= 60, `expected the engine to be near 64 voices, got ${s.active}`);
  assert(s.stolen > 0, 'no voice was stolen');
  const peak = await P.maxPeak(300);
  assert(peak <= 0.9, `output peak ${peak.toFixed(3)} exceeds the ceiling`);
  await P.midi(0xb0, 64, 0);
  await waitVoices(0, 9000);
  return `${s.active} voices, ${s.stolen} stolen, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
});

/* 7 ---------------------------------------------------------------- */
async function measurePitch(lo = 300, hi = 700) {
  return page.evaluate(async ([lo, hi]) => {
    const { engine } = window.__pva;
    const an = engine.ctx.createAnalyser();
    an.fftSize = 32768;
    an.smoothingTimeConstant = 0;
    engine.masterIn.connect(an);
    await new Promise((r) => setTimeout(r, 900));
    const data = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(data);
    engine.masterIn.disconnect(an);
    const hz = engine.ctx.sampleRate / an.fftSize;
    let best = 0;
    for (let i = Math.floor(lo / hz); i < Math.floor(hi / hz); i++) if (data[i] > data[best] || best === 0) best = i;
    // parabolic interpolation
    const a = data[best - 1], b = data[best], c = data[best + 1];
    const shift = (0.5 * (a - c)) / (a - 2 * b + c);
    return (best + shift) * hz;
  }, [lo, hi]);
}

await test('pitch: A4 = 440 Hz, bend ±2 semitones, tuning', async () => {
  await page.evaluate(() => window.__pva.effects.setReverbEnabled(false));
  await P.down(69, 100);
  const base = await measurePitch();
  await page.evaluate(() => window.__pva.controller.setBend(1));
  await sleep(150);
  const up = await measurePitch();
  await page.evaluate(() => window.__pva.controller.setBend(-1));
  await sleep(150);
  const down = await measurePitch();
  await page.evaluate(() => window.__pva.controller.setBend(0));
  await P.up(69);
  await waitVoices(0);
  const cents = (f, ref) => 1200 * Math.log2(f / ref);
  assert(Math.abs(cents(base, 440)) < 12, `A4 measured ${base.toFixed(2)} Hz`);
  assert(Math.abs(cents(up, base) - 200) < 15, `bend up gave ${cents(up, base).toFixed(0)} cents`);
  assert(Math.abs(cents(down, base) + 200) < 15, `bend down gave ${cents(down, base).toFixed(0)} cents`);

  // MIDI pitch bend (full up = 0x7F 0x7F) and master tuning 446 Hz
  await page.evaluate(() => window.__pva.engine.setTuning(446));
  await P.down(69, 100);
  const tuned = await measurePitch();
  await page.evaluate(() => window.__pva.engine.setTuning(440));
  await P.up(69);
  await waitVoices(0);
  assert(Math.abs(cents(tuned, 446)) < 12, `tuning 446 Hz measured ${tuned.toFixed(2)} Hz`);
  await page.evaluate(() => window.__pva.effects.setReverbEnabled(true));
  return `A4 ${base.toFixed(1)} Hz, bend +${cents(up, base).toFixed(0)} / ${cents(down, base).toFixed(0)} cents, tuned ${tuned.toFixed(1)} Hz`;
});

await test('transpose and octave shift happen in the note engine', async () => {
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  await page.keyboard.press('ArrowRight');
  let s = await P.state();
  assert(s.transpose === 2 && s.octave === 1, `transpose ${s.transpose}, octave ${s.octave}`);
  await P.down(60, 90);
  let snap = await P.snapshot();
  assert(snap.some((v) => v.note === 74), `C4 key should sound D5 (74), got ${snap.map((v) => v.note)}`);
  assert(await P.isDown('C4'), 'the pressed key (C4) should move, not the transposed one');
  // change transpose while the key is held, then release: must not hang
  await page.keyboard.press('Minus');
  await page.keyboard.press('Minus');
  await page.keyboard.press('ArrowLeft');
  await P.up(60);
  await sleep(100);
  snap = await P.snapshot();
  assert(snap.every((v) => v.state === 'releasing'), 'note hung after transpose changed while held');
  s = await P.state();
  assert(s.transpose === 0 && s.octave === 0, 'transpose/octave did not return to 0');
  await waitVoices(0);
});

/* 8 ---------------------------------------------------------------- */
await test('computer keyboard plays, moves the keys, ignores auto-repeat', async () => {
  await page.keyboard.down('KeyZ');
  await page.keyboard.down('KeyZ'); // auto-repeat
  await page.keyboard.down('KeyQ');
  await sleep(60);
  const s = await P.stats();
  assert(s.active === 2, `expected 2 voices (Z, Q), got ${s.active}`);
  assert((await P.isDown('C3')) && (await P.isDown('C4')), 'Z/Q should press C3/C4');
  await page.keyboard.up('KeyZ');
  await page.keyboard.up('KeyQ');
  await sleep(40);
  assert(!(await P.isDown('C3')) && !(await P.isDown('C4')), 'keys stayed down');
  await waitVoices(0);
});

await test('losing window focus releases held computer keys', async () => {
  await page.keyboard.down('KeyE');
  await sleep(40);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(40);
  assert((await P.held()).length === 0, 'key still held after blur');
  await page.keyboard.up('KeyE');
  await waitVoices(0);
});

/* 9 ---------------------------------------------------------------- */
await test('MIDI: notes, velocity, CC64/1/7/11, pitch bend, running off', async () => {
  await P.midi(0x90, 60, 100);
  await P.midi(0x91, 64, 30); // another channel
  let snap = await P.snapshot();
  assert(snap.length === 2, `expected 2 voices from MIDI, got ${snap.length}`);
  assert(snap.find((v) => v.note === 60).velocity === 100 && snap.find((v) => v.note === 64).velocity === 30, 'MIDI velocity not passed through');
  assert(await P.isDown('C4'), 'MIDI note should move the on-screen key');
  await P.midi(0xb0, 64, 127); // sustain down
  await P.midi(0x90, 60, 0); // note on vel 0 = off
  await P.midi(0x81, 64, 0);
  await sleep(200);
  snap = await P.snapshot();
  assert(snap.filter((v) => v.state === 'sustained').length === 2, 'CC64 did not hold the notes');
  await P.midi(0xb0, 64, 0);
  await P.midi(0xb0, 1, 127);
  await P.midi(0xb0, 7, 64);
  await P.midi(0xe0, 0x7f, 0x7f);
  await sleep(80);
  const s = await P.state();
  assert(s.modulation === 127, `CC1 not received (${s.modulation})`);
  assert(s.masterVolume === 50, `CC7 should set volume 50, got ${s.masterVolume}`);
  const bend = await page.evaluate(() => window.__pva.upper.staticCents);
  assert(Math.abs(bend - 200) < 0.5, `MIDI pitch bend gave ${bend} cents`);
  await P.midi(0xe0, 0x00, 0x40);
  await P.midi(0xb0, 1, 0);
  await P.midi(0xb0, 7, 95);
  await waitVoices(0);
  assert((await P.state()).masterVolume === 75, 'volume not restored');
});

await test('MIDI device disconnect: hanging notes and pedal are cleaned up', async () => {
  await P.midi(0x90, 62, 90);
  await P.midi(0xb0, 64, 127);
  await page.evaluate(() => window.__pva.midi.events.emit('disconnected', { id: 'x', name: 'Test keys' }));
  await sleep(100);
  assert((await P.held()).length === 0, 'MIDI note still held after disconnect');
  assert(!(await P.state()).sustainDown, 'pedal still down after disconnect');
  await waitVoices(0);
});

/* 10 --------------------------------------------------------------- */
await test('touch: three fingers = three notes, slide = glissando', async () => {
  const cdp = await context.newCDPSession(page);
  const pts = [await whitePoint('C4'), await whitePoint('E4'), await whitePoint('G4')];
  const tp = (list) => list.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts) });
  await sleep(120);
  let held = await P.held();
  assert(held.length === 3 && [60, 64, 67].every((k) => held.includes(k)), `expected C4 E4 G4 held, got ${held}`);
  const chord = (await P.state()).chord;
  // slide the first finger from C4 to D4
  const d4 = await whitePoint('D4');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([d4, pts[1], pts[2]]) });
  await sleep(80);
  held = await P.held();
  assert(held.includes(62) && !held.includes(60), `slide should move C4 → D4, held ${held}`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(80);
  assert((await P.held()).length === 0, 'touch notes still held');
  await waitVoices(0);
  return `chord shown: ${chord}`;
});

/* 11 --------------------------------------------------------------- */
await test('chord recognition on the display', async () => {
  const cases = [
    [[60, 64, 67], 'C'],
    [[57, 60, 64], 'Am'],
    [[60, 64, 67, 71], 'Cmaj7'],
    [[60, 64, 67, 70], 'C7'],
    [[62, 67, 69], 'Dsus4'],
    [[64, 67, 72], 'C/E'],
  ];
  for (const [keys, want] of cases) {
    for (const k of keys) await P.down(k, 70);
    await sleep(90);
    const got = (await P.state()).chord;
    for (const k of keys) await P.up(k);
    assert(got === want, `${keys} → expected ${want}, got ${got}`);
    await sleep(60);
  }
  await waitVoices(0);
});

/* 12 --------------------------------------------------------------- */
await test('metronome: steady beats, tempo change stays in time, tap tempo', async () => {
  const run = (bpm) =>
    page.evaluate(
      (bpm) =>
        new Promise((resolve) => {
          const { clock, metronome, store } = window.__pva;
          const times = [];
          const off = clock.events.on('beat', (b) => times.push(b.time));
          clock.setTempo(bpm);
          metronome.setOn(true);
          setTimeout(() => {
            metronome.setOn(false);
            off();
            const gaps = times.slice(1).map((t, i) => t - times[i]);
            resolve({ n: times.length, gaps, tempo: store.get().tempo });
          }, 2300);
        }),
      bpm,
    );
  const a = await run(120);
  assert(a.n >= 4, `only ${a.n} beats in 2.3 s at 120 BPM`);
  assert(a.gaps.every((g) => Math.abs(g - 0.5) < 1e-6), `beats not exactly 0.5 s apart: ${a.gaps}`);
  const b = await run(240);
  assert(b.gaps.every((g) => Math.abs(g - 0.25) < 1e-6), `beats not exactly 0.25 s apart at 240 BPM: ${b.gaps}`);
  await page.evaluate(() => window.__pva.clock.setTempo(120));

  // panel: metronome button + audible click
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  const peak = await P.maxPeak(700);
  assert((await P.state()).metronomeOn, 'metronome button did not switch it on');
  assert(peak > 0.005, 'no metronome click on the output');
  await page.getByRole('button', { name: 'Metronome', exact: true }).click();
  assert(!(await P.state()).metronomeOn, 'metronome did not switch off');

  // tap tempo: four taps 400 ms apart → 150 BPM
  const tap = page.getByRole('button', { name: 'Tap tempo' });
  for (let i = 0; i < 4; i++) {
    await tap.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
    await sleep(400);
  }
  const tempo = (await P.state()).tempo;
  assert(Math.abs(tempo - 150) <= 6, `tap tempo gave ${tempo}, expected ≈150`);
  await page.evaluate(() => window.__pva.clock.setTempo(120));
  return `beat spacing exact, tap tempo ${tempo} BPM`;
});

/* 13 --------------------------------------------------------------- */
await test('panel controls: volume, tempo ±, transpose ±, octave ±, sustain, touch, reverb, labels', async () => {
  const press = async (name) => {
    await page.getByRole('button', { name, exact: false }).first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
    await page.getByRole('button', { name, exact: false }).first().dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' });
  };
  await page.evaluate(() => window.__pva.store.set({ tempo: 120 }));
  await press('Tempo up');
  await press('Transpose up');
  await press('Octave down');
  await press('Sustain');
  await press('Touch response');
  await press('Reverb');
  await press('Note labels');
  let s = await P.state();
  assert(s.tempo === 121, `tempo ${s.tempo}`);
  assert(s.transpose === 1 && s.octave === -1, `transpose ${s.transpose} octave ${s.octave}`);
  assert(s.sustainLatch && s.sustainDown, 'sustain latch');
  assert(s.touchMode === 'hard', `touch ${s.touchMode}`);
  assert(!s.reverbOn, 'reverb should be off');
  assert(s.noteLabels === 'note', 'labels');
  assert((await page.locator('.key__label').count()) === 61, 'note labels not drawn on all keys');
  // back to defaults
  await press('Tempo down');
  await press('Transpose down');
  await press('Octave up');
  await press('Sustain');
  await press('Touch response'); // hard → off
  await press('Touch response'); // off → soft
  await press('Touch response'); // soft → normal
  await press('Reverb');
  await press('Note labels');
  await press('Note labels');
  s = await P.state();
  assert(s.tempo === 120 && s.transpose === 0 && s.octave === 0 && !s.sustainLatch && s.touchMode === 'normal' && s.reverbOn && s.noteLabels === 'off', 'controls did not return to defaults');
});

await test('display: function menu, cursor, data wheel, exit', async () => {
  await page.getByRole('button', { name: 'Function menu' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  assert((await P.state()).lcdPage === 'menu', 'menu did not open');
  const first = (await P.state()).cursor;
  await page.getByRole('button', { name: 'Cursor down' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.getByRole('button', { name: 'Cursor down' }).dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' });
  assert((await P.state()).cursor !== first, 'cursor key did not move the cursor');
  await page.locator('.lcd-row', { hasText: 'Fixed velocity' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  assert((await P.state()).cursor === 'fixedVelocity', `cursor at ${(await P.state()).cursor}`);
  const wheel = page.getByRole('slider', { name: 'Data wheel' });
  const box = await wheel.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(60);
  await page.mouse.wheel(0, -100);
  await sleep(40);
  await page.mouse.wheel(0, -100);
  await sleep(60);
  assert((await P.state()).fixedVelocity === 102, `data wheel: velocity ${(await P.state()).fixedVelocity}`);
  await page.mouse.wheel(0, 100);
  await sleep(40);
  await page.mouse.wheel(0, 100);
  await sleep(40);
  await page.getByRole('button', { name: 'Exit to main screen' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  assert((await P.state()).lcdPage === 'main', 'exit did not return to the main screen');
});

/* 14 --------------------------------------------------------------- */
await test('grand piano quality switch frees and reloads its samples', async () => {
  const before = await page.evaluate(() => window.__pva.samples.stats().megabytes);
  // open the menu, select the "Sample quality" row and step it down to Light
  await page.getByRole('button', { name: 'Function menu' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  const row = page.locator('.lcd-row', { hasText: 'Grand piano quality' });
  await row.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.getByRole('button', { name: 'Value down' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.getByRole('button', { name: 'Value down' }).dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' });
  assert((await P.state()).quality === 'light', `quality is ${(await P.state()).quality}`);
  await page.waitForFunction(() => window.__pva.store.get().load.phase === 'done', null, { timeout: 120000 });
  const light = await page.evaluate(() => window.__pva.samples.stats().megabytes);
  assert(light < before * 0.75, `memory did not drop: ${before.toFixed(0)} → ${light.toFixed(0)} MB`);
  await P.down(60, 90);
  assert((await P.stats()).active === 1, 'not playable after the reload');
  await P.up(60);
  await page.getByRole('button', { name: 'Value up' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.getByRole('button', { name: 'Value up' }).dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' });
  await page.waitForFunction(() => window.__pva.store.get().load.phase === 'done' && window.__pva.store.get().quality === 'standard', null, { timeout: 120000 });
  await page.getByRole('button', { name: 'Exit to main screen' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await waitVoices(0);
  return `${before.toFixed(0)} MB → ${light.toFixed(0)} MB → reloaded`;
});

/* 15 --------------------------------------------------------------- */
await test('resize keeps key proportions and hit-testing', async () => {
  const sizes = [
    [1366, 700],
    [2560, 1340],
    [1024, 720],
    [1920, 1000],
  ];
  const out = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(250);
    const white = await P.keyBox('C4');
    const black = await P.keyBox('C#4');
    const ratio = white.h / white.w;
    assert(Math.abs(ratio - 6.0) < 0.35, `white key ratio ${ratio.toFixed(2)} at ${w}×${h}`);
    assert(Math.abs(black.w / white.w - 0.58) < 0.03, `black/white width ${(black.w / white.w).toFixed(2)} at ${w}×${h}`);
    // click the black key and a white key: the right notes must sound
    await page.mouse.click(black.x + black.w / 2, black.y + black.h * 0.6, { delay: 30 });
    const p = await whitePoint('G4');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await sleep(40);
    const held = await P.held();
    await page.mouse.up();
    assert(held.length === 1 && held[0] === 67, `click on G4 at ${w}×${h} played ${held}`);
    out.push(`${w}px: key ${white.w.toFixed(1)}×${white.h.toFixed(0)}`);
  }
  await waitVoices(0);
  return out.join(', ');
});

/* 16 --------------------------------------------------------------- */
await test('ALL NOTES OFF silences everything at once', async () => {
  await P.midi(0xb0, 64, 127);
  for (let k = 40; k < 70; k += 2) await P.down(k, 100);
  await page.getByRole('button', { name: 'All notes off' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await sleep(120);
  const s = await P.stats();
  assert(s.total === 0, `${s.total} voices still alive 120 ms after panic`);
  assert((await P.held()).length === 0 && !(await P.state()).sustainDown, 'keys or pedal still held');
  assert((await page.locator('.key.is-down').count()) === 0, 'keys still drawn as pressed');
});

await test('power off silences and suspends; power on restores', async () => {
  await P.down(60, 90);
  await page.getByRole('button', { name: 'Power' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await sleep(400);
  const eng = await page.evaluate(() => window.__pva.engine.ctx.state);
  assert(eng === 'suspended', `engine is ${eng} after power off`);
  await P.up(60);
  await page.getByRole('button', { name: 'Power' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.waitForFunction(() => !window.__pva.store.get().booting && window.__pva.engine.ctx.state === 'running', null, { timeout: 5000 });
  await P.down(60, 90);
  assert((await P.stats()).active === 1, 'no sound after power on');
  await P.up(60);
  await waitVoices(0);
});


/* ================================================================== */
/* Phase 2 — performance                                                */
/* ================================================================== */

/** Call an action of state/actions.ts. */
const A = (name, ...args) => page.evaluate(([n, a]) => window.__pva.act[n](...a), [name, args]);
/** Press a panel button (pointer down + up, no hold). */
async function pressBtn(name, exact = false) {
  // Resolve the element once: a toggle may change its own accessible name on the way down.
  const b = await page.getByRole('button', { name, exact }).first().elementHandle();
  await b.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await b.dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' });
}
const tone = (part = 'upper1') => page.evaluate((p) => window.__pva.store.get().parts[p].toneId, part);
const cents = (f, ref) => 1200 * Math.log2(f / ref);

/** Recorder on the audio thread, for measurements that need the wave itself. */
async function installRecorder() {
  await page.evaluate(async () => {
    const { engine } = window.__pva;
    const ctx = engine.ctx;
    const code = `class Rec extends AudioWorkletProcessor {
      constructor() { super(); this.on = false; this.port.onmessage = (e) => { if (e.data === 'start') this.on = true; else { this.on = false; this.port.postMessage('done'); } }; }
      process(inputs) { const i = inputs[0]; if (this.on && i.length) this.port.postMessage([i[0].slice(), (i[1] || i[0]).slice()]); return true; }
    }
    registerProcessor('pva-test-rec', Rec);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const rec = new AudioWorkletNode(ctx, 'pva-test-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
    // after the master EQ and the master stage: what goes to the loudspeakers
    (engine.masterNode ?? engine.masterIn).connect(rec);
    let cap = { l: [], r: [] };
    let done = null;
    rec.port.onmessage = (e) => {
      if (e.data === 'done') return done && done();
      cap.l.push(e.data[0]);
      cap.r.push(e.data[1]);
    };
    /** Record `ms` of the mix bus and return level and stereo figures. */
    window.__measure = async (ms) => {
      cap = { l: [], r: [] };
      rec.port.postMessage('start');
      await new Promise((r) => setTimeout(r, ms));
      await new Promise((r) => {
        done = r;
        rec.port.postMessage('stop');
      });
      let ll = 0, rr = 0, lr = 0, peak = 0, n = 0;
      for (let b = 0; b < cap.l.length; b++) {
        const L = cap.l[b], R = cap.r[b];
        for (let i = 0; i < L.length; i++) {
          ll += L[i] * L[i];
          rr += R[i] * R[i];
          lr += L[i] * R[i];
          peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
          n++;
        }
      }
      return { rms: Math.sqrt((ll + rr) / (2 * Math.max(1, n))), peak, correlation: lr / Math.sqrt(ll * rr + 1e-20) };
    };
  });
}
const measure = (ms) => page.evaluate((ms) => window.__measure(ms), ms);
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));

// The Phase 2 checks need the tone library and the recorder, whichever check runs first.
await page.waitForFunction(() => window.__pva.store.get().library !== 'loading' && window.__pva.store.get().library !== 'idle', null, { timeout: 120000 }).catch(() => undefined);
await installRecorder();

/* 18 --------------------------------------------------------------- */
await test('tone library: hundreds of real tones, missing ones are marked unavailable', async () => {
  await page.waitForFunction(() => window.__pva.store.get().library === 'ready', null, { timeout: 120000 });
  const info = await page.evaluate(() => {
    const t = window.__pva.instruments.tones;
    return {
      total: t.length,
      available: t.filter((x) => x.available).length,
      categories: new Set(t.map((x) => x.category)).size,
      unavailable: t.filter((x) => !x.available).map((x) => x.name),
      numbers: t.every((x, i) => x.number === i + 1),
      reasons: t.filter((x) => !x.available).every((x) => x.unavailableReason && x.unavailableReason.length > 10),
    };
  });
  assert(info.available >= 280, `only ${info.available} playable tones`);
  assert(info.categories === 18, `${info.categories} categories`);
  assert(info.numbers, 'tone numbers are not consecutive');
  assert(info.reasons, 'an unavailable tone has no explanation');
  // An unavailable tone can never be selected, and the display says why.
  const ok = await A('setPartTone', 'upper1', 'sarangi');
  const s = await P.state();
  assert(ok === false && s.parts.upper1.toneId === 'concert-grand', 'an unavailable tone was selected');
  assert(/not available/i.test(s.message ?? ''), `no explanation on the display: ${s.message}`);
  return `${info.available} playable in ${info.categories} categories; marked unavailable: ${info.unavailable.join(', ')}`;
});

await test('every tone of the library produces sound (one note each)', async () => {
  // Fast pass over the whole list: each tone must load and put signal on the bus.
  const out = await page.evaluate(async () => {
    const { instruments, voices, parts, engine } = window.__pva;
    const silent = [];
    const errors = [];
    let n = 0;
    for (const t of instruments.tones) {
      if (!t.available) continue;
      try {
        const inst = await instruments.prepare(t.id, 36, 96);
        // drum and effect kits do not fill every key: look for a key that has a sound
        let spec = null;
        for (const note of [60, 38, 36, 72, 48, 84, 42, 65, 55]) {
          spec = inst.pick(note, 100);
          if (spec) break;
        }
        if (!spec) {
          silent.push(t.name);
          continue;
        }
        const layer = spec.layers[0];
        const d = layer.buffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < d.length; i += 3) peak = Math.max(peak, Math.abs(d[i]));
        if (!(peak > 0.001) || !(layer.gain > 0) || !Number.isFinite(layer.rate)) silent.push(t.name);
        n++;
      } catch (err) {
        errors.push(`${t.name}: ${err && err.message}`);
      }
    }
    void voices;
    void parts;
    void engine;
    return { n, silent, errors };
  });
  assert(out.errors.length === 0, `tones failed to load: ${out.errors.slice(0, 5).join('; ')}`);
  assert(out.silent.length === 0, `tones without sound: ${out.silent.slice(0, 8).join(', ')}`);
  return `${out.n} tones checked`;
});

/* 19 --------------------------------------------------------------- */
await test('tone browser: category button → list → tone plays at pitch', async () => {
  await pressBtn('Woodwind tones');
  let s = await P.state();
  assert(s.lcdPage === 'tones' && s.browserCategory === 'WOODWIND', `browser not on Woodwind (${s.lcdPage}, ${s.browserCategory})`);
  const rows = await page.locator('.lcd-trow').count();
  assert(rows >= 15, `only ${rows} tones listed`);
  await page.locator('.lcd-trow__name', { hasText: /^Flute$/ }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.waitForFunction(() => window.__pva.store.get().parts.upper1.toneId === 'sf2-0-73', null, { timeout: 5000 });
  assert((await page.locator('.lcd-trow.is-current .lcd-trow__name').innerText()) === 'Flute', 'the selected row is not highlighted');
  await page.evaluate(() => window.__pva.effects.setReverbEnabled(false));
  await P.down(69, 100);
  const hz = await measurePitch();
  const peak = await P.maxPeak(120);
  await P.up(69);
  await page.evaluate(() => window.__pva.effects.setReverbEnabled(true));
  assert(Math.abs(cents(hz, 440)) < 15, `Flute A4 measured ${hz.toFixed(1)} Hz`);
  assert(peak > 0.01, `Flute is too quiet (peak ${peak})`);
  // data wheel steps through the list, ENTER returns
  const wheel = page.getByRole('slider', { name: 'Data wheel' });
  const box = await wheel.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => window.__pva.store.get().parts.upper1.toneId !== 'sf2-0-73', null, { timeout: 5000 });
  const next = await tone();
  await pressBtn('Enter', true);
  s = await P.state();
  assert(s.lcdPage === 'main', 'ENTER did not leave the browser');
  assert(s.recent[0] === next && s.recent.includes('sf2-0-73'), 'recently used tones are not recorded');
  await waitVoices(0);
  return `Flute A4 = ${hz.toFixed(1)} Hz, next tone ${next}`;
});

await test('tone search: typing filters the list and never plays notes', async () => {
  await pressBtn('Tone browser');
  const input = page.locator('.lcd-search input');
  await input.click();
  await page.keyboard.type('harm', { delay: 25 }); // h, a, r, m are note keys on the computer keyboard
  let s = await P.state();
  assert(s.browserQuery === 'harm' && s.browserTab === 'search', `search not active (${s.browserQuery}, ${s.browserTab})`);
  assert((await P.held()).length === 0 && (await P.stats()).total === 0, 'typing in the search box played notes');
  const names = await page.locator('.lcd-trow__name').allInnerTexts();
  assert(names.includes('Harmonium') && names.includes('Harmonica'), `search result: ${names}`);
  assert(names.length < 12, `the search did not narrow the list: ${names.length} tones`);
  await page.keyboard.press('Enter'); // first hit
  await page.waitForFunction(() => window.__pva.store.get().parts.upper1.toneId === 'sf2-0-22', null, { timeout: 5000 });
  // pressing anything else on the instrument gives the keyboard back to the keys
  await input.click();
  await input.fill('str');
  await page.locator('.lcd-trow__name').first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  assert(await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'), 'the search box kept the keyboard after a tone was pressed');
  // numeric entry: the exact tone number comes first
  await input.click();
  await input.fill('42');
  assert((await page.locator('.lcd-trow__num').first().innerText()) === '042', 'number search did not put tone 042 first');
  await input.fill('001');
  assert((await page.locator('.lcd-trow__name').first().innerText()) === 'Concert Grand', 'number search did not find tone 001');
  await page.keyboard.press('Escape');
  s = await P.state();
  assert(s.browserQuery === '' && s.browserTab === 'category', 'Escape did not clear the search');
  // the keyboard is an instrument again
  await page.keyboard.down('KeyQ');
  await sleep(50);
  assert((await P.held()).length === 1, 'computer keyboard does not play after leaving the search box');
  await page.keyboard.up('KeyQ');
  await pressBtn('Exit to main screen');
  await waitVoices(0);
  return names.join(', ');
});

await test('favourites: star, list, persisted', async () => {
  const id = await tone();
  await pressBtn('Add the current tone to the favourites');
  let s = await P.state();
  assert(s.favorites.includes(id), 'tone not added to the favourites');
  await pressBtn('Favourite tones');
  s = await P.state();
  assert(s.lcdPage === 'tones' && s.browserTab === 'favorites', 'favourites list did not open');
  assert((await page.locator('.lcd-trow').count()) === s.favorites.length, 'favourites list does not match');
  await sleep(450); // preferences are written a moment later
  const stored = await page.evaluate(() => window.__pva.storage.load('preferences', {}).favorites);
  assert(Array.isArray(stored) && stored.includes(id), 'favourites were not saved');
  await page.locator('.lcd-trow__fav').first().dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  assert(!(await P.state()).favorites.includes(id), 'star in the list did not remove the favourite');
  await pressBtn('Exit to main screen');
});

/* 20 --------------------------------------------------------------- */
await test('Indian bank: modelled tones play in tune', async () => {
  await page.evaluate(() => window.__pva.effects.setReverbEnabled(false));
  const ids = ['harmonium', 'shruti-box', 'bansuri', 'pungi', 'veena', 'sarod', 'santoor', 'swarmandal', 'jal-tarang', 'tabla-tarang', 'sf2-0-104', 'sf2-0-111'];
  const out = [];
  for (const id of ids) {
    assert(await A('setPartTone', 'upper1', id, false), `${id} could not be selected`);
    await sleep(120);
    await P.down(69, 100);
    const peak = await P.maxPeak(90); // plucked tones are loudest right at the start
    const hz = await measurePitch(380, 500);
    await P.up(69);
    await P.panic();
    const c = cents(hz, 440);
    assert(Math.abs(c) < 14, `${id}: A4 measured ${hz.toFixed(1)} Hz (${c.toFixed(0)} cents)`);
    assert(peak > 0.004, `${id} is too quiet (peak ${peak})`);
    out.push(`${id} ${c >= 0 ? '+' : ''}${c.toFixed(0)}`);
  }
  // tanpura: a drone tone, checked at its own register
  assert(await A('setPartTone', 'upper1', 'tanpura', false), 'tanpura could not be selected');
  await sleep(150);
  await P.down(57, 100);
  const tan = await measurePitch(180, 260);
  await P.up(57);
  await P.panic();
  assert(Math.abs(cents(tan, 220)) < 14, `tanpura A3 measured ${tan.toFixed(1)} Hz`);
  // tabla: a kit — different strokes on different keys, not transposed
  assert(await A('setPartTone', 'upper1', 'tabla', false), 'tabla could not be selected');
  const strokes = await page.evaluate(() => {
    const inst = window.__pva.instruments.get('tabla');
    const set = new Set();
    for (let k = 60; k < 72; k++) {
      const spec = inst.pick(k, 100);
      if (spec) set.add(spec.layers[0].buffer);
    }
    return set.size;
  });
  assert(strokes >= 8, `tabla has only ${strokes} different strokes`);
  await page.evaluate(() => window.__pva.effects.setReverbEnabled(true));
  await A('setPartTone', 'upper1', 'concert-grand', false);
  await waitVoices(0);
  return `cents off at A4: ${out.join(', ')}; tabla ${strokes} strokes`;
});

await test('MIDI bank select + program change select tones', async () => {
  await P.midi(0xb0, 0, 0);
  await P.midi(0xc0, 73);
  await page.waitForFunction(() => window.__pva.store.get().parts.upper1.toneId === 'sf2-0-73', null, { timeout: 5000 });
  await P.midi(0xb0, 0, 50); // bank of the modelled tones
  await P.midi(0xc0, 0);
  await page.waitForFunction(() => window.__pva.store.get().parts.upper1.toneId === 'harmonium', null, { timeout: 5000 });
  await P.midi(0xb0, 0, 0);
  await P.midi(0xc0, 0);
  await page.waitForFunction(() => window.__pva.store.get().parts.upper1.toneId === 'concert-grand', null, { timeout: 5000 });
});

/* 21 --------------------------------------------------------------- */
await test('layer: one key plays Upper 1 + Upper 2, each with its own settings', async () => {
  await pressBtn('Layer: Upper 2 on or off');
  assert((await P.state()).layerOn, 'LAYER button did not switch the layer on');
  await page.waitForFunction(() => window.__pva.controller.partTone('upper2') !== '', null, { timeout: 8000 });
  await P.down(60, 90);
  let snap = await P.snapshot();
  assert(snap.length === 2 && snap.some((v) => v.part === 'upper1') && snap.some((v) => v.part === 'upper2'), `expected one voice per upper part, got ${JSON.stringify(snap.map((v) => v.part))}`);
  await P.up(60);
  await sleep(60);
  assert((await P.snapshot()).every((v) => v.state !== 'held'), 'a layered voice stayed held after key-up');
  await waitVoices(0, 9000);
  // the second layer an octave up, at its own volume
  await A('setPartValue', 'upper2', 'octave', 1);
  await A('setPartValue', 'upper2', 'volume', 40);
  await P.down(60, 90);
  snap = await P.snapshot();
  const u2 = snap.find((v) => v.part === 'upper2');
  assert(u2 && u2.note === 72, `Upper 2 should sound an octave higher, got ${u2 && u2.note}`);
  await P.up(60);
  await A('setPartValue', 'upper2', 'octave', 0);
  await A('setPartValue', 'upper2', 'volume', 62);
  // switching the layer off while a key is held must not leave its voice hanging
  await P.down(64, 90);
  await pressBtn('Layer: Upper 2 on or off');
  await sleep(80);
  snap = await P.snapshot();
  assert(!snap.some((v) => v.part === 'upper2' && v.state === 'held'), 'Upper 2 kept sounding after LAYER was switched off');
  await P.up(64);
  await waitVoices(0, 9000);
});

await test('split: lower zone plays the Lower part, marker can be dragged', async () => {
  await pressBtn('Split: Lower part on or off');
  let s = await P.state();
  assert(s.splitOn && s.splitPoint === 54, `split ${s.splitOn} at ${s.splitPoint}`);
  await page.waitForFunction(() => window.__pva.controller.partTone('lower') !== '', null, { timeout: 8000 });
  assert((await page.locator('.splitzone__flag').innerText()) === 'F#3', 'split marker does not show the split point');
  await P.down(48, 90); // below the split
  await P.down(60, 90); // above
  let snap = await P.snapshot();
  assert(snap.length === 2, `expected 2 voices, got ${snap.length}`);
  assert(snap.find((v) => v.note === 48).part === 'lower' && snap.find((v) => v.note === 60).part === 'upper1', `wrong parts: ${JSON.stringify(snap.map((v) => [v.note, v.part]))}`);
  // the sustain pedal belongs to the upper zone
  await page.keyboard.down('Space');
  await P.up(48);
  await P.up(60);
  await sleep(250);
  snap = await P.snapshot();
  assert(snap.some((v) => v.part === 'upper1' && v.state === 'sustained'), 'upper note not held by the pedal');
  assert(!snap.some((v) => v.part === 'lower' && (v.state === 'sustained' || v.state === 'held')), 'the pedal also held the lower part');
  await page.keyboard.up('Space');
  // drag the marker to C4
  const flag = await page.locator('.splitzone__flag').boundingBox();
  const c4 = await P.keyBox('C4');
  await page.mouse.move(flag.x + flag.width / 2, flag.y + flag.height / 2);
  await page.mouse.down();
  await page.mouse.move(c4.x + c4.w * 0.3, flag.y + flag.height / 2, { steps: 8 });
  await page.mouse.up();
  s = await P.state();
  assert(s.splitPoint === 60, `dragging the marker gave split point ${s.splitPoint}`);
  await P.down(59, 90);
  snap = await P.snapshot();
  assert(snap.some((v) => v.note === 59 && v.part === 'lower'), 'B3 should now belong to the lower zone');
  await P.up(59);
  await A('setSplitPoint', 54, false);
  await waitVoices(0, 9000);
});

await test('auto harmonize: melody is harmonised from the chord of the lower zone', async () => {
  // split is on (previous test): hold C major in the lower zone
  for (const k of [43, 48, 52]) await P.down(k, 80);
  await sleep(120);
  assert(/^C(\/G)?$/.test((await P.state()).chord ?? ''), `chord display shows ${(await P.state()).chord}`);
  await pressBtn('Auto harmonize');
  assert((await P.state()).harmonyOn, 'HARMONY did not switch on');
  const modes = ['duet', 'trio', 'block', 'octave'];
  const out = [];
  for (const mode of modes) {
    await A('setHarmonyMode', mode);
    await P.down(76, 100); // E5
    const upper = (await P.snapshot()).filter((v) => v.part === 'upper1' && v.state === 'held');
    const added = upper.filter((v) => v.note !== 76).map((v) => v.note);
    assert(upper.some((v) => v.note === 76), `${mode}: the melody note itself is missing`);
    assert(added.length >= 1, `${mode}: no harmony note was added`);
    assert(added.every((n) => n < 76 && [0, 4, 7].includes(n % 12)), `${mode}: harmony notes ${added} are not chord tones below the melody`);
    assert(upper.filter((v) => v.note !== 76).every((v) => v.velocity < 100), `${mode}: harmony notes should be softer than the melody`);
    await P.up(76);
    await sleep(40);
    assert(!(await P.snapshot()).some((v) => v.part === 'upper1' && v.state === 'held'), `${mode}: harmony notes hung after key-up`);
    out.push(`${mode} +${added.join('/')}`);
  }
  for (const k of [43, 48, 52]) await P.up(k);
  await pressBtn('Auto harmonize');
  await A('setHarmonyMode', 'duet');
  await pressBtn('Split: Lower part on or off');
  const s = await P.state();
  assert(!s.harmonyOn && !s.splitOn, 'harmony / split did not switch off');
  await waitVoices(0, 9000);
  return out.join(', ');
});

/* 22 --------------------------------------------------------------- */
await test('arpeggiator: pattern, exact timing, stops with the keys', async () => {
  await page.evaluate(() => {
    const v = window.__pva.voices;
    window.__arp = [];
    window.__arpOrig = v.noteOn;
    v.noteOn = function (part, inst, note, velocity, opts) {
      window.__arp.push([note, opts && opts.when !== undefined ? opts.when : -1]);
      return window.__arpOrig.call(v, part, inst, note, velocity, opts);
    };
  });
  await A('setTempo', 120, false);
  await A('setArp', { on: true, mode: 'up', rate: '1/8', octaves: 1, gate: 50, swing: 0, latch: false });
  for (const k of [60, 64, 67]) await P.down(k, 90);
  await sleep(2300);
  for (const k of [60, 64, 67]) await P.up(k);
  await sleep(500);
  const count = await page.evaluate(() => window.__arp.length);
  await sleep(500);
  const log = await page.evaluate(() => window.__arp.slice());
  assert(log.length === count, 'the arpeggiator kept playing after the keys were released');
  assert(log.length >= 8, `only ${log.length} arpeggio notes in 2.3 s`);
  const notes = log.map((e) => e[0]);
  // the first step may start before all three keys are down; after that the pattern is strict
  const tail = notes.slice(3);
  const start = [60, 64, 67].indexOf(tail[0]);
  assert(start >= 0 && tail.every((n, i) => n === [60, 64, 67][(start + i) % 3]), `UP pattern broken: ${notes}`);
  const gaps = log.slice(1).map((e, i) => e[1] - log[i][1]);
  assert(log.every((e) => e[1] > 0), 'arpeggio notes are not scheduled on the audio clock');
  assert(gaps.every((g) => Math.abs(g - 0.25) < 1e-6), `1/8 notes at 120 BPM must be exactly 0.25 s apart: ${gaps.map((g) => g.toFixed(4))}`);
  await waitVoices(0, 9000);
  assert(!(await page.evaluate(() => window.__pva.clock.isRunning)), 'the clock keeps running with nothing to play');

  // latch: the pattern continues after the keys are released, the ARPEGGIO button stops it
  await A('setArp', { latch: true, mode: 'updown', rate: '1/16' });
  await page.evaluate(() => (window.__arp.length = 0));
  for (const k of [60, 64, 67]) await P.down(k, 90);
  await sleep(200);
  for (const k of [60, 64, 67]) await P.up(k);
  await sleep(900);
  const latched = await page.evaluate(() => window.__arp.length);
  assert(latched >= 7, `latch did not keep the arpeggio going (${latched} notes)`);
  await pressBtn('Arpeggio');
  assert(!(await P.state()).arp.on, 'ARPEGGIO button did not switch it off');
  await sleep(300);
  const after = await page.evaluate(() => window.__arp.length);
  await sleep(400);
  assert((await page.evaluate(() => window.__arp.length)) === after, 'arpeggio still running after it was switched off');
  await page.evaluate(() => {
    window.__pva.voices.noteOn = window.__arpOrig;
  });
  await A('setArp', { latch: false, mode: 'up', rate: '1/8' });
  await waitVoices(0, 9000);
  return `${log.length} notes, spacing exact`;
});

/* 23 --------------------------------------------------------------- */
await test('effects: reverb and delay add a tail, chorus widens, buttons switch them', async () => {
  assert(await A('setPartTone', 'upper1', 'sf2-0-115', false), 'wood block tone missing'); // short, dry click
  for (const key of ['reverb', 'chorus', 'delay']) await A('setPartValue', 'upper1', key, 0);
  await sleep(3500); // the reverb of the previous check has to be gone
  // Level from 0.3 s to 1.1 s after a short click: only an effect can still sound there.
  const tail = async () => {
    await P.down(72, 110);
    await sleep(60);
    await P.up(72);
    await sleep(240);
    const m = await measure(800);
    await sleep(3200); // let it ring out before the next measurement
    return m.rms;
  };
  const dry = await tail();
  await A('setPartValue', 'upper1', 'delay', 100);
  const delay = await tail();
  await pressBtn('Delay', true);
  assert(!(await P.state()).delayOn, 'DELAY button did not switch the delay off');
  const delayOff = await tail();
  await pressBtn('Delay', true);
  await A('setPartValue', 'upper1', 'delay', 0);
  await A('setPartValue', 'upper1', 'reverb', 100);
  const reverb = await tail();
  await pressBtn('Reverb', true);
  const reverbOff = await tail();
  await pressBtn('Reverb', true);
  await A('setPartValue', 'upper1', 'reverb', 0);
  assert(db(delay) > db(dry) + 20, `delay tail ${db(delay).toFixed(0)} dB vs dry ${db(dry).toFixed(0)} dB`);
  assert(db(delayOff) < db(delay) - 20, 'switching the delay off left its tail');
  assert(db(reverb) > db(dry) + 20, `reverb tail ${db(reverb).toFixed(0)} dB vs dry ${db(dry).toFixed(0)} dB`);
  assert(db(reverbOff) < db(reverb) - 20, `switching the reverb off left its tail (${db(reverb).toFixed(0)} → ${db(reverbOff).toFixed(0)} dB)`);

  // chorus: a centred mono tone becomes a stereo one
  assert(await A('setPartTone', 'upper1', 'sf2-0-79', false), 'ocarina tone missing');
  for (const key of ['reverb', 'chorus', 'delay']) await A('setPartValue', 'upper1', key, 0);
  await P.down(72, 100);
  await sleep(300);
  const mono = await measure(300);
  await A('setPartValue', 'upper1', 'chorus', 100);
  await sleep(200);
  const wide = await measure(400);
  await pressBtn('Chorus', true);
  await sleep(250);
  const off = await measure(300);
  await pressBtn('Chorus', true);
  await P.up(72);
  assert(mono.correlation > 0.999, `dry tone is not mono (correlation ${mono.correlation.toFixed(4)})`);
  assert(wide.correlation < 0.99, `chorus did not widen the tone (correlation ${wide.correlation.toFixed(4)})`);
  assert(off.correlation > 0.999, 'CHORUS button did not switch the chorus off');
  // every preset of the three effects can be selected and still passes sound
  const presets = await page.evaluate(async () => {
    const { act, store } = window.__pva;
    const { params } = window.__pva;
    const count = {};
    for (const id of ['reverbType', 'chorusType', 'delayType']) {
      const p = params.PARAMS[id];
      const options = p.options(store.get());
      for (const o of options) p.set(o.value);
      count[id] = options.length;
      p.set(options[0].value);
    }
    act.setReverbType('concert');
    return count;
  });
  await A('setPartValue', 'upper1', 'chorus', 0);
  await waitVoices(0, 9000);
  return `tails: dry ${db(dry).toFixed(0)}, delay ${db(delay).toFixed(0)}, reverb ${db(reverb).toFixed(0)} dB; chorus correlation ${wide.correlation.toFixed(2)}; presets ${JSON.stringify(presets)}`;
});

await test('master EQ: curves change the sound, graph handles can be dragged', async () => {
  // ocarina is nearly a sine: B4 = 494 Hz
  await P.down(71, 100);
  await sleep(350);
  const flat = (await measure(300)).rms;
  await A('setEqBand', 1, { gain: -12, freq: 494 });
  await sleep(150);
  const cut = (await measure(300)).rms;
  let s = await P.state();
  assert(s.eqPreset === 'user', 'editing a band should select the user curve');
  await A('setEqPreset', 'flat');
  await sleep(150);
  const back = (await measure(300)).rms;
  await P.up(71);
  assert(db(cut) < db(flat) - 8, `a −12 dB band only changed the level by ${(db(cut) - db(flat)).toFixed(1)} dB`);
  assert(Math.abs(db(back) - db(flat)) < 1.5, `the flat curve did not restore the level (${db(flat).toFixed(1)} → ${db(cut).toFixed(1)} → ${db(back).toFixed(1)} dB)`);
  // the response that is drawn comes from the same filters
  const drawn = await page.evaluate(() => {
    const f = new Float32Array([494]);
    return window.__pva.engine.eqResponse(f, [{ gain: 0, freq: 110 }, { gain: -12, freq: 494 }, { gain: 0, freq: 2400 }, { gain: 0, freq: 8000 }])[0];
  });
  assert(Math.abs(drawn - (db(cut) - db(flat))) < 2.5, `drawn curve says ${drawn.toFixed(1)} dB, measured ${(db(cut) - db(flat)).toFixed(1)} dB`);
  // factory curves
  const n = await page.evaluate(() => {
    const { params, store } = window.__pva;
    const options = params.PARAMS.eqPreset.options(store.get());
    for (const o of options) params.PARAMS.eqPreset.set(o.value);
    params.PARAMS.eqPreset.set('flat');
    return options.length;
  });
  // panel: EQ page, drag band 1 upwards
  await pressBtn('Master equaliser');
  assert((await P.state()).lcdPage === 'eq', 'EQ page did not open');
  await sleep(200); // page wipe animation
  const h = await page.locator('.lcd-eq__handle').first().boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  s = await P.state();
  assert(s.eqPreset === 'user' && s.eqUser[0].gain > 2, `dragging the handle gave ${JSON.stringify(s.eqUser[0])}`);
  await A('setEqBand', 0, { gain: 0, freq: 110 });
  await A('setEqPreset', 'flat');
  await pressBtn('Exit to main screen');
  await waitVoices(0, 9000);
  return `−12 dB band → ${(db(cut) - db(flat)).toFixed(1)} dB measured, ${drawn.toFixed(1)} dB drawn; ${n} curves`;
});

await test('DSP insert: every preset passes sound, rotary takes the modulation wheel', async () => {
  const ids = await page.evaluate(() => window.__pva.params.PARAMS.partDspType.options(window.__pva.store.get()).map((o) => o.value));
  assert(ids.length >= 50, `only ${ids.length} DSP presets`);
  await A('setPartDsp', 'upper1', true);
  const bad = [];
  for (const id of ids) {
    await A('setPartDspPreset', 'upper1', id);
    await sleep(70);
    await P.down(60, 100);
    const peak = await P.maxPeak(130);
    await P.up(60);
    if (!(peak > 0.003 && peak <= 0.9)) bad.push(`${id} (${peak.toFixed(4)})`);
  }
  assert(bad.length === 0, `DSP presets with a wrong level: ${bad.join(', ')}`);
  // rotary speaker: the wheel changes the rotor speed instead of adding vibrato
  await A('setPartDspPreset', 'upper1', 'rotary-1');
  await sleep(120);
  const rotary = await page.evaluate(() => window.__pva.parts.upper1.insertTakesModulation);
  await A('setPartDspPreset', 'upper1', 'compressor-1');
  await sleep(120);
  const comp = await page.evaluate(() => window.__pva.parts.upper1.insertTakesModulation);
  assert(rotary && !comp, 'modulation wheel routing does not follow the insert type');
  // panel button
  await pressBtn('DSP insert effect of the selected part');
  assert(!(await P.state()).parts.upper1.dspOn, 'DSP button did not switch the insert off');
  await sleep(120);
  assert(!(await page.evaluate(() => window.__pva.parts.upper1.hasInsert)), 'insert still in the signal path');
  await A('setPartDspPreset', 'upper1', 'rotary-1');
  await waitVoices(0, 9000);
  return `${ids.length} presets`;
});

/* 24 --------------------------------------------------------------- */
await test('drum kit: keys keep their sounds when transposed, closed hi-hat cuts the open one', async () => {
  assert(await A('setPartTone', 'upper1', 'sf2-128-0', false), 'standard kit missing');
  await A('setTranspose', 2, false);
  await P.down(46, 100); // open hi-hat
  await sleep(60);
  let snap = await P.snapshot();
  assert(snap.length === 1 && snap[0].note === 46, `a drum key must not be transposed, sounding note ${snap.map((v) => v.note)}`);
  await P.down(42, 100); // closed hi-hat
  await sleep(120);
  snap = await P.snapshot();
  assert(!snap.some((v) => v.note === 46 && v.state !== 'dying'), `open hi-hat still ringing: ${JSON.stringify(snap)}`);
  await P.up(46);
  await P.up(42);
  await A('setTranspose', 0, false);
  await waitVoices(0, 9000);
});

await test('changing the tone while keys are held leaves nothing hanging', async () => {
  await A('setPartTone', 'upper1', 'sf2-0-48', false); // strings: sustained
  await P.down(60, 90);
  await P.down(64, 90);
  await A('setPartTone', 'upper1', 'sf2-0-19', false); // organ
  await sleep(80);
  let snap = await P.snapshot();
  assert(!snap.some((v) => v.state === 'held'), 'notes of the old tone are still held');
  await P.up(60);
  await P.up(64);
  await P.down(67, 90);
  assert((await P.stats()).active >= 1, 'the new tone does not play');
  await P.up(67);
  await A('setPartTone', 'upper1', 'concert-grand', false);
  await waitVoices(0, 9000);
});

await test('panel: hold opens settings, part buttons, mixer page', async () => {
  // holding REVERB opens its page and leaves the effect as it was
  const before = (await P.state()).reverbOn;
  const reverb = page.getByRole('button', { name: 'Reverb', exact: true });
  await reverb.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await sleep(650);
  await reverb.dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' });
  let s = await P.state();
  assert(s.lcdPage === 'reverb', `holding REVERB opened "${s.lcdPage}"`);
  assert(s.reverbOn === before, 'holding REVERB also toggled it');
  await pressBtn('Exit to main screen');
  // part select: the tone buttons then work on that part
  await pressBtn('Select Upper 2');
  assert((await P.state()).selectedPart === 'upper2', 'UPPER 2 was not selected');
  await pressBtn('Next tone');
  await page.waitForFunction(() => window.__pva.store.get().parts.upper2.toneId !== 'sf2-0-49', null, { timeout: 5000 });
  s = await P.state();
  assert(s.parts.upper1.toneId === 'concert-grand', 'TONE + changed the wrong part');
  await pressBtn('Previous tone');
  await page.waitForFunction(() => window.__pva.store.get().parts.upper2.toneId === 'sf2-0-49', null, { timeout: 5000 });
  // mixer page: the data wheel changes the selected part's volume
  await pressBtn('Part mixer');
  s = await P.state();
  assert(s.lcdPage === 'part' && s.cursor === 'partVolume', `mixer page: ${s.lcdPage} / ${s.cursor}`);
  const volume = s.parts.upper2.volume;
  await pressBtn('Value down');
  await pressBtn('Value down');
  assert((await P.state()).parts.upper2.volume === volume - 2, 'the mixer did not change the part volume');
  await pressBtn('Value up');
  await pressBtn('Value up');
  await pressBtn('Exit to main screen');
  await pressBtn('Select Upper 1');
  assert((await P.state()).selectedPart === 'upper1', 'UPPER 1 was not selected');
  // nothing on the panel is a dummy: every enabled button is wired to a handler
  const dead = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('.panel button, .lcd button')) {
      const key = Object.keys(b).find((k) => k.startsWith('__reactProps'));
      const props = key ? b[key] : {};
      if (!props.onPointerDown && !props.onClick) out.push(b.getAttribute('aria-label') || b.textContent);
    }
    return out;
  });
  assert(dead.length === 0, `controls without a handler: ${dead.join(', ')}`);
});

/* 25 --------------------------------------------------------------- */
await test('tone library file missing: grand and models still play, display explains, retry works', async () => {
  const p2 = await context.newPage();
  let block = true;
  await p2.route('**/*.sf2', (route) => (block ? route.abort() : route.continue()));
  try {
    await p2.goto(URL);
    await p2.waitForFunction(() => window.__pva && window.__pva.store.get().library === 'error', null, { timeout: 60000 });
    await p2.waitForFunction(() => !window.__pva.store.get().booting && window.__pva.controller.partTone('upper1') === 'concert-grand', null, { timeout: 60000 });
    await p2.evaluate(() => window.__pva.act.unlockAudio());
    await p2.waitForFunction(() => window.__pva.engine.isRunning, null, { timeout: 10000 });
    const grand = await p2.evaluate(() => {
      const { controller, voices } = window.__pva;
      controller.keyDown('t', 60, 90);
      const n = voices.stats().active;
      controller.keyUp('t', 60);
      return n;
    });
    assert(grand === 1, 'the grand piano does not play without the tone library');
    const refused = await p2.evaluate(() => window.__pva.act.setPartTone('upper1', 'sf2-0-73'));
    const message = await p2.evaluate(() => window.__pva.store.get().message);
    assert(refused === false, 'a SoundFont tone was selected although its file is missing');
    assert(/tone library/i.test(message ?? ''), `the display does not explain the problem: ${message}`);
    assert(await p2.evaluate(() => window.__pva.act.setPartTone('upper1', 'harmonium', false)), 'a modelled tone should not need the library file');
    // the browser offers a retry
    await p2.evaluate(() => window.__pva.act.openCategory('STRINGS'));
    block = false;
    await p2.getByRole('button', { name: 'Retry' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
    await p2.waitForFunction(() => window.__pva.store.get().library === 'ready', null, { timeout: 60000 });
    assert(await p2.evaluate(() => window.__pva.act.setPartTone('upper1', 'sf2-0-73', false)), 'tone not selectable after the retry');
  } finally {
    await p2.close();
  }
});

/* 17 --------------------------------------------------------------- */
await test('no stuck notes, silence returns, no console errors', async () => {
  await sleep(4500); // reverb tail
  const s = await P.stats();
  assert(s.total === 0, `${s.total} voices still alive`);
  assert((await P.held()).length === 0, 'keys still held');
  const peak = await P.maxPeak(300);
  assert(peak < 0.0005, `output is not silent (peak ${peak})`);
  assert(consoleErrors.length === 0, `console errors:\n        ${consoleErrors.join('\n        ')}`);
  return `output ${peak === 0 ? '-inf' : (20 * Math.log10(peak)).toFixed(0)} dBFS`;
});

await page.screenshot({ path: join(outDir, 'instrument.png') });
const lat = await page.evaluate(() => window.__pva.engine.latencyInfo());
console.log(`\n  audio: ${lat.sampleRate} Hz, buffer latency ${lat.baseMs.toFixed(1)} ms${lat.outputMs !== null ? `, device ${lat.outputMs.toFixed(1)} ms` : ''}`);
console.log(`\n${results.length - failed} passed, ${failed} failed\n`);

await browser.close();
stop();
process.exit(failed ? 1 : 0);
