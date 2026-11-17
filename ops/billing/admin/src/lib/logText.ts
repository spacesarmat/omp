/** Line filter for the admin log window. A blank query keeps every line. */

export function filterLogLines(text: string, query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  return text
    .split('\n')
    .filter((line) => line.toLowerCase().indexOf(q) >= 0)
    .join('\n');
}

export type HealthLine = {
  name: string;
  ok: boolean | null;
  latencyMs: number;
  lastError?: string;
};

/** Short lines, then the same rows as JSON, for the source-check window. */
export function healthReport(rows: HealthLine[]): string {
  const lines = rows.map((row) => {
    const state = row.ok === true ? 'ок' : row.ok === false ? 'нет' : '-';
    const err = row.lastError ? ' · ' + row.lastError : '';
    return row.name + ': ' + state + ', ' + row.latencyMs + ' мс' + err;
  });
  return lines.join('\n') + '\n\n' + JSON.stringify(rows, null, 2);
}
