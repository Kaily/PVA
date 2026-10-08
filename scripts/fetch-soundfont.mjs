// Downloads the tone library (GeneralUser GS, 31 MB) into public/soundfonts/.
// The file ships with the project; this script is for a checkout that came
// without it. The download is pinned to one revision and checked against its
// SHA-256, so the tone table in src/data always matches the file.
//
//   node scripts/fetch-soundfont.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REVISION = '684543d5e5efaef08d02be50dcda8d552478fa60'; // GeneralUser GS 2.0.3
const URL = `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/${REVISION}/GeneralUser-GS.sf2`;
const SHA256 = '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'soundfonts');
const file = join(dir, 'GeneralUser-GS.sf2');
const sha = (data) => createHash('sha256').update(data).digest('hex');

if (existsSync(file) && sha(readFileSync(file)) === SHA256) {
  console.log('The tone library is already in place and intact.');
  process.exit(0);
}

console.log(`Downloading ${URL}`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const data = Buffer.from(await res.arrayBuffer());
if (sha(data) !== SHA256) {
  console.error('The downloaded file does not match the expected checksum — nothing was written.');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
writeFileSync(file, data);
console.log(`Saved ${(data.length / 1048576).toFixed(1)} MB to ${file}`);
