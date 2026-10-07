import { t } from '../i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { setFocus, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';
import { servers, addServer, setActiveServer, SavedServer } from '../store/servers';
import { TorrServerClient } from '../api/torrserver';
import { apiError, errorMessage, isApiError } from '../api/http';
import { discover, candidateSubnets, getLocalIp, FoundServer } from '../api/discovery';
import { resetTo, routeStack } from '../ui/nav';
import { FocusGroup, Focusable, Button, TextInput, Spinner } from '../ui/components';
import { Icon } from '../ui/icons';
import { restoreFocus } from '../ui/focus';
import { toast } from '../ui/toast';
import { platformKind } from '../platform/env';
import { nativeVpnState } from '../platform/androidNative';
import { addressErrorText, addressForField, checkServerAddress } from '../api/serverAddress';
import { Logo } from '../ui/Logo';
import { AddressField } from '../ui/AddressField';
import { ServerHistory } from './connect/ServerHistory';
import { EditServerDialog } from './connect/EditServerDialog';

/** A server that neither answers nor refuses is given up after this long. */
export const CONNECT_TIMEOUT_MS = 10000;

/** The server's /echo, or a timeout error after `ms` whatever the transport does (an old WebView may never settle). */
export function connectEcho(client: TorrServerClient, ms: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(apiError('timeout', 'Timeout')), ms);
    client.echo().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** «Не удалось подключиться к 192.168.1.191:8090 — проверьте адрес и порт»; a server that answered wrongly says how. */
