import { searchTones, toneById, tonesInCategory, type ToneDef } from '../data/tones';
import type { AppState } from './appState';

/** The tones the browser lists right now (category, favourites, recent or search result). */
export function browserList(s: Pick<AppState, 'browserTab' | 'browserCategory' | 'browserQuery' | 'favorites' | 'recent'>): ToneDef[] {
  const resolve = (ids: string[]): ToneDef[] => ids.map(toneById).filter((t): t is ToneDef => t !== undefined);
  switch (s.browserTab) {
    case 'favorites':
      return resolve(s.favorites).sort((a, b) => a.number - b.number);
    case 'recent':
      return resolve(s.recent);
    case 'search':
      return searchTones(s.browserQuery);
    default:
      return tonesInCategory(s.browserCategory);
  }
}
