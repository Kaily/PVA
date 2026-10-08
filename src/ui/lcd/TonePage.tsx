import { memo, useEffect, useMemo, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretLeft, faCaretRight, faClockRotateLeft, faMagnifyingGlass, faStar, faXmark } from '@fortawesome/free-solid-svg-icons';
import { pad } from '../../core/math';
import { CATEGORY_LABEL, type ToneDef } from '../../data/tones';
import * as act from '../../state/actions';
import { browserList } from '../../state/browser';
import { stepCategory } from '../../state/params';
import { useApp } from '../hooks';
import { press } from './press';

/**
 * Tone browser: categories, favourites, recently used tones and instant
 * search. It edits the part that is selected on the panel (Upper 1, Upper 2
 * or Lower). Tones the instrument cannot play are listed, marked N/A, and
 * say why when they are pressed.
 */
export function TonePage() {
  const tab = useApp((s) => s.browserTab);
  const category = useApp((s) => s.browserCategory);
  const query = useApp((s) => s.browserQuery);
  const favorites = useApp((s) => s.favorites);
  const recent = useApp((s) => s.recent);
  const current = useApp((s) => s.parts[s.selectedPart].toneId);
  const loading = useApp((s) => s.toneLoading);
  const library = useApp((s) => s.library);

  const list = useMemo(
    () => browserList({ browserTab: tab, browserCategory: category, browserQuery: query, favorites, recent }),
    [tab, category, query, favorites, recent],
  );
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // The panel never takes the keyboard focus (buttons act on pointer-down), so
  // the search box would keep it — and keep swallowing the note keys — after
  // the player has moved on. Any press outside the box gives the keyboard back.
  useEffect(() => {
    const release = (e: PointerEvent): void => {
      const box = input.current;
      if (!box || document.activeElement !== box) return;
      if (e.target instanceof Node && box.parentElement?.contains(e.target)) return;
      box.blur();
    };
    document.addEventListener('pointerdown', release, true);
    return () => document.removeEventListener('pointerdown', release, true);
  }, []);

  // Keep the selected tone inside the visible part of the list.
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>('.is-current');
    if (!el) return;
    if (!row) {
      el.scrollTop = 0;
      return;
    }
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [current, list]);

  const empty =
    tab === 'favorites'
      ? 'No favourites yet. Press the star next to a tone.'
      : tab === 'recent'
        ? 'Tones you select appear here.'
        : tab === 'search'
          ? `No tone matches “${query.trim()}”.`
          : 'This category is empty.';

  return (
    <div className="lcd-browser">
      <div className="lcd-browser__bar">
        <div className={`lcd-tab lcd-tab--cat${tab === 'category' ? ' is-on' : ''}`}>
          <button type="button" className="lcd-tab__step" aria-label="Previous category" {...press(() => stepCategory(-1))}>
            <FontAwesomeIcon icon={faCaretLeft} />
          </button>
          <button type="button" className="lcd-tab__name" aria-pressed={tab === 'category'} {...press(() => act.setBrowserTab('category'))}>
            {CATEGORY_LABEL[category]}
          </button>
          <button type="button" className="lcd-tab__step" aria-label="Next category" {...press(() => stepCategory(+1))}>
            <FontAwesomeIcon icon={faCaretRight} />
          </button>
        </div>
        <button
          type="button"
          className={`lcd-tab${tab === 'favorites' ? ' is-on' : ''}`}
          aria-pressed={tab === 'favorites'}
          {...press(() => act.setBrowserTab('favorites'))}
        >
          <FontAwesomeIcon icon={faStar} />
          Fav
        </button>
        <button
          type="button"
          className={`lcd-tab${tab === 'recent' ? ' is-on' : ''}`}
          aria-pressed={tab === 'recent'}
          {...press(() => act.setBrowserTab('recent'))}
        >
          <FontAwesomeIcon icon={faClockRotateLeft} />
          Recent
        </button>
        <label className={`lcd-search${tab === 'search' ? ' is-on' : ''}`}>
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <input
            ref={input}
            type="text"
            inputMode="search"
            value={query}
            placeholder="Search"
            aria-label="Search tones by name, number or category"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => act.setBrowserQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                act.setBrowserQuery('');
                e.currentTarget.blur();
              } else if (e.key === 'Enter') {
                const first = list.find((t) => t.available);
                if (first) void act.selectTone(first.id);
                e.currentTarget.blur();
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="lcd-search__clear"
              aria-label="Clear search"
              {...press(() => {
                act.setBrowserQuery('');
                input.current?.blur();
              })}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </label>
      </div>

      {library === 'error' && (
        <div className="lcd-browser__note">
          <span>The tone library file could not be loaded. The grand piano and the modelled tones still play.</span>
          <button type="button" {...press(act.retryLibrary)}>
            Retry
          </button>
        </div>
      )}

      <div className="lcd-tones" ref={box} role="listbox" aria-label={`Tones, ${list.length} listed`}>
        {list.length === 0 && <div className="lcd-tones__empty">{empty}</div>}
        {list.map((t) => (
          <ToneRow key={t.id} tone={t} current={t.id === current} loading={t.id === loading} favorite={favSet.has(t.id)} />
        ))}
      </div>
    </div>
  );
}

const ToneRow = memo(function ToneRow({
  tone,
  current,
  loading,
  favorite,
}: {
  tone: ToneDef;
  current: boolean;
  loading: boolean;
  favorite: boolean;
}) {
  return (
    <div className={`lcd-trow${current ? ' is-current' : ''}${tone.available ? '' : ' is-na'}${loading ? ' is-loading' : ''}`}>
      <button
        type="button"
        role="option"
        aria-selected={current}
        className="lcd-trow__pick"
        title={tone.available ? undefined : tone.unavailableReason}
        {...press(() => void act.selectTone(tone.id))}
      >
        <span className="lcd-trow__num">{pad(tone.number, 3)}</span>
        <span className="lcd-trow__name">{tone.name}</span>
        {!tone.available && <span className="lcd-trow__na">N/A</span>}
        {loading && <span className="lcd-trow__na">…</span>}
      </button>
      {tone.available && (
        <button
          type="button"
          className={`lcd-trow__fav${favorite ? ' is-on' : ''}`}
          aria-label={favorite ? `Remove ${tone.name} from favourites` : `Add ${tone.name} to favourites`}
          aria-pressed={favorite}
          {...press(() => act.toggleFavorite(tone.id))}
        >
          <FontAwesomeIcon icon={faStar} />
        </button>
      )}
    </div>
  );
});
