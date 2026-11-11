import { useState } from 'preact/hooks';
import type { DraftSnapshot } from '../../shared/draft';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

export interface SnapshotPanelProps {
  controller: DraftController;
  comparison?: DraftSnapshot | null;
  onCompare(snapshot: DraftSnapshot | null): void;
}

export function SnapshotPanel({ controller, comparison, onCompare }: SnapshotPanelProps) {
  const draft = useDraftController(controller);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const create = () => {
    try {
      controller.snapshot(name);
      setName('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <section class="editor-snapshot-panel">
      <div class="editor-snapshot-heading"><h3>История снимков</h3><span>{draft.snapshots.length}/10</span></div>
      <label>Имя снимка
        <input data-testid="snapshot-name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Например, новая тема" />
      </label>
      <button type="button" data-action="create-snapshot" onClick={create}>Создать снимок</button>
      {error && <p class="editor-issues" role="alert">{error}</p>}
      {draft.snapshots.length === 0 ? <p class="editor-notice">Снимков пока нет</p> : (
        <ul class="editor-snapshot-list">
          {draft.snapshots.map((snapshot) => (
            <li key={snapshot.id} data-snapshot-id={snapshot.id}>
              <div class="editor-snapshot-info"><strong>{snapshot.name}</strong><small>{new Date(snapshot.createdAt).toLocaleString('ru')}</small></div>
              <div class="editor-snapshot-actions">
                <button type="button" data-action="compare-snapshot" aria-pressed={comparison?.id === snapshot.id} onClick={() => onCompare(comparison?.id === snapshot.id ? null : snapshot)}>{comparison?.id === snapshot.id ? 'Текущий' : 'Сравнить'}</button>
                <button type="button" data-action="restore-snapshot" onClick={() => controller.restore(snapshot.id)}>Восстановить</button>
                <button type="button" data-action="delete-snapshot" aria-label={`Удалить ${snapshot.name}`} onClick={() => controller.deleteSnapshot(snapshot.id)}>Удалить</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
