import { useEffect, useRef, useState } from 'preact/hooks';
import { activeServer } from '../store/servers';
import { buildPairUri } from '../lib/pairing';
import { goBack, resetTo } from '../ui/nav';
import { toast } from '../ui/toast';
import { phoneAttachCount } from '../phone/link';
import { FocusGroup, Button } from '../ui/components';
import { Qr } from '../ui/Qr';
import { restoreFocus } from '../ui/focus';
import { platformKind } from '../platform/env';
import { nativePlugin, ListenerHandle } from '../platform/androidNative';

const MIN_REFRESH_MS = 250;
const CODE_TTL_MS = 300000;

function backToCatalog(): void {
  toast('Телефон подключён');
  resetTo(activeServer.value ? { name: 'library' } : { name: 'connect' });
}

interface CodeState {
  code: string | null;
  expiresAt: number;
  failed: boolean;
}

/**
 * Android TV: the pairing code for the phone remote (plugin pairingCode()). A new code replaces the previous one;
 * it is refreshed when it expires and on «Новый код» (the parent passes `generation`).
 */
function useRemoteCode(generation: number): CodeState {
  const [st, setSt] = useState<CodeState>({ code: null, expiresAt: 0, failed: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const plugin = nativePlugin();
    if (!plugin) {
      setSt({ code: null, expiresAt: 0, failed: true });
      return undefined;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    plugin.pairingCode().then(
      (r) => {
        if (!alive) return;
        const ok = r && typeof r.code === 'string' && /^[0-9]{4}$/.test(r.code);
        const exp = r && typeof r.expiresAt === 'number' && isFinite(r.expiresAt) ? r.expiresAt : Date.now() + CODE_TTL_MS;
        setSt({ code: ok ? r.code : null, expiresAt: exp, failed: !ok });
        if (!ok) return;
        const wait = Math.min(CODE_TTL_MS, Math.max(MIN_REFRESH_MS, exp - Date.now()));
        timer = setTimeout(() => { if (alive) setTick((n) => n + 1); }, wait);
      },
      () => { if (alive) setSt({ code: null, expiresAt: 0, failed: true }); },
    );
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [generation, tick]);
  return st;
}

function useTvName(): string {
  const [name, setName] = useState('');
  useEffect(() => {
    const plugin = nativePlugin();
    if (!plugin) return undefined;
    let alive = true;
    plugin.tvName().then(
      (r) => { if (alive && r && typeof r.name === 'string') setName(r.name); },
      () => undefined,
    );
    return () => { alive = false; };
  }, []);
  return name;
}

/** phonePaired from the native control server: the phone entered the code. */
function usePhonePaired(onPaired: () => void): void {
  const ref = useRef(onPaired);
  ref.current = onPaired;
  useEffect(() => {
    const plugin = nativePlugin();
    if (!plugin) return undefined;
    let alive = true;
    let handle: ListenerHandle | null = null;
    plugin.addListener('phonePaired', () => { if (alive) ref.current(); }).then(
      (h) => {
        if (alive) handle = h;
        else h.remove();
      },
      () => undefined,
    );
    return () => {
      alive = false;
      if (handle) handle.remove();
    };
  }, []);
}

function RemoteCodeBlock({ generation }: { generation: number }) {
  const st = useRemoteCode(generation);
  const name = useTvName();
  const digits = st.code ? st.code.split('') : ['–', '–', '–', '–'];
  return (
    <div class="pair-code">
      <div class="pair-code-label">Код для пульта на телефоне</div>
      <div class="pair-digits">
        {digits.map((d, i) => <span key={i} class="pair-digit">{d}</span>)}
      </div>
      {st.failed ? (
        <div class="pair-code-hint">Не удалось получить код — нажмите «Новый код»</div>
      ) : (
        <div class="pair-code-hint">На телефоне: OMP → Телевизор → «{name || 'Android TV'}» → введите код</div>
      )}
    </div>
  );
}

function AndroidTvPair() {
  const srv = activeServer.value;
  const [generation, setGeneration] = useState(0);
  usePhonePaired(backToCatalog);
  return (
    <FocusGroup focusKey="PAIR-PHONE" className="screen pair-phone">
      <h1>Подключить телефон</h1>
      <div class="pair-row pair-row-top">
        {srv ? (
          <Qr text={buildPairUri({ url: srv.url, name: srv.name, user: srv.user, password: srv.password })} size={360} />
        ) : (
          <div class="pair-noserver">Сначала подключитесь к серверу — тогда здесь появится QR</div>
        )}
        <div class="pair-side">
          <RemoteCodeBlock generation={generation} />
          <div class="pair-steps pair-steps-atv">
            <div>1. QR слева переносит сервер на телефон.</div>
            <div>2. Код подключает пульт и «Смотреть на ТВ».</div>
            <div>3. Код действует 5 минут.</div>
          </div>
        </div>
      </div>
      {srv && <p class="muted">QR содержит пароль сервера — не показывайте его посторонним.</p>}
      <div class="row">
        <Button focusKey="pair-back" label="Готово" onPress={() => goBack()} />
        <Button focusKey="pair-new-code" label="Новый код" onPress={() => setGeneration((n) => n + 1)} />
      </div>
    </FocusGroup>
  );
}

function LgPair() {
  const srv = activeServer.value;
  return (
    <FocusGroup focusKey="PAIR-PHONE" className="screen pair-phone">
      <h1>Подключить телефон</h1>
      {!srv ? (
        <p>Сначала подключитесь к серверу</p>
      ) : (
        <div>
          <div class="pair-row">
            <Qr text={buildPairUri({ url: srv.url, name: srv.name, user: srv.user, password: srv.password })} size={360} />
            <div class="pair-steps">
              <div>1. Установите OMP на Android-телефон (ссылка в README на GitHub).</div>
              <div>2. Откройте OMP на телефоне → «Сканировать QR с телевизора».</div>
              <div>3. Сервер, логин и пароль перенесутся автоматически.</div>
              <div>4. Выберите этот телевизор на телефоне — OMP сам вернётся в каталог.</div>
            </div>
          </div>
          <p class="muted">QR содержит пароль сервера — не показывайте его посторонним.</p>
        </div>
      )}
      <div class="row">
        <Button focusKey="pair-back" label="Готово" onPress={() => goBack()} />
      </div>
    </FocusGroup>
  );
}

export function PairPhoneScreen() {
  useEffect(() => {
    restoreFocus('pair-back');
  }, []);
  // the phone scanned the QR and linked to this TV: back to the catalog
  const attachesAtOpen = useRef(phoneAttachCount.value);
  const attaches = phoneAttachCount.value;
  useEffect(() => {
    if (attaches === attachesAtOpen.current) return;
    backToCatalog();
  }, [attaches]);
  return platformKind() === 'androidtv' ? <AndroidTvPair /> : <LgPair />;
}