export function connectErrorText(baseUrl: string, e: unknown): string {
  const host = baseUrl.replace(/^https?:\/\//i, '');
  if (isApiError(e) && (e.kind === 'http' || e.kind === 'parse')) return t('connect.unreachableWhy', { host: host, error: errorMessage(e) });
  return t('connect.unreachable', { host: host });
}

/** No server answered (a failed connect, an empty scan): VPN on → the VPN line; Android TV without one → the lockdown note. */
export function networkHint(vpn: { active: boolean } | null): string {
  if (!vpn) return '';
  return vpn.active ? t('connect.vpnHint') : t('connect.lockdownHint');
}

/** The server never answered (not a wrong answer): the network, not the server, may be the cause. */
function noAnswer(e: unknown): boolean {
  return !(isApiError(e) && (e.kind === 'http' || e.kind === 'parse'));
}

export function ConnectScreen() {
  const alive = useRef(true);
  const scanId = useRef(0);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [netHint, setNetHint] = useState('');
  const attempt = useRef(0);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<FoundServer[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<SavedServer | null>(null);

  useEffect(() => {
    restoreFocus('connect-url');
    return () => { alive.current = false; scanId.current++; };
  }, []);

  const focusHistoryButton = () => {
    if (doesFocusableExist('history-btn')) setFocus('history-btn');
    else if (doesFocusableExist('connect-url')) setFocus('connect-url');
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    focusHistoryButton();
  };

  const cancelScan = () => {
    scanId.current++;
    setScan(null);
  };

  const open = (s: SavedServer) => {
    cancelScan();
    setActiveServer(s.id);
    resetTo({ name: 'library' });
  };

  const connect = (address = url) => {
    if (busy) return;
    if (!address.trim()) {
      toast(t('connect.enterAddress'), 'error');
      return;
    }
    cancelScan();
    setNetHint('');
    const checked = checkServerAddress(address);
    if (!checked.ok) {
      const text = addressErrorText(checked.bad);
      setError(text);
      toast(text, 'error');
      return;
    }
    // the field shows what is tried: «１９２．１６８…：８０９０» becomes 192.168.1.124:8090
    if (address === url) setUrl(addressForField(checked.url));
    const my = ++attempt.current;
    const cfg = { url: checked.url, user: user || undefined, password: password || undefined };
    const client = new TorrServerClient(cfg);
    setBusy(true);
    setError('');
    connectEcho(client, CONNECT_TIMEOUT_MS).then(
      (v) => {
        if (!alive.current) return;
        toast(t('connect.connected', { version: v }));
        open(addServer(cfg));
      },
      (e) => {
        if (!alive.current) return;
        setBusy(false);
        const text = connectErrorText(client.baseUrl, e);
        setError(text);
        toast(text, 'error');
        if (noAnswer(e)) showNetHint(() => attempt.current === my);
        // the button stays focused: OK tries again
        if (doesFocusableExist('connect-btn')) setFocus('connect-btn');
      },
    );
  };

  /** The VPN / lockdown line under the error (Android TV only; LG has no vpnState). */
  const showNetHint = (current: () => boolean) => {
    nativeVpnState().then((v) => {
      if (alive.current && current()) setNetHint(networkHint(v));
    });
  };

  const scanNetwork = () => {
    const my = ++scanId.current;
    setNetHint('');
    setFound([]);
    setScan({ done: 0, total: 1 });
    getLocalIp()
      .then((ip) =>
        discover({
          subnets: candidateSubnets(ip, servers.value.map((s) => s.url)),
          isCancelled: () => !alive.current || scanId.current !== my,
          onProgress: (done, total) => { if (alive.current && scanId.current === my && (done % 16 === 0 || done === total)) setScan({ done, total }); },
          onFound: (s) => { if (alive.current && scanId.current === my) setFound((f) => f.concat(s)); },
        }),
      )
      .then((list) => {
        if (!alive.current || scanId.current !== my) return;
        setScan(null);
        if (!list.length) {
          toast(t('connect.noServersFound'), 'error');
          showNetHint(() => scanId.current === my);
        }
      })
      .catch((e) => {
        if (!alive.current || scanId.current !== my) return;
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
          {t('connect.history')}
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
          <label class="field-label">{t('connect.address')}</label>
          <AddressField focusKey="connect-url" value={url} onChange={setUrl} placeholder={t('connect.addressPlaceholder')} submitLabel={t('connect.connect')} onSubmit={() => connect()} />
          <Focusable focusKey="connect-advanced" className="link-toggle" onPress={() => setAdvanced(!advanced)}>
            <Icon name={advanced ? 'chevronUp' : 'chevronDown'} size={22} />
            {t('connect.advanced')}
          </Focusable>
          {advanced && (
            <div class="row">
              <TextInput value={user} onChange={setUser} placeholder={t('common.login')} />
              <TextInput value={password} onChange={setPassword} placeholder={t('common.password')} type="password" />
            </div>
          )}
          <div class="row">
            {/* never disabled while connecting: a disabled item would lose the focus; connect() ignores a second OK */}
            <Button focusKey="connect-btn" label={busy ? t('connect.connecting') : t('connect.connect')} className="primary grow" onPress={() => connect()} />
            <Button icon="search" label={t('connect.scan')} onPress={scanNetwork} disabled={!!scan} />
          </div>
          {(error || netHint) && !busy && (
            <div class="connect-error" role="alert">
              {error && <div>{error}</div>}
              {netHint && <div class="connect-net-hint">{netHint}</div>}
            </div>
          )}
        </div>
        {scan && <Spinner text={t('connect.scanning', { pct: Math.round((scan.done * 100) / scan.total) })} />}
        {found.map((f) => (
          <Focusable key={f.url} className="list-item" onPress={() => connect(f.url)}>
            <div class="title">{f.url}</div>
            <div class="meta">{f.version}</div>
          </Focusable>
        ))}
        <div class="connect-hint">
          {t('connect.scanNote')}
          {platformKind() !== 'androidtv' && <br />}
          {platformKind() !== 'androidtv' && t('connect.typeHint')}
        </div>
      </div>
      {editing && (
        <EditServerDialog
          server={editing}
          onClose={() => { setEditing(null); focusHistoryButton(); }}
        />
      )}
      <div class="hints">{routeStack.value.length > 1 ? t('connect.hintsBack') : t('connect.hintsExit')}</div>
    </FocusGroup>
  );
}
