import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReleaseIntent } from '../../../design/schema.ts';
import type { LayoutIssue } from '../../../design/layout-checks.ts';
import type { DraftController } from '../drafts';
import { useDraftController } from '../useDraftController';
import { createEditorClient, EditorApiError, formatEditorIssue, type EditorClient } from '../client';
import { EDITOR_TARGET_LABELS } from '../../shared/routes';
import { AccessibilityPanel } from './AccessibilityPanel';
import type { ExportDiff, ExportResult, ExportScope } from '../../export.mjs';

export interface ExportPanelProps {
  controller: DraftController;
  client?: EditorClient;
  issues?: LayoutIssue[];
  geometryConfirmed?: boolean;
  onGeometryConfirm?: (confirmed: boolean) => void;
}

export function ExportPanel({ controller, client, issues: accessibilityIssues, geometryConfirmed = false, onGeometryConfirm }: ExportPanelProps) {
  const draft = useDraftController(controller);
  const [version, setVersion] = useState('0.20.12-beta.3');
  const [channel, setChannel] = useState<'beta' | 'stable'>('beta');
  const [scopeKind, setScopeKind] = useState<'all' | 'page' | 'component'>('all');
  const [componentId, setComponentId] = useState('');
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [diff, setDiff] = useState<ExportDiff | null>(null);
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
  const scopeFor = (): ExportScope => {
    if (scopeKind === 'page') return { kind: 'page', screenId: draft.screenId };
    if (scopeKind === 'component') return { kind: 'component', nodeId: componentId.trim() };
    return { kind: 'all' };
  };
  const runExport = async () => {
    setBusy(true);
    setError('');
    setIssues([]);
    setResult(null);
    try {
      await controller.flush();
      setResult(await (client || createEditorClient()).exportDraft(draft, { scope: scopeFor() }));
    } catch (reason) {
      setIssues(reason instanceof EditorApiError ? reason.issues : []);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const runDiff = async () => {
    setError('');
    setIssues([]);
    setDiff(null);
    try {
      const activeClient = client || createEditorClient();
      if (!activeClient.exportDiff) return;
      setDiff(await activeClient.exportDiff(draft, { scope: scopeFor() }));
    } catch (reason) {
      setIssues(reason instanceof EditorApiError ? reason.issues : []);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const geometryWarnings = (accessibilityIssues ?? []).some((issue) => issue.severity === 'warning');
  const geometryBlocked = geometryWarnings && !geometryConfirmed;
  const errorIssues = (accessibilityIssues ?? []).filter((issue) => issue.severity === 'error');
  const errorBlocked = errorIssues.length > 0;
  const componentBlocked = scopeKind === 'component' && !componentId.trim();
  const diffAvailable = Boolean(client?.exportDiff);
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
      <label>Область экспорта
        <select data-testid="export-scope" value={scopeKind} onChange={(event) => setScopeKind(event.currentTarget.value as 'all' | 'page' | 'component')}>
          <option value="all">Всё</option>
          <option value="page">Страница ({draft.screenId})</option>
          <option value="component">Компонент</option>
        </select>
      </label>
      {scopeKind === 'component' && (
        <label>Node id
          <input data-testid="export-component" value={componentId} onChange={(event) => setComponentId(event.currentTarget.value)} />
        </label>
      )}
      {accessibilityIssues && (
        <AccessibilityPanel
          issues={accessibilityIssues}
          geometryConfirmed={geometryConfirmed}
          onGeometryConfirm={(confirmed) => onGeometryConfirm?.(confirmed)}
        />
      )}
      {geometryWarnings && !geometryConfirmed && (
        <p class="editor-notice" data-testid="geometry-confirm-notice">Экспорт ожидает подтверждения предупреждений геометрии</p>
      )}
      {errorBlocked && (
        <p class="editor-notice" data-testid="accessibility-error-notice">
          Экспорт заблокирован ошибками доступности: {errorIssues.map((issue) => issue.code).join(', ')}
        </p>
      )}
      {diffAvailable && (
        <button type="button" data-action="show-diff" disabled={busy || componentBlocked} onClick={runDiff}>Показать diff</button>
      )}
      {diff && !error && (
        <div class="editor-export-diff">
          <strong>Изменения в скоупе</strong>
          <ul>
            {diff.files.map((file) => (
              <li key={file.path}><code>{file.action}</code> {file.path}</li>
            ))}
          </ul>
          {diff.foreignDirty.length > 0 && (
            <p class="editor-notice">Вне скоупа, не изменятся: {diff.foreignDirty.join(', ')}</p>
          )}
        </div>
      )}
      <button
        type="button"
        data-action="export"
        disabled={busy || geometryBlocked || errorBlocked || componentBlocked}
        onClick={runExport}
      >
        {busy ? 'Экспорт...' : 'Экспортировать'}
      </button>
      {error && (
        <div class="editor-export-error" ref={errorRef} role="alert" tabIndex={-1}>
          <strong>{error}</strong>
          {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={index}>{formatEditorIssue(issue)}</li>)}</ul>}
        </div>
      )}
      {result && (
        <div class="editor-export-result">
          <strong>Файлы экспортированы</strong>
          {result.targets.length > 0 && (
            <p>Затронутые платформы: {result.targets.map((target) => EDITOR_TARGET_LABELS[target] ?? target).join(', ')}</p>
          )}
          <ul>{result.files.map((file) => <li key={file}>{file}</li>)}</ul>
          <code>git diff -- design</code>
        </div>
      )}
    </section>
  );
}
