import { useState } from 'preact/hooks';
import type { FlowDocument } from '../../../design/schema.ts';
import { simulatePreviewClick, type SimulationResult } from '../simulation';

export interface SimulationPanelProps {
  flow: FlowDocument;
  serverConnected: boolean;
  onServerConnected(value: boolean): void;
  error?: string;
}

export function SimulationPanel({ flow, serverConnected, onServerConnected, error }: SimulationPanelProps) {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [localError, setLocalError] = useState('');
  const run = async () => {
    try {
      setLocalError('');
      setResult(await simulatePreviewClick({ flow, serverConnected }));
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <section class="editor-simulation">
      <h3>Симуляция</h3>
      <label>
        <input data-testid="server-connected" type="checkbox" checked={serverConnected} onChange={(event) => onServerConnected(event.currentTarget.checked)} />
        TorrServer подключён
      </label>
      <button type="button" data-action="simulate" onClick={run}>Нажать «Продолжить»</button>
      {(error || localError) && <p role="alert">{error || localError}</p>}
      {result && (
        <div class="editor-simulation-result">
          <strong>Экран: {result.route}</strong>
          {result.toast && <p>{result.toast}</p>}
          <ol>
            {result.trace.map((entry) => (
              <li data-trace-entry key={entry.ruleId}>
                {entry.action}{entry.target ? ` -> ${entry.target}` : ''}{entry.condition ? ` (${JSON.stringify(entry.condition)})` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
