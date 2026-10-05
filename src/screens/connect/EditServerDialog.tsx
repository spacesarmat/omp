import { useState } from 'preact/hooks';
import { updateServer, removeServer, SavedServer } from '../../store/servers';
import { FocusGroup, Button, TextInput } from '../../ui/components';
import { useKeys } from '../../ui/keys';
import { confirmDialog } from '../../ui/dialog';
import { toast } from '../../ui/toast';
import { t } from '../../i18n';

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
      toast(t('connect.enterAddress'), 'error');
      return;
    }
    const r = updateServer(p.server.id, { name, url, user, password });
    if (r === 'duplicate') {
      toast(t('connect.duplicate'), 'error');
      return;
    }
    toast(t('connect.saved'));
    p.onClose();
  };

  const remove = () => {
    confirmDialog(t('connect.deleteAsk', { name: p.server.name }), t('common.delete')).then((ok) => {
      if (!ok) return;
      removeServer(p.server.id);
      p.onClose();
    });
  };

  return (
    <div class="dialog-backdrop">
      <FocusGroup focusKey="EDIT-SERVER" className="dialog edit-server" boundary autoFocus>
        <div class="dialog-title">{t('connect.editTitle')}</div>
        <label class="field-label">{t('connect.name')}</label>
        <TextInput focusKey="edit-name" value={name} onChange={setName} placeholder={t('connect.namePlaceholder')} />
        <label class="field-label">{t('connect.addressShort')}</label>
        <TextInput value={url} onChange={setUrl} placeholder="192.168.1.191:8090" type="url" />
        <div class="row">
          <div class="grow">
            <label class="field-label">{t('common.login')}</label>
            <TextInput value={user} onChange={setUser} placeholder={t('connect.none')} />
          </div>
          <div class="grow">
            <label class="field-label">{t('common.password')}</label>
            <TextInput value={password} onChange={setPassword} placeholder={t('connect.none')} type="password" />
          </div>
        </div>
        <div class="muted small">{t('connect.authNote')}</div>
        <div class="row edit-actions">
          <Button label={t('common.save')} className="primary grow" onPress={save} />
          <Button label={t('common.cancel')} onPress={p.onClose} />
          <Button label={t('common.delete')} className="danger" onPress={remove} />
        </div>
      </FocusGroup>
    </div>
  );
}
