import { useEffect, useState } from 'preact/hooks';
import { servers, addServer, removeServer, setActiveServer, SavedServer } from '../store/servers';
import { TorrServerClient } from '../api/torrserver';
import { errorMessage } from '../api/http';
import { discover, candidateSubnets, getLocalIp, FoundServer } from '../api/discovery';
import { resetTo } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialog';
import { Logo } from '../ui/Logo';

export function ConnectScreen() {
  const [status, setStatus] = useState<{ [id: string]: string }>({});
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<FoundServer[]>([]);

  useEffect(() => {
    restoreFocus('CONNECT');
    servers.value.forEach((s) => {
      new TorrServerClient(s).echo().then(
        (v) => setStatus((p) => ({ ...p, [s.id]: 'онлайн · ' + v })),
        (e) => setStatus((p) => ({ ...p, [s.id]: 'недоступен: ' + errorMessage(e) })),
      );
    });
  }, []);

  const open = (s: SavedServer) => {
    setActiveServer(s.id);
    resetTo({ name: 'library' });
  };

  const connect = (address = url) => {
    if (busy) return;
    if (!address.trim()) {
      toast('Введите адрес сервера', 'error');
      return;
    }
    const cfg = { url: address, user: user || undefined, password: password || undefined };
    setBusy(true);
    new TorrServerClient(cfg).echo().then(
      (v) => {
        toast('Подключено: ' + v);
        open(addServer(cfg));
      },
      (e) => {
        setBusy(false);
        toast(errorMessage(e), 'error');
      },
    );
  };

  const scanNetwork = () => {
    setFound([]);
    setScan({ done: 0, total: 1 });
    getLocalIp()
      .then((ip) =>
        discover({
          subnets: candidateSubnets(ip, servers.value.map((s) => s.url)),
          onProgress: (done, total) => { if (done % 16 === 0 || done === total) setScan({ done, total }); },
          onFound: (s) => setFound((f) => f.concat(s)),
        }),
      )
      .then((list) => {
        setScan(null);
        if (!list.length) toast('Серверы TorrServer не найдены', 'error');
      })
      .catch((e) => {
        setScan(null);
        toast(errorMessage(e), 'error');
      });
  };

  const remove = (s: SavedServer) => {
    confirmDialog('Удалить сервер «' + s.name + '»?', 'Удалить').then((ok) => {
      if (ok) removeServer(s.id);
    });
  };

  return (
    <FocusGroup focusKey="CONNECT" className="screen connect">
      <div class="brand">
        <Logo size={96} />
        <div>
          <h1 class="brand-title">OMP</h1>
          <div class="muted">Open Movie Player</div>
        </div>
      </div>
      {servers.value.length > 0 && (
        <section>
          <h2>Сохранённые серверы</h2>
          {servers.value.map((s) => (
            <div class="row" key={s.id}>
              <Focusable focusKey={'server-' + s.id} className="list-item grow" onPress={() => open(s)}>
                <div class="title">{s.name}</div>
                <div class="meta">{s.url} · {status[s.id] || 'проверка…'}</div>
              </Focusable>
              <Button label="Удалить" onPress={() => remove(s)} />
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Новый сервер</h2>
        <TextInput focusKey="connect-url" value={url} onChange={setUrl} placeholder="Адрес, например 192.168.1.191:8090" onSubmit={() => connect()} />
        <div class="row">
          <TextInput value={user} onChange={setUser} placeholder="Логин (если включена авторизация)" />
          <TextInput value={password} onChange={setPassword} placeholder="Пароль" type="password" />
        </div>
        <div class="row">
          <Button label={busy ? 'Подключение…' : 'Подключиться'} onPress={() => connect()} disabled={busy} />
          <Button label="Найти в сети" onPress={scanNetwork} disabled={!!scan} />
        </div>
        {scan && <Spinner text={'Поиск серверов… ' + Math.round((scan.done * 100) / scan.total) + '%'} />}
        {found.map((f) => (
          <Focusable key={f.url} className="list-item" onPress={() => connect(f.url)}>
            <div class="title">{f.url}</div>
            <div class="meta">{f.version}</div>
          </Focusable>
        ))}
      </section>
    </FocusGroup>
  );
}
