// «В ролях» on the phone: the directors or creators first, then the actors; a tap opens the person screen.
import { t } from '../../../src/i18n';
import type { Person } from '../../../src/catalog/tmdb';
import { navigate } from '../nav';

export function CastStrip({ cast, part }: { cast: Person[]; part?: 'heads' | 'actors' }) {
  if (!cast.length) return null;
  const isHead = (p: Person) => p.job === 'director' || p.job === 'creator';
  const heads = cast.filter(isHead);
  const actors = cast.filter((p) => !isHead(p));
  const list = part === 'heads' ? heads : part === 'actors' ? actors : heads.concat(actors);
  if (!list.length) return null;
  const roleOf = (p: Person) => (p.job === 'director' ? t('titleCard.director') : p.job === 'creator' ? t('titleCard.creator') : p.role);
  const heading = part === 'heads' ? t('titleCard.creators') : t('titleCard.cast');
  return (
    <section class="m-tc-section">
      <h2>{heading}</h2>
      <div class="m-tc-cast">
        {list.map((p, i) => (
          <button key={i} type="button" class="m-tc-person" onClick={() => navigate({ name: 'person', id: p.id, label: p.name })}>
            {p.photo ? (
              <img src={p.photo} alt="" width={64} height={64} loading="lazy" />
            ) : (
              <span class="m-tc-initial" aria-hidden="true">
                {p.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span class="m-small m-tc-person-name">{p.name}</span>
            {roleOf(p) && <span class="m-small m-muted m-tc-person-name">{roleOf(p)}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
