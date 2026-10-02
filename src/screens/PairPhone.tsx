import { useEffect } from 'preact/hooks';
import { activeServer } from '../store/servers';
import { buildPairUri } from '../lib/pairing';
import { goBack } from '../ui/nav';
import { FocusGroup, Button } from '../ui/components';
import { Qr } from '../ui/Qr';
import { restoreFocus } from '../ui/focus';

export function PairPhoneScreen() {
  const srv = activeServer.value;
  useEffect(() => {
    restoreFocus('pair-back');
  }, []);
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
