// The row of people of a film or a series on the TV: the directors or creators first, then up to CAST_LIMIT actors.
// OK on a person opens the person screen. Shared by the title card, the series screen and the film's torrent screen.
import { useRef } from 'preact/hooks';
import { t } from '../i18n';
import { CAST_LIMIT, type Person } from '../catalog/tmdb';
import { FocusGroup, Focusable } from './components';
import { scrollToShow } from './focus';
import { navigate } from './nav';
import { tvGlyphs } from './tvText';

/** Inner margin of the rows that scroll sideways: a focused item keeps this much room to the row's edge. */
export const ROW_PAD = 24;

/** «СЧ» for «Сидни Чандлер»: the first letters of the first two words. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/** A row that does not wrap: it scrolls sideways so the focused item is whole. */
export function showInRow(row: HTMLElement | null, key: string): void {
  const el = row ? (row.querySelector('[data-fk="' + key + '"]') as HTMLElement | null) : null;
  if (!row || !el) return;
  row.scrollLeft = scrollToShow(row.scrollLeft, row.clientWidth, el.offsetLeft, el.offsetWidth, ROW_PAD);
}

export function CastRow({ cast, groupKey, focusPrefix }: { cast: Person[]; groupKey: string; focusPrefix: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const heads = cast.filter((p) => p.job !== 'cast');
  const shown = heads.concat(cast.filter((p) => p.job === 'cast').slice(0, CAST_LIMIT));
  const roleOf = (p: Person) => (p.job === 'director' ? t('titleCard.director') : p.job === 'creator' ? t('titleCard.creator') : p.role);
  return (
    <section class="tc-section">
      <h2 class="tc-h2">{t('titleCard.cast')}</h2>
      <div class="tc-scroll" ref={rowRef}>
        <FocusGroup focusKey={groupKey} className="tc-cast-row">
          {shown.map((p, i) => (
            <Focusable
              key={i}
              focusKey={focusPrefix + i}
              className="tc-person"
              onPress={() => navigate({ name: 'person', id: p.id, label: p.name })}
              onFocused={() => showInRow(rowRef.current, focusPrefix + i)}
            >
              <div class="tc-photo">{p.photo ? <img src={p.photo} alt="" /> : <span class="tc-initials">{tvGlyphs(initials(p.name))}</span>}</div>
              <div class="tc-person-name">{tvGlyphs(p.name)}</div>
              {roleOf(p) ? <div class="tc-person-role">{tvGlyphs(roleOf(p))}</div> : null}
            </Focusable>
          ))}
        </FocusGroup>
      </div>
    </section>
  );
}
