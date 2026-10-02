import { useEffect, useState } from 'preact/hooks';
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
        (v) => { if (!dead) setStatus((st) => ({ ...st, [s.id]: { online: true, text: 'онлайн · ' + v } })); },
        () => { if (!dead) setStatus((st) => ({ ...st, [s.id]: { online: false, text: 'недоступен' } })); },
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
                  {s.id === active && <span class="hist-current">текущий</span>}
                </div>
                <div class="hist-meta">{s.url.replace(/^https?:\/\//, '')} · {st ? st.text : 'проверка…'}</div>
              </div>
            </Focusable>
            <Button icon="pencil" label="Изменить" onPress={() => p.onEdit(s)} />
          </div>
        );
      })}
      <div class="hist-hint">OK — подключиться · Назад — закрыть список</div>
    </FocusGroup>
  );
}
