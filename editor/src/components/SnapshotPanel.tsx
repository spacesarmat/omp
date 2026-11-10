import { useState } from 'preact/hooks';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

export function SnapshotPanel({ controller }: { controller: DraftController }) {
  const draft = useDraftController(controller);
  const [error, setError] = useState('');
  const limitReached = draft.snapshots.length >= 10;

  const create = () => {
    try {
      controller.snapshot(`Snapshot ${new Date().toISOString()}`);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const restore = (snapshotId: string) => {
    setError(controller.restore(snapshotId) ? '' : 'SNAPSHOT_NOT_FOUND');
  };

  return (
    <section class="editor-snapshots">
      <h3>Снимки</h3>
      <p class={limitReached ? 'editor-snapshot-limit' : 'editor-notice'} role="status">
        {limitReached ? 'Лимит 10/10 достигнут' : `Сохранено: ${draft.snapshots.length}/10`}
      </p>
      <button type="button" data-action="create-snapshot" disabled={limitReached} onClick={create}>Создать снимок</button>
      {draft.snapshots.length > 0 && (
        <ol>
          {draft.snapshots.map((snapshot) => (
            <li key={snapshot.id}>
              <span>{snapshot.name}</span>
              <time dateTime={snapshot.createdAt}>{snapshot.createdAt}</time>
              <button type="button" data-action="restore-snapshot" data-snapshot-id={snapshot.id} onClick={() => restore(snapshot.id)}>Восстановить</button>
            </li>
          ))}
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
