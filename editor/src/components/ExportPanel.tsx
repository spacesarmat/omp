import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReleaseIntent } from '../../../design/schema.ts';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';
import { createEditorClient, EditorApiError, formatEditorIssue, type EditorClient } from '../client';
import type { ExportResult } from '../../export.mjs';

export interface ExportPanelProps {
  controller: DraftController;
  client?: EditorClient;
}

export function ExportPanel({ controller, client }: ExportPanelProps) {
  const draft = useDraftController(controller);
  const [version, setVersion] = useState('0.20.12-beta.3');
  const [channel, setChannel] = useState<'beta' | 'stable'>('beta');
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, issues]);
  const saveIntent = () => {
    try {
      controller.update((current) => {
        const intent: ReleaseIntent = { target: current.target, version: version.trim(), channel };
        current.theme.releaseIntents = [...current.theme.releaseIntents.filter((entry) => entry.target !== current.target), intent];
        return current;
      });
      setError('');
      setIssues([]);
    } catch (reason) {
      setIssues([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const runExport = async () => {
    setBusy(true);
    setError('');
    setIssues([]);
    setResult(null);
    try {
      await controller.flush();
      setResult(await (client || createEditorClient()).exportDraft(draft));
    } catch (reason) {
      setIssues(reason instanceof EditorApiError ? reason.issues : []);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="editor-export">
      <h3>Релиз и экспорт</h3>
      <strong>{draft.target}</strong>
      {draft.target !== 'desktop-windows' && <p class="editor-notice">package unavailable</p>}
      <label>Версия
        <input data-testid="release-version" value={version} onChange={(event) => setVersion(event.currentTarget.value)} />
      </label>
      <label>Канал
        <select data-testid="release-channel" value={channel} onChange={(event) => setChannel(event.currentTarget.value as 'beta' | 'stable')}>
          <option value="beta">beta</option>
          <option value="stable">stable</option>
        </select>
      </label>
      <button type="button" data-action="save-release" onClick={saveIntent}>Сохранить намерение</button>
      <button type="button" data-action="export" disabled={busy} onClick={runExport}>{busy ? 'Экспорт...' : 'Экспортировать'}</button>
      {error && (
        <div class="editor-export-error" ref={errorRef} role="alert" tabIndex={-1}>
          <strong>{error}</strong>
          {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={index}>{formatEditorIssue(issue)}</li>)}</ul>}
        </div>
      )}
      {result && (
        <div class="editor-export-result">
          <strong>Файлы экспортированы</strong>
          <ul>{result.files.map((file) => <li key={file}>{file}</li>)}</ul>
          <code>git diff -- design</code>
        </div>
      )}
    </section>
  );
}
