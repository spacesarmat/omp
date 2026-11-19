// The size of a search row in the UI language («27,0 ГБ» / «27.0 GB»), the same fmtSize the release lines use.
// Sites write sizes their own way («69.35 GB», «1,37 ГБ»): the bytes are parsed back, and a size that
// cannot be read stays as the site wrote it.
import { fmtSize } from '../i18n';
import { parseSize } from './html';

/** Bytes of a search row: the parsed size, or the tracker's own text («5,1 ГБ») when the feed left bytes out. */
export function resultBytes(r: { Size?: string; sizeBytes?: number }): number | undefined {
  const known = typeof r.sizeBytes === 'number' && isFinite(r.sizeBytes) && r.sizeBytes > 0 ? r.sizeBytes : 0;
  if (known) return known;
  const parsed = parseSize(r.Size || '');
  return parsed !== null && parsed > 0 ? parsed : undefined;
}

export function resultSizeText(r: { Size?: string; sizeBytes?: number }): string {
  const known = typeof r.sizeBytes === 'number' && isFinite(r.sizeBytes) && r.sizeBytes > 0 ? r.sizeBytes : null;
  const bytes = known !== null ? known : parseSize(r.Size || '');
  // the nudge rounds a written half up as the site meant it: 69.35 GB is 69,4, not 69,3 (binary 69.3499…)
  return bytes !== null && bytes > 0 ? fmtSize(bytes * (1 + 1e-9)) : r.Size || '';
}
