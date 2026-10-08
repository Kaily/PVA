// Copies the Salamander Grand Piano V3 MP3 samples (CC BY 3.0, Alexander Holm)
// from the @audio-samples/* npm packages into public/samples/salamander-grand,
// renaming each file to its MIDI note number so URLs need no escaping.
//
//   node scripts/import-salamander.mjs <path-to-node_modules/@audio-samples>
//
// Only needed when re-importing or adding velocity layers; the imported files
// are committed with the project.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src || !existsSync(src)) {
  console.error('usage: node scripts/import-salamander.mjs <node_modules/@audio-samples>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples', 'salamander-grand');
const LAYERS = [1, 4, 7, 10, 13, 16];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pad = (n, w) => String(n).padStart(w, '0');

let count = 0;
for (const layer of LAYERS) {
  const dir = join(out, `v${pad(layer, 2)}`);
  mkdirSync(dir, { recursive: true });
  for (let midi = 21; midi <= 108; midi += 3) {
    const name = `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
    copyFileSync(join(src, `piano-mp3-velocity${layer}`, 'audio', `${name}v${layer}.mp3`), join(dir, `${pad(midi, 3)}.mp3`));
    count++;
  }
}
const relDir = join(out, 'rel');
mkdirSync(relDir, { recursive: true });
for (let key = 1; key <= 88; key++) {
  copyFileSync(join(src, 'piano-mp3-release', 'audio', `rel${key}.mp3`), join(relDir, `${pad(key + 20, 3)}.mp3`));
  count++;
}
console.log(`imported ${count} files into ${out}`);
