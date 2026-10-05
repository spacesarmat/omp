import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { servers, activeServerId, SavedServer } from '../../store/servers';
import { TorrServerClient } from '../../api/torrserver';
import { FocusGroup, Focusable, Button } from '../../ui/components';
import { useKeys } from '../../ui/keys';

export function ServerHistory(p: { onConnect: (s: SavedServer) => void; onEdit: (s: SavedServer) => void; onClose: () => void }) {
  const [status, setStatus] = useState<{ [id: string]: { online: boolean; text: string } }>({});

  useEffect(() => {
    let dead = false;
    servers.value.forEach((s) => {
      new TorrServerClient(s).echo().then(
        (v) => { if (!dead) setStatus((st) => ({ ...st, [s.id]: { online: true, text: t('connect.online', { version: v }) } })); },
        () => { if (!dead) setStatus((st) => ({ ...st, [s.id]: { online: false, text: t('connect.offline') } })); },
      );
    });
    return () => { dead = true; };
  }, []);

  useKeys((a) => {
    if (a === 'back') { p.onClose(); return true; }
    return false;
  }, 50);

  const active = activeServerId.value;
  return (
    <FocusGroup
      focusKey="SERVER-HISTORY"
      className="server-history"
      boundary
      autoFocus
      preferredChildFocusKey={active ? 'hist-' + active : undefined}
    >
      {servers.value.map((s) => {
        const st = status[s.id];
        return (
          <div class="hist-card" key={s.id}>
            <Focusable focusKey={'hist-' + s.id} className="hist-main" onPress={() => p.onConnect(s)}>
              <span class={'hist-dot' + (st && st.online ? ' online' : '')} />
              <div class="hist-text">
                <div class="hist-name">
                  {s.name}
                  {s.id === active && <span class="hist-current">{t('connect.current')}</span>}
                </div>
                <div class="hist-meta">{s.url.replace(/^https?:\/\//, '')} · {st ? st.text : t('connect.checking')}</div>
              </div>
            </Focusable>
            <Button icon="pencil" label={t('connect.edit')} onPress={() => p.onEdit(s)} />
          </div>
        );
      })}
      <div class="hist-hint">{t('connect.historyHint')}</div>
    </FocusGroup>
  );
}
