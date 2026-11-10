import { useEffect, useState } from 'preact/hooks';
import type { CommittedDesign, RebaseResult } from '../../design.mjs';
import type { EditorClient } from '../client';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

export interface BaseReviewPanelProps {
  controller: DraftController;
  client: EditorClient;
}

export function BaseReviewPanel({ controller, client }: BaseReviewPanelProps) {
  const draft = useDraftController(controller);
  const [design, setDesign] = useState<CommittedDesign | null>(null);
  const [proposal, setProposal] = useState<RebaseResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setProposal(null);
    void client.getDesign().then((committed) => {
      if (active) setDesign(committed);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [client, draft.baseCommit]);

  const review = async () => {
    setBusy(true);
    setError('');
    try {
      setProposal(await client.rebaseDraft(draft));
    } catch (reason) {
      setProposal(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!proposal) return;
    controller.rebase(proposal.draft);
    setDesign({ baseCommit: proposal.draft.baseCommit, theme: proposal.draft.theme, flow: proposal.draft.flow });
    setProposal(null);
  };
  const stale = design?.baseCommit !== draft.baseCommit;

  return (
    <section class="editor-base-review">
      <h3>Версия из Git</h3>
      {stale ? (
        <>
          <p>Новая версия: <code>{design?.baseCommit.slice(0, 8)}</code></p>
          <button type="button" data-action="review-base" disabled={busy} onClick={review}>
            {busy ? 'Проверка...' : 'Проверить изменения'}
          </button>
        </>
      ) : <p role="status">База актуальна</p>}
      {proposal && (
        <div class="editor-base-proposal">
          <strong>Можно применить без потери локальных правок</strong>
          {proposal.changes.length ? <ul>{proposal.changes.map((path) => <li key={path}>{path}</li>)}</ul> : <p>Изменилась только база Git.</p>}
          {design && <details><summary>Содержимое новой версии</summary><pre>{JSON.stringify(design, null, 2)}</pre></details>}
          <button type="button" data-action="apply-base" onClick={apply}>Применить</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
