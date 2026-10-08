import { compileSong, type CompiledSong, type SongDef } from '../song';
import happyBirthday from './happy-birthday.json';

/**
 * The lesson songs. Each is a JSON file in this folder (see song.ts for the
 * format); it is validated and laid out on the clock grid once at start-up.
 */
export const HAPPY_BIRTHDAY: CompiledSong = compileSong(happyBirthday as SongDef);

export const SONGS: readonly CompiledSong[] = [HAPPY_BIRTHDAY];

export const songById = (id: string): CompiledSong | undefined => SONGS.find((s) => s.def.id === id);
