import { useState } from 'preact/hooks';
import type { DraftSnapshot } from '../../shared/draft';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

export interface SnapshotPanelProps {
  controller: DraftController;
  comparison?: DraftSnapshot | null;
  onCompare?(snapshot: DraftSnapshot | null): void;
}

export function SnapshotPanel({ controller, comparison, onCompare = () => undefined }: SnapshotPanelProps) {
  const draft = useDraftController(controller);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const limitReached = draft.snapshots.length >= 10;
  const create = () => {
    try {
      controller.snapshot(name);
      setName('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const restore = (snapshotId: string) => {
    setError(controller.restore(snapshotId) ? '' : 'SNAPSHOT_NOT_FOUND');
  };

  return (
    <section class="editor-snapshot-panel editor-snapshots">
      <div class="editor-snapshot-heading"><h3>История снимков</h3><span>{draft.snapshots.length}/10</span></div>
      <p class={limitReached ? 'editor-snapshot-limit' : 'editor-notice'} role="status">
        {limitReached ? 'Лимит 10/10 достигнут' : `Сохранено: ${draft.snapshots.length}/10`}
      </p>
      <label>Имя снимка
        <input data-testid="snapshot-name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Например, новая тема" />
      </label>
      <button type="button" data-action="create-snapshot" disabled={limitReached} onClick={create}>Создать снимок</button>
      {error && <p class="editor-issues" role="alert">{error}</p>}
      {draft.snapshots.length === 0 ? <p class="editor-notice">Снимков пока нет</p> : (
        <ol class="editor-snapshot-list">
          {draft.snapshots.map((snapshot) => (
            <li key={snapshot.id} data-snapshot-id={snapshot.id}>
              <div class="editor-snapshot-info"><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleString('ru')}</small></div>
              <div class="editor-snapshot-actions">
                <button type="button" data-action="compare-snapshot" aria-pressed={comparison?.id === snapshot.id} onClick={() => onCompare(comparison?.id === snapshot.id ? null : snapshot)}>{comparison?.id === snapshot.id ? 'Текущий' : 'Сравнить'}</button>
                <button type="button" data-action="restore-snapshot" onClick={() => restore(snapshot.id)}>Восстановить</button>
                <button type="button" data-action="delete-snapshot" aria-label={`Удалить ${snapshot.name}`} onClick={() => controller.deleteSnapshot(snapshot.id)}>Удалить</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
