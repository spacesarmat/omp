import { useEffect, useRef, useState } from 'preact/hooks';
import { activeServer } from '../store/servers';
import { buildPairUri } from '../lib/pairing';
import { goBack, resetTo } from '../ui/nav';
import { toast } from '../ui/toast';
import { t, lang } from '../i18n';
import { phoneAttachCount } from '../phone/link';
import { FocusGroup, Button } from '../ui/components';
import { Qr } from '../ui/Qr';
import { restoreFocus } from '../ui/focus';
import { platformKind } from '../platform/env';
import { nativePlugin, ListenerHandle } from '../platform/androidNative';

const MIN_REFRESH_MS = 250;
const CODE_TTL_MS = 300000;

function backToCatalog(): void {
  toast(t('pair.phoneConnected'));
  resetTo(activeServer.value ? { name: 'library' } : { name: 'connect' });
}

interface CodeState {
  code: string | null;
  expiresAt: number;
  /** Why there is no code (Russian), null while there is one or it is loading. */
  error: string | null;
}

/** The native rejection when it is Russian (e.g. «Сервер управления не запустился»), else a generic text. */
function codeError(e: unknown): string {
  const m = e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '';
  return lang.peek() === 'ru' && /[\u0400-\u04FF]/.test(m) ? m : t('pair.noCode');
}

/**
 * Android TV: the pairing code for the phone remote (plugin pairingCode()). A new code replaces the previous one;
 * it is refreshed when it expires and on «Новый код» (the parent passes `generation`).
 */
function useRemoteCode(generation: number): CodeState {
  const [st, setSt] = useState<CodeState>({ code: null, expiresAt: 0, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const plugin = nativePlugin();
    if (!plugin) {
      setSt({ code: null, expiresAt: 0, error: t('pair.noCode') });
      return undefined;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    plugin.pairingCode().then(
      (r) => {
        if (!alive) return;
        const ok = r && typeof r.code === 'string' && /^[0-9]{4}$/.test(r.code);
        const exp = r && typeof r.expiresAt === 'number' && isFinite(r.expiresAt) ? r.expiresAt : Date.now() + CODE_TTL_MS;
        setSt({ code: ok ? r.code : null, expiresAt: exp, error: ok ? null : t('pair.noCode') });
        if (!ok) return;
        const wait = Math.min(CODE_TTL_MS, Math.max(MIN_REFRESH_MS, exp - Date.now()));
        timer = setTimeout(() => { if (alive) setTick((n) => n + 1); }, wait);
      },
      (e) => { if (alive) setSt({ code: null, expiresAt: 0, error: codeError(e) }); },
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
      <div class="pair-code-label">{t('pair.codeLabel')}</div>
      {!st.error && (
        <div class="pair-digits">
          {digits.map((d, i) => <span key={i} class="pair-digit">{d}</span>)}
        </div>
      )}
      {st.error ? (
        <div class="pair-code-hint pair-code-error">{st.error}</div>
      ) : (
        <div class="pair-code-hint">{t('pair.codeHint', { name: name || 'Android TV' })}</div>
      )}
    </div>
  );
}

function AndroidTvPair() {
  const srv = activeServer.value;
  const [generation, setGeneration] = useState(0);
  usePhonePaired(backToCatalog);
  // leaving the screen: the code shown here must not pair a phone any more
  useEffect(() => {
    const plugin = nativePlugin();
    return () => {
      if (plugin) plugin.clearPairingCode().catch(() => undefined);
    };
  }, []);
  return (
    <FocusGroup focusKey="PAIR-PHONE" className="screen pair-phone">
      <h1>{t('pair.title')}</h1>
      <div class="pair-row pair-row-top">
        {srv ? (
          <Qr text={buildPairUri({ url: srv.url, name: srv.name, user: srv.user, password: srv.password })} size={360} />
        ) : (
          <div class="pair-noserver">{t('pair.noServerQr')}</div>
        )}
        <div class="pair-side">
          <RemoteCodeBlock generation={generation} />
          <div class="pair-steps pair-steps-atv">
            <div>{t('pair.qrNote1')}</div>
            <div>{t('pair.qrNote2')}</div>
            <div>{t('pair.qrNote3')}</div>
          </div>
        </div>
      </div>
      {srv && <p class="muted">{t('pair.qrPassword')}</p>}
      <div class="row">
        <Button focusKey="pair-back" label={t('common.done')} onPress={() => goBack()} />
        <Button focusKey="pair-new-code" label={t('pair.newCode')} onPress={() => setGeneration((n) => n + 1)} />
      </div>
    </FocusGroup>
  );
}

function LgPair() {
  const srv = activeServer.value;
  return (
    <FocusGroup focusKey="PAIR-PHONE" className="screen pair-phone">
      <h1>{t('pair.title')}</h1>
      {!srv ? (
        <p>{t('errors.connectFirst')}</p>
      ) : (
        <div>
          <div class="pair-row">
            <Qr text={buildPairUri({ url: srv.url, name: srv.name, user: srv.user, password: srv.password })} size={360} />
            <div class="pair-steps">
              <div>{t('pair.step1')}</div>
              <div>{t('pair.step2')}</div>
              <div>{t('pair.step3')}</div>
              <div>{t('pair.step4')}</div>
            </div>
          </div>
          <p class="muted">{t('pair.qrPassword')}</p>
        </div>
      )}
      <div class="row">
        <Button focusKey="pair-back" label={t('common.done')} onPress={() => goBack()} />
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
