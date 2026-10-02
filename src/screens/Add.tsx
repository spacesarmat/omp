import { useEffect, useRef, useState } from 'preact/hooks';
import { client } from '../store/servers';
import type { SearchSource } from '../api/torrserver';
import type { SearchResult } from '../api/types';
import { errorMessage } from '../api/http';
import { mapSearchCategory } from '../lib/category';
import { replaceRoute } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, ChoiceRow, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';

const SOURCES: { value: SearchSource; label: string }[] = [
  { value: 'rutor', label: 'Rutor' },
  { value: 'torznab', label: 'Torznab (Jackett)' },
];

export function AddScreen() {
  const c = client.value!;
  const alive = useRef(true);
  const [link, setLink] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SearchSource>('rutor');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    restoreFocus('ADD');
    return () => { alive.current = false; };
  }, []);

  const add = (p: { link: string; title?: string; category?: string }) => {
    if (busy) return;
    const l = p.link.trim();
    if (!l) {
      toast('Введите magnet-ссылку, хеш или URL .torrent', 'error');
      return;
    }
    setBusy(true);
    c.add({ link: l, title: p.title, category: p.category }).then(
      (t) => {
        if (!alive.current) return;
        toast('Добавлено: ' + (t.title || p.title || t.hash));
        replaceRoute({ name: 'torrent', hash: t.hash });
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const search = () => {
    if (busy) return;
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setResults(null);
    c.search(q, source).then(
      (r) => {
        if (!alive.current) return;
        setBusy(false);
        setResults(r);
        if (!r.length) toast('Ничего не найдено');
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  return (
    <FocusGroup focusKey="ADD" className="screen add">
      <h1>Добавить торрент</h1>
      <h2>Magnet-ссылка, хеш или URL .torrent</h2>
      <div class="row">
        <TextInput focusKey="add-link" value={link} onChange={setLink} placeholder="magnet:?xt=urn:btih:…" onSubmit={() => add({ link })} />
        <Button label="Добавить" onPress={() => add({ link })} disabled={busy} />
      </div>
      <h2>Поиск</h2>
      <div class="row">
        <TextInput value={query} onChange={setQuery} placeholder="Название фильма или сериала" onSubmit={search} />
        <ChoiceRow label="Источник" value={source} options={SOURCES} onChange={setSource} />
        <Button label="Искать" onPress={search} disabled={busy} />
      </div>
      {busy && <Spinner text="Подождите…" />}
      {results && (
        <FocusGroup focusKey="ADD-RESULTS">
          {results.map((r, i) => (
            <Focusable
              key={i}
              focusKey={'res-' + i}
              className="list-item"
              onPress={() => add({ link: r.Magnet || r.Link, title: r.Title, category: mapSearchCategory(r.Categories) })}
            >
              <div class="title">{r.Title}</div>
              <div class="meta">
                {r.Size} · ⬆ {r.Seed} ⬇ {r.Peer} · {r.Tracker}{r.CreateDate ? ' · ' + r.CreateDate.slice(0, 10) : ''}
              </div>
            </Focusable>
          ))}
        </FocusGroup>
      )}
      <div class="hints">Текст удобно вводить с клавиатуры телефона в приложении LG ThinQ</div>
    </FocusGroup>
  );
}
