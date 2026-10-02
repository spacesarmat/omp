import { useMemo } from 'preact/hooks';
import qrcode from 'qrcode-generator';

const QUIET = 2;
const CRISP: any = { 'shape-rendering': 'crispEdges' };

/** Offline QR code as a single SVG path (white background for scanning from a dark screen). */
export function Qr(p: { text: string; size?: number }) {
  const size = p.size || 220;
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(p.text);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) path += 'M' + (c + QUIET) + ' ' + (r + QUIET) + 'h1v1h-1z';
      }
    }
    return { n: count + QUIET * 2, d: path };
  }, [p.text]);
  return (
    <svg class="qr" width={size} height={size} viewBox={'0 0 ' + n + ' ' + n} aria-hidden="true" {...CRISP}>
      <rect width={n} height={n} fill="#fff"></rect>
      <path d={d} fill="#000"></path>
    </svg>
  );
}
