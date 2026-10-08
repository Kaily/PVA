/**
 * Piano Academy — end-to-end checks of the Happy Birthday demo lesson in a
 * real browser with a real AudioContext (the acceptance criteria of the
 * Academy prompt, §2).
 *
 *   npm run build && npm run test:academy
 *
 * Same set-up as run.mjs: starts `vite preview` itself; PVA_BROWSER = path
 * of a Chromium binary, otherwise the installed Chrome is used.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4181;
const URL = `http://localhost:${PORT}/?debug=1`;
const outDir = join(root, 'tests', 'e2e', 'out');
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ not found — run "npm run build" first.');
  process.exit(1);
}

/* ---------- harness ---------- */
const results = [];
let failed = 0;
async function test(name, fn) {
  try {
    const info = await fn();
    results.push({ name, ok: true, info });
    console.log(`  ok    ${name}${info ? `  — ${info}` : ''}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, info: String(err?.message ?? err) });
    console.log(`  FAIL  ${name}\n        ${err?.message ?? err}`);
    await page
      .evaluate(() => {
        window.__pva.academy.reset();
        window.__pva.controller.releaseSources('');
        window.__pva.controller.panic();
      })
      .catch(() => undefined);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not up yet */
  }
  await sleep(250);
}

const launchOptions = { args: ['--autoplay-policy=no-user-gesture-required'] };
if (process.env.PVA_BROWSER) launchOptions.executablePath = process.env.PVA_BROWSER;
else launchOptions.channel = process.env.PVA_CHANNEL || 'chrome';
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/* ---------- helpers ---------- */
const AC = {
  state: () => page.evaluate(() => window.__pva.academy.store.get()),
  call: (name, ...args) => page.evaluate(([n, a]) => window.__pva.academy[n](...a), [name, args]),
  notes: () => page.evaluate(() => window.__pva.academy.compiled.notes.map((n) => ({ midi: n.midi, beats: n.beats, start: n.startTick / 24, phrase: n.phrase }))),
  waitStatus: (status, timeout = 30000) =>
    page.waitForFunction((s) => window.__pva.academy.store.get().status === s, status, { timeout }),
  keyClasses: (midi) => page.evaluate((m) => [...document.querySelector(`.key[data-midi="${m}"]`).classList], midi),
  mark: (midi) =>
    page.evaluate((m) => {
      const el = document.querySelector(`.key[data-midi="${m}"] .key__mark`);
      return { cls: el.className, finger: el.dataset.finger ?? null, note: el.dataset.note ?? null };
    }, midi),
};
/** Computer keys of the default key map for the notes of the song. */
const CODE = { 67: 'KeyT', 69: 'KeyY', 71: 'KeyU', 72: 'KeyI', 74: 'KeyO', 76: 'KeyP', 77: 'BracketLeft', 79: 'BracketRight' };
const tap = async (midi, gap = 40) => {
  await page.keyboard.down(CODE[midi]);
  await sleep(gap);
  await page.keyboard.up(CODE[midi]);
  await sleep(gap);
};
const midiMsg = (...bytes) => page.evaluate((b) => window.__pva.midi.handleMessage(new Uint8Array(b)), bytes);

/** Record every note the lesson plays and every click of its metronome. */
async function installSpies() {
  await page.evaluate(() => {
    const { controller, metronome } = window.__pva;
    window.__played = [];
    window.__clicks = [];
    window.__lit = [];
    if (!controller.__spied) {
      const play = controller.playNote.bind(controller);
      controller.playNote = (k, v, w, u) => {
        window.__played.push({ k, v, w, u });
        return play(k, v, w, u);
      };
      const click = metronome.clickAt.bind(metronome);
      metronome.clickAt = (t, accent) => {
        window.__clicks.push({ t, accent });
        return click(t, accent);
      };
      // which keys light up for the playback, in order (and when)
      const keys = window.__pva.academy.keys;
      const light = keys.play.bind(keys);
      keys.play = (midi, down) => {
        if (down) window.__lit.push({ midi, t: window.__pva.engine.ctx.currentTime, lit: true });
        light(midi, down);
        if (down && !document.querySelector(`.key[data-midi="${midi}"]`).classList.contains('hl-play')) window.__lit.push({ midi, lit: false });
      };
      controller.__spied = true;
    }
  });
}
/** Wait until every voice has finished its release. */
async function silence(timeout = 3000) {
  const t0 = Date.now();
  for (;;) {
    const n = await page.evaluate(() => window.__pva.voices.stats().total);
    if (n === 0) return Date.now() - t0;
    if (Date.now() - t0 > timeout) throw new Error(`${n} voices still sounding after ${timeout} ms`);
    await sleep(50);
  }
}
const reset = () => page.evaluate(() => ((window.__played = []), (window.__clicks = []), (window.__lit = [])));

/**
 * A "player" inside the page: presses MIDI keys at given song beats, read
 * from the lesson's own clock mapping — the way a person plays to the click.
 */
async function botPlay(plan) {
  await page.evaluate((plan) => {
    const a = window.__pva.academy;
    const ctx = window.__pva.engine.ctx;
    let k = 0;
    const id = setInterval(() => {
      if (k >= plan.length) return clearInterval(id);
      const beat = a.songBeat(ctx.currentTime);
      while (k < plan.length && beat >= plan[k].at) {
        const p = plan[k++];
        window.__pva.midi.handleMessage(new Uint8Array([0x90, p.midi, 96]));
        setTimeout(() => window.__pva.midi.handleMessage(new Uint8Array([0x90, p.midi, 0])), p.holdMs); // velocity 0 = note off
      }
    }, 4);
  }, plan);
}

console.log('\nPVA-61 Piano Academy — end-to-end checks\n');
await page.goto(URL);
await page.waitForFunction(() => window.__pva && !window.__pva.store.get().booting, null, { timeout: 30000 });
await page.evaluate(() => window.localStorage.removeItem('pva61.academy'));
// the tone library decodes in the background after boot; let it finish so timings are not disturbed
await page.waitForFunction(() => window.__pva.store.get().load.phase === 'done', null, { timeout: 120000 });
const melody = await AC.notes();

/* 1 ---------------------------------------------------------------- */
await test('Academy opens in place of the panel; the keybed stays the instrument', async () => {
  await page.evaluate(() => window.__pva.act.setMetronome(true));
  await page.getByRole('button', { name: 'Open the Piano Academy' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.waitForSelector('.panel--academy');
  assert((await page.locator('.sec--master').count()) === 0, 'control panel still shown');
  assert((await page.locator('.keybed .key').count()) === 61, 'keybed missing');
  const s = await page.evaluate(() => ({ metro: window.__pva.store.get().metronomeOn, tempo: window.__pva.clock.tempo }));
  assert(!s.metro, 'the panel metronome should pause while the Academy is open');
  assert(s.tempo === 60, `lesson tempo should start at 60 BPM, clock is at ${s.tempo}`);
  const ac = await AC.state();
  assert(ac.open && ac.mode === 'watch' && ac.index === 0, 'Academy state wrong');
  assert(melody.length === 25 && melody[0].midi === 67, 'song data wrong');
  await installSpies();
  return '25 notes, 60 BPM, panel metronome paused';
});

/* 2 ---------------------------------------------------------------- */
await test('Watch & Listen: whole melody with correct notes and timing, keys light in sync', async () => {
  await AC.call('setTempo', 120);
  await AC.call('setMetronome', false);
  await reset();
  await AC.call('start');
  await AC.waitStatus('finished', 30000);
  const { played, lit } = await page.evaluate(() => ({ played: window.__played, lit: window.__lit }));
  assert(played.length === 25, `${played.length} notes played`);
  for (let i = 0; i < 25; i++) assert(played[i].k === melody[i].midi, `note ${i + 1} is ${played[i].k}, expected ${melody[i].midi}`);
  let worst = 0;
  for (let i = 1; i < 25; i++) {
    const expected = (melody[i].start - melody[i - 1].start) * 0.5; // seconds per beat at 120
    worst = Math.max(worst, Math.abs(played[i].w - played[i - 1].w - expected));
  }
  assert(worst < 0.002, `onset error ${(worst * 1000).toFixed(2)} ms`);
  // the dotted rhythm: "Hap-" three times as long as "py"
  const hap = played[1].w - played[0].w;
  const py = played[2].w - played[1].w;
  assert(Math.abs(hap / py - 3) < 0.01, `pickup ratio ${(hap / py).toFixed(2)}`);
  // each note held for its length (90 %), so repeated G4s are two notes
  const hold = played[0].u - played[0].w;
  assert(Math.abs(hold - 0.75 * 0.5 * 0.9) < 0.002, `hold ${hold}`);
  assert(lit.length === 25 && lit.every((l, i) => l.lit && l.midi === melody[i].midi), `keys lit: ${lit.map((l) => l.midi).join(',')}`);
  // a key lights when its note is *heard*: scheduled time + output latency (as the beat lamps do)
  const delay = await page.evaluate(() => window.__pva.engine.outputDelay);
  const raw = lit.map((l, i) => l.t - (played[i].w + delay));
  if (process.env.PVA_DEBUG) console.log(raw.map((x) => Math.round(x * 1000)).join(" "));
  const lags = [...raw].sort((a, b) => a - b);
  const lag = lags[lags.length - 1];
  const median = lags[12];
  assert(lags[0] > -0.005, `a key lit ${(-lags[0] * 1000).toFixed(0)} ms before its sound was heard`);
  assert(median < 0.04 && lag < 0.15, `keys lit late: median ${(median * 1000).toFixed(0)} ms, worst ${(lag * 1000).toFixed(0)} ms`);
  const s = await AC.state();
  assert(s.progress.lessons['happy-birthday']?.watched, 'watching to the end is not recorded');
  return `25/25 notes, onset error ${(worst * 1000).toFixed(2)} ms, keys light ${(median * 1000).toFixed(0)} ms (worst ${(lag * 1000).toFixed(0)}) after the note is heard`;
});

/* 3 ---------------------------------------------------------------- */
await test('Playback: pause, resume, restart and slowing down', async () => {
  await AC.call('setTempo', 60);
  await reset();
  await AC.call('start');
  await page.waitForFunction(() => window.__pva.academy.store.get().index >= 3, null, { timeout: 10000 });
  await AC.call('pause');
  const atPause = await AC.state();
  assert(atPause.status === 'paused', 'not paused');
  const n1 = await page.evaluate(() => window.__played.length);
  await sleep(1200);
  const n2 = await page.evaluate(() => window.__played.length);
  assert(n1 === n2, 'notes kept coming after pause');
  const held = await page.evaluate(() => window.__pva.voices.snapshot().filter((v) => v.state === 'held').length);
  assert(held === 0, `${held} notes still held during pause`);
  await silence();
  await AC.call('resume');
  await page.waitForFunction((n) => window.__played.length > n, n2, { timeout: 5000 });
  const resumed = await page.evaluate((n) => window.__played[n].k, n2);
  assert(resumed === melody[atPause.index].midi, `resume did not continue at the paused note (${resumed})`);
  // slow down while playing: 60 → 40 BPM, a one-beat note then lasts 1.5 s
  await AC.call('setTempo', 40);
  await page.waitForFunction(() => window.__pva.academy.store.get().index >= 8, null, { timeout: 15000 });
  const { spacing, count } = await page.evaluate(() => {
    const p = window.__played;
    return { spacing: p[p.length - 1].w - p[p.length - 2].w, count: p.length };
  });
  // played[j] (j ≥ n2) is melody note atPause.index + (j − n2)
  const m = atPause.index + (count - 1 - n2);
  const expected = (melody[m].start - melody[m - 1].start) * 1.5;
  assert(Math.abs(spacing - expected) < 0.005, `spacing at 40 BPM ${spacing.toFixed(3)} s, expected ${expected.toFixed(3)}`);
  await reset();
  await AC.call('start'); // restart
  await page.waitForFunction(() => window.__played.length >= 1, null, { timeout: 5000 });
  const first = await page.evaluate(() => window.__played[0].k);
  assert(first === 67, 'restart did not begin at G4');
  await AC.call('setMode', 'step');
  const fade = await silence();
  return `paused at note ${atPause.index + 1}, resumed there, 40 BPM spacing ${spacing.toFixed(2)} s, silent ${fade} ms after a mode change`;
});

/* 4 ---------------------------------------------------------------- */
await test('Step-by-Step: green key with finger and name, blue upcoming, advances only on the right key', async () => {
  await AC.call('setTempo', 60);
  await AC.call('setMode', 'step');
  const target = await AC.keyClasses(67);
  const next = await AC.keyClasses(69);
  const mark = await AC.mark(67);
  assert(target.includes('hl-target'), 'G4 not green');
  assert(next.includes('hl-next'), 'A4 not blue');
  assert(mark.finger === '1' && mark.note === 'G4', `G4 mark ${JSON.stringify(mark)}`);
  // first G4 with the computer keyboard
  await tap(67);
  let s = await AC.state();
  assert(s.index === 1 && s.marks[0] === 'ok', 'first G4 did not advance');
  // the repeated G4: holding it from before must not count — a new press is needed
  await page.keyboard.down('KeyT');
  await sleep(30);
  s = await AC.state();
  assert(s.index === 2, 'second G4 not accepted');
  await sleep(200);
  s = await AC.state();
  assert(s.index === 2, 'a held key advanced the lesson twice');
  await page.keyboard.up('KeyT');
  // a wrong key is detected, shown red, explained, and does not advance
  await tap(71, 80);
  s = await AC.state();
  assert(s.index === 2 && s.live.wrong === 1 && s.marks[2] === 'bad', 'wrong key not detected');
  assert(s.feedback.tone === 'bad' && s.feedback.text.includes('A4'), `feedback: ${s.feedback.text}`);
  assert((await AC.keyClasses(71)).includes('hl-wrong'), 'wrong key not red');
  // two keys at once (A4 together with B4): the right one counts, the other is not held against the player
  await page.evaluate(() => {
    const c = window.__pva.controller;
    c.keyDown('pointer:1', 69, 90);
    c.keyDown('pointer:2', 71, 90);
    c.keyUp('pointer:1', 69);
    c.keyUp('pointer:2', 71);
  });
  await sleep(100);
  s = await AC.state();
  assert(s.index === 3 && s.live.wrong === 1 && s.marks[2] === 'fixed', `simultaneous keys: index ${s.index}, wrong ${s.live.wrong}`);
  return 'green/blue keys, finger 1 + "G4" on the key, repeated note, wrong key, two keys at once';
});

/* 5 ---------------------------------------------------------------- */
await test('Step-by-Step: MIDI (note-on velocity 0 = off), mouse and computer keys finish the song', async () => {
  // note 4 (G4) by MIDI, released with a velocity-0 note-on
  await midiMsg(0x90, 67, 100);
  await midiMsg(0x90, 67, 0);
  let s = await AC.state();
  assert(s.index === 4, 'MIDI note-on did not advance');
  assert((await page.evaluate(() => window.__pva.controller.heldKeys())).length === 0, 'velocity-0 note-on did not release the key');
  // note 5 (C5) with the mouse on the on-screen key
  const box = await page.evaluate(() => {
    const r = document.querySelector('.key[data-midi="72"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.85 };
  });
  await page.mouse.click(box.x, box.y);
  s = await AC.state();
  assert(s.index === 5, 'mouse click did not advance');
  // the rest with the computer keyboard (one more wrong key on the way)
  for (let i = 5; i < 25; i++) {
    if (i === 14) await tap(74); // D5 instead of C5 ("dear")
    await tap(melody[i].midi);
  }
  await AC.waitStatus('finished', 5000);
  s = await AC.state();
  assert(s.result && s.result.mode === 'step', 'no result');
  assert(s.result.wrong === 2 && s.result.correct === 25, `result ${s.result.correct}/${s.result.wrong}`);
  assert(s.phraseDone.every(Boolean), 'phrases not all completed');
  assert(s.result.issues.map((i) => i.index).join(',') === '2,14', `issues ${JSON.stringify(s.result.issues)}`);
  await page.screenshot({ path: join(outDir, 'academy-step-result.png') });
  return `accuracy ${s.result.accuracy}%, issues at notes 3 and 15`;
});

/* 6 ---------------------------------------------------------------- */
await test('Guided Practice: count-in, notes and timing judged against the metronome', async () => {
  await AC.call('setMode', 'guided');
  await AC.call('setPhrase', 0);
  await AC.call('setTempo', 120);
  await AC.call('setMetronome', true);
  await reset();
  const p1 = melody.slice(0, 6);
  await AC.call('start');
  assert((await AC.state()).status === 'countin', 'no count-in');
  await botPlay(p1.map((n) => ({ midi: n.midi, at: n.start, holdMs: n.beats * 500 * 0.8 })));
  await AC.waitStatus('finished', 20000);
  const s = await AC.state();
  const clicks = await page.evaluate(() => window.__clicks);
  assert(clicks.length >= 5, `${clicks.length} clicks`);
  assert(clicks[0].accent && !clicks[1].accent && !clicks[2].accent && clicks[3].accent, 'count-in accents not on beat 1');
  assert(Math.abs(clicks[1].t - clicks[0].t - 0.5) < 0.002, 'click spacing at 120 BPM wrong');
  assert(s.result && s.result.correct === 6 && s.result.wrong === 0 && s.result.missed === 0, `result ${JSON.stringify(s.result)}`);
  assert(s.result.timing >= 80, `timing score ${s.result.timing}`);
  assert(s.result.range === 'phrase-1', 'range not recorded');
  return `count-in ${clicks.filter((c) => c.t < clicks[0].t + 2.4).length} clicks, phrase 1: ${s.result.accuracy}% notes, ${s.result.timing}% on time`;
});

/* 7 ---------------------------------------------------------------- */
await test('Guided Practice: a wrong note and a skipped note are reported', async () => {
  await AC.call('setPhrase', 1);
  await reset();
  await AC.call('start');
  const p2 = melody.slice(6, 12);
  const plan = p2
    .map((n, i) => ({ midi: i === 2 ? n.midi + 2 : n.midi, at: n.start, holdMs: 200 })) // A4 → B4 wrong
    .filter((_, i) => i !== 4); // D5 skipped
  await botPlay(plan);
  await AC.waitStatus('finished', 20000);
  const s = await AC.state();
  assert(s.result.correct === 4 && s.result.wrong === 1 && s.result.missed === 2, `result ${s.result.correct}/${s.result.wrong}/${s.result.missed}`);
  assert(s.marks[8] === 'bad' && s.marks[10] === 'missed', `marks ${s.marks.slice(6, 12)}`);
  await page.screenshot({ path: join(outDir, 'academy-guided-result.png') });
  return `accuracy ${s.result.accuracy}% (wrong A4, missed D5)`;
});

/* 8 ---------------------------------------------------------------- */
await test('Independent Performance: hidden help, alignment and rhythm at the player’s own tempo', async () => {
  await AC.call('setMode', 'perform');
  await AC.call('setPhrase', 3);
  await AC.call('setMetronome', false);
  const target = await AC.keyClasses(77);
  assert(!target.includes('hl-target') && !target.includes('hl-next'), 'keys are highlighted in performance mode');
  assert((await page.locator('.ac-strip').count()) === 0, 'upcoming notes are visible');
  await AC.call('start');
  // play phrase 4 at 90 BPM, evenly, from inside the page (MIDI)
  await page.evaluate((notes) => {
    const spb = 60 / 90;
    const t0 = performance.now();
    notes.forEach((n) => {
      const at = (n.start - notes[0].start) * spb * 1000;
      setTimeout(() => window.__pva.midi.handleMessage(new Uint8Array([0x90, n.midi, 90])), at);
      setTimeout(() => window.__pva.midi.handleMessage(new Uint8Array([0x80, n.midi, 0])), at + n.beats * spb * 800);
    });
    return t0;
  }, melody.slice(19, 25));
  await AC.waitStatus('finished', 15000); // ends by itself after the last note
  const s = await AC.state();
  assert(s.result.mode === 'perform' && s.result.correct === 6, `result ${JSON.stringify(s.result)}`);
  assert(Math.abs(s.result.playedBpm - 90) <= 4, `estimated ${s.result.playedBpm} BPM`);
  assert(s.result.timing >= 80, `rhythm ${s.result.timing}`);
  await page.screenshot({ path: join(outDir, 'academy-perform-result.png') });
  return `6/6 notes, ${s.result.playedBpm} BPM detected, rhythm ${s.result.timing}%`;
});

/* 9 ---------------------------------------------------------------- */
await test('MIDI keyboard unplugged during practice: lesson pauses, nothing hangs', async () => {
  await AC.call('setMode', 'watch');
  await AC.call('setPhrase', null);
  await AC.call('setTempo', 60);
  await AC.call('start');
  await midiMsg(0x90, 48, 100); // a key held on the "device"
  await sleep(1500);
  await page.evaluate(() => window.__pva.midi.events.emit('disconnected', { id: 'x', name: 'Test Keys' }));
  const s = await AC.state();
  assert(s.status === 'paused', `status ${s.status}`);
  assert(s.feedback.tone === 'warn' && s.feedback.text.includes('Test Keys'), 'no message about the device');
  assert((await page.evaluate(() => window.__pva.controller.heldKeys())).length === 0, 'MIDI key left hanging');
  await silence();
  return 'paused with a message';
});

/* 10 --------------------------------------------------------------- */
await test('Practice results are stored locally and survive a reload', async () => {
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('pva61.academy')));
  assert(stored && stored.v === 1, 'nothing stored');
  const sessions = stored.data.sessions;
  assert(sessions.length === 4, `${sessions.length} sessions stored`);
  assert(sessions.map((x) => x.mode).join(',') === 'step,guided,guided,perform', 'wrong sessions');
  const lesson = stored.data.lessons['happy-birthday'];
  assert(lesson.watched && lesson.passed.includes('step'), `lesson progress ${JSON.stringify(lesson)}`);
  await page.reload();
  await page.waitForFunction(() => window.__pva && !window.__pva.store.get().booting, null, { timeout: 30000 });
  const after = await page.evaluate(() => window.__pva.academy.store.get().progress);
  assert(after.sessions.length === 4 && after.lessons['happy-birthday'].watched, 'progress lost on reload');
  // damaged storage must not break the Academy
  await page.evaluate(() => window.localStorage.setItem('pva61.academy', '{"v":1,"data":{"sessions":"oops","lessons":[]}}'));
  await page.reload();
  await page.waitForFunction(() => window.__pva && !window.__pva.store.get().booting, null, { timeout: 30000 });
  const clean = await page.evaluate(() => window.__pva.academy.store.get().progress.sessions.length);
  assert(clean === 0, 'damaged storage not ignored');
  return `4 sessions, best step ${lesson.best.step}%, survives reload and damaged data`;
});

/* 11 --------------------------------------------------------------- */
await test('Leaving the Academy gives the instrument back unchanged', async () => {
  await page.evaluate(() => window.__pva.act.setMetronome(true));
  await page.getByRole('button', { name: 'Open the Piano Academy' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.waitForSelector('.panel--academy');
  await AC.call('setMode', 'step');
  await page.screenshot({ path: join(outDir, 'academy-step.png') });
  await page.getByRole('button', { name: 'Back to the instrument' }).dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' });
  await page.waitForSelector('.sec--master');
  const s = await page.evaluate(() => ({ tempo: window.__pva.clock.tempo, metro: window.__pva.store.get().metronomeOn, panel: window.__pva.store.get().tempo }));
  assert(s.tempo === s.panel && s.tempo === 120, `tempo not restored: clock ${s.tempo}`);
  assert(s.metro, 'panel metronome not restored');
  const lit = await page.evaluate(() => document.querySelectorAll('.keybed .hl-target, .keybed .hl-next, .keybed .key__mark--target').length);
  assert(lit === 0, 'lesson highlights left on the keys');
  await page.evaluate(() => window.__pva.act.setMetronome(false));
  // keys play normally, the lesson no longer listens
  await page.keyboard.down('KeyT');
  await sleep(80);
  const voices = await page.evaluate(() => window.__pva.voices.stats().total);
  await page.keyboard.up('KeyT');
  assert(voices >= 1, 'computer key does not play after leaving the Academy');
  const idx = await AC.state();
  assert(idx.index === 0 && idx.live.correct === 0, 'closed Academy still reacts to keys');
  return 'tempo 120 and metronome back, keys clean';
});

/* 12 --------------------------------------------------------------- */
await test('no stuck notes, silence, no console errors', async () => {
  await sleep(3500);
  const s = await page.evaluate(() => window.__pva.voices.stats());
  assert(s.total === 0, `${s.total} voices alive`);
  assert((await page.evaluate(() => window.__pva.controller.heldKeys())).length === 0, 'keys still held');
  assert(consoleErrors.length === 0, `console errors:\n        ${consoleErrors.join('\n        ')}`);
});

console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
await browser.close();
stop();
process.exit(failed ? 1 : 0);
