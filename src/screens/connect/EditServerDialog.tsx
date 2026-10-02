import { useState } from 'preact/hooks';
import { updateServer, removeServer, SavedServer } from '../../store/servers';
import { FocusGroup, Button, TextInput } from '../../ui/components';
import { useKeys } from '../../ui/keys';
import { confirmDialog } from '../../ui/dialog';
import { toast } from '../../ui/toast';

export function EditServerDialog(p: { server: SavedServer; onClose: () => void }) {
  const [name, setName] = useState(p.server.name);
  const [url, setUrl] = useState(p.server.url.replace(/^http:\/\//, ''));
  const [user, setUser] = useState(p.server.user || '');
  const [password, setPassword] = useState(p.server.password || '');

  // modal: keys never reach the screen below
  useKeys((a) => {
    if (a === 'back') { p.onClose(); return true; }
    return 'spatial';
  }, 60);

  const save = () => {
    if (!url.trim()) {
      toast('Введите адрес сервера', 'error');
      return;
    }
    const r = updateServer(p.server.id, { name, url, user, password });
    if (r === 'duplicate') {
      toast('Такой сервер уже есть', 'error');
      return;
    }
    toast('Сохранено');
    p.onClose();
  };

  const remove = () => {
    confirmDialog('Удалить сервер «' + p.server.name + '»?', 'Удалить').then((ok) => {
      if (!ok) return;
      removeServer(p.server.id);
      p.onClose();
    });
  };

  return (
    <div class="dialog-backdrop">
      <FocusGroup focusKey="EDIT-SERVER" className="dialog edit-server" boundary autoFocus>
        <div class="dialog-title">Изменить сервер</div>
        <label class="field-label">Название</label>
        <TextInput focusKey="edit-name" value={name} onChange={setName} placeholder="Например, Дом" />
        <label class="field-label">Адрес</label>
        <TextInput value={url} onChange={setUrl} placeholder="192.168.1.191:8090" type="url" />
        <div class="row">
          <div class="grow">
            <label class="field-label">Логин</label>
            <TextInput value={user} onChange={setUser} placeholder="Нет" />
          </div>
          <div class="grow">
            <label class="field-label">Пароль</label>
            <TextInput value={password} onChange={setPassword} placeholder="Нет" type="password" />
          </div>
        </div>
        <div class="muted small">Логин и пароль сохраняются вместе с сервером. Оставьте пустыми, если авторизация на TorrServer выключена.</div>
        <div class="row edit-actions">
          <Button label="Сохранить" className="primary grow" onPress={save} />
          <Button label="Отмена" onPress={p.onClose} />
          <Button label="Удалить" className="danger" onPress={remove} />
        </div>
      </FocusGroup>
    </div>
  );
}
