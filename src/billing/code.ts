/** Same alphabet / rules as ops/billing crypto normalizeCode. */
export function normalizeCode(code: string): string {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '');
}
