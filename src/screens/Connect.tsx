import { useEffect, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { servers, addServer, setActiveServer, SavedServer } from '../store/servers';
import { TorrServerClient } from '../api/torrserver';
import { errorMessage } from '../api/http';
import { discover, candidateSubnets, getLocalIp, FoundServer } from '../api/discovery';
import { resetTo } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { Icon } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { Logo } from '../ui/Logo';
import { ServerHistory } from './connect/ServerHistory';
import { EditServerDialog } from './connect/EditServerDialog';

export function ConnectScreen() {
  const alive = useRef(true);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<FoundServer[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<SavedServer | null>(null);

  useEffect(() => {
    restoreFocus('connect-url');
    return () => { alive.current = false; };
  }, []);

  const focusHistoryButton = () => {
    if (doesFocusableExist('history-btn')) setFocus('history-btn');
    else if (doesFocusableExist('connect-url')) setFocus('connect-url');
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    focusHistoryButton();
  };

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
        if (!alive.current) return;
        toast('Подключено: ' + v);
        open(addServer(cfg));
      },
      (e) => {
        if (!alive.current) return;
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
          onProgress: (done, total) => { if (alive.current && (done % 16 === 0 || done === total)) setScan({ done, total }); },
          onFound: (s) => { if (alive.current) setFound((f) => f.concat(s)); },
        }),
      )
      .then((list) => {
        if (!alive.current) return;
        setScan(null);
        if (!list.length) toast('Серверы TorrServer не найдены', 'error');
      })
      .catch((e) => {
        if (!alive.current) return;
        setScan(null);
        toast(errorMessage(e), 'error');
      });
  };

  return (
    <FocusGroup focusKey="CONNECT" className="screen connect">
      {servers.value.length > 0 && (
        <Focusable
          focusKey="history-btn"
          className={'history-btn' + (historyOpen ? ' open' : '')}
          onPress={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
        >
          <Icon name="history" size={28} />
          История серверов
          {historyOpen ? <Icon name="chevronUp" size={22} class="history-chevron" /> : <span class="history-count">{servers.value.length}</span>}
        </Focusable>
      )}
      {historyOpen && (
        <ServerHistory
          onConnect={open}
          onEdit={(s) => { setHistoryOpen(false); setEditing(s); }}
          onClose={closeHistory}
        />
      )}
      <div class={'connect-body' + (historyOpen ? ' dimmed' : '')}>
        <div class="brand brand-center">
          <Logo size={132} />
          <div>
            <h1 class="brand-title">OMP</h1>
            <div class="muted">Open Movie Player</div>
          </div>
        </div>
        <div class="connect-card">
          <label class="field-label">Адрес TorrServer</label>
          <TextInput focusKey="connect-url" value={url} onChange={setUrl} placeholder="Например, 192.168.1.191:8090" type="url" onSubmit={() => connect()} />
          <Focusable focusKey="connect-advanced" className="link-toggle" onPress={() => setAdvanced(!advanced)}>
            <Icon name={advanced ? 'chevronUp' : 'chevronDown'} size={22} />
            Дополнительно: логин и пароль
          </Focusable>
          {advanced && (
            <div class="row">
              <TextInput value={user} onChange={setUser} placeholder="Логин" />
              <TextInput value={password} onChange={setPassword} placeholder="Пароль" type="password" />
            </div>
          )}
          <div class="row">
            <Button label={busy ? 'Подключение…' : 'Подключиться'} className="primary grow" onPress={() => connect()} disabled={busy} />
            <Button icon="search" label="Найти в сети" onPress={scanNetwork} disabled={!!scan} />
          </div>
        </div>
        {scan && <Spinner text={'Поиск серверов… ' + Math.round((scan.done * 100) / scan.total) + '%'} />}
        {found.map((f) => (
          <Focusable key={f.url} className="list-item" onPress={() => connect(f.url)}>
            <div class="title">{f.url}</div>
            <div class="meta">{f.version}</div>
          </Focusable>
        ))}
        <div class="connect-hint">
          Поиск проверяет домашнюю сеть на портах 8090 и 5665.<br />
          Адрес удобно вводить с клавиатуры телефона в LG ThinQ.
        </div>
      </div>
      {editing && (
        <EditServerDialog
          server={editing}
          onClose={() => { setEditing(null); focusHistoryButton(); }}
        />
      )}
      <div class="hints">Стрелки — перемещение · OK — выбрать · Назад — выход</div>
    </FocusGroup>
  );
}
