import type { LayoutIssue } from '../../../design/layout-checks.ts';

export interface AccessibilityPanelProps {
  issues: LayoutIssue[];
  geometryConfirmed: boolean;
  onGeometryConfirm(confirmed: boolean): void;
}

export function AccessibilityPanel({ issues, geometryConfirmed, onGeometryConfirm }: AccessibilityPanelProps) {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  return (
    <section class="editor-accessibility" data-testid="accessibility-panel">
      <h3>Доступность</h3>
      <p class="editor-accessibility-summary" data-testid="accessibility-summary">
        Ошибок: {errors}. Предупреждений: {warnings}.
      </p>
      {issues.length > 0 ? (
        <ul data-testid="accessibility-issues">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.nodeId}-${index}`} data-severity={issue.severity}>
              <span class="editor-issue-badge">{issue.severity}</span>{' '}
              <code>{issue.code}</code> <span class="editor-issue-node">{issue.nodeId}</span>: {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        <p class="editor-notice">Проблем не найдено</p>
      )}
      {warnings > 0 && (
        <label class="editor-accessibility-confirm">
          <span>Экспортировать с предупреждениями геометрии</span>
          <input
            type="checkbox"
            data-testid="confirm-geometry-warnings"
            checked={geometryConfirmed}
            onChange={(event) => onGeometryConfirm(event.currentTarget.checked)}
          />
        </label>
      )}
    </section>
  );
}
