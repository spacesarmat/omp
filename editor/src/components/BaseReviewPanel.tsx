import { useEffect, useState } from 'preact/hooks';
import type { CommittedDesign, RebaseResult } from '../../design.mjs';
import { EditorApiError, formatEditorIssue, type EditorClient } from '../client';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';

export interface BaseReviewPanelProps {
  controller: DraftController;
  client: EditorClient;
}

function fingerprint(draft: DraftController['draft']): string {
  const copy = { ...draft };
  delete copy.revision;
  delete copy.lastError;
  return JSON.stringify(copy);
}

export function BaseReviewPanel({ controller, client }: BaseReviewPanelProps) {
  const draft = useDraftController(controller);
  const [design, setDesign] = useState<CommittedDesign | null>(null);
  const [proposal, setProposal] = useState<(RebaseResult & { source: string }) | null>(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void client.getDesign().then((committed) => {
        if (!active || request !== generation) return;
        setDesign(committed);
        setError('');
        setIssues([]);
      }).catch((reason) => {
        if (!active || request !== generation) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setIssues(reason instanceof EditorApiError ? reason.issues : []);
      });
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [client]);

  const review = async () => {
    setBusy(true);
    setError('');
    setIssues([]);
    const source = fingerprint(draft);
    try {
      const result = await client.rebaseDraft(draft);
      setProposal({ ...result, source });
    } catch (reason) {
      setProposal(null);
      setIssues(reason instanceof EditorApiError ? reason.issues : []);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!proposal) return;
    if (fingerprint(draft) !== proposal.source) {
      setProposal(null);
      setIssues([]);
      setError('DRAFT_CHANGED_REVIEW_REQUIRED');
      return;
    }
    controller.rebase(proposal.draft);
    setDesign({ baseCommit: proposal.draft.baseCommit, theme: proposal.draft.theme, flow: proposal.draft.flow });
    setProposal(null);
    setError('');
    setIssues([]);
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
          {design && <details><summary>Итоговый черновик после слияния</summary><pre>{JSON.stringify(proposal.draft, null, 2)}</pre></details>}
          <button type="button" data-action="apply-base" onClick={apply}>Применить</button>
        </div>
      )}
      {error && (
        <div role="alert">
          <strong>{error}</strong>
          {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={index}>{formatEditorIssue(issue)}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
