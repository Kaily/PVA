/**
 * The few Node functions the unit tests use (reading the SoundFont from disk).
 * Declared here so the project does not need the whole @types/node package.
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
