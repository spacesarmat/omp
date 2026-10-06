// The size of a search row in the UI language («69,4 ГБ» / «69.4 GB»), through the shared fmtBytes the torrent
// screen uses. Sites write sizes their own way («69.35 GB», «1,37 ГБ»): the bytes are parsed back, and a size that
// cannot be read stays as the site wrote it.
import { fmtBytes } from '../i18n';
import { parseSize } from './html';

export function resultSizeText(r: { Size?: string; sizeBytes?: number }): string {
  const known = typeof r.sizeBytes === 'number' && isFinite(r.sizeBytes) && r.sizeBytes > 0 ? r.sizeBytes : null;
  const bytes = known !== null ? known : parseSize(r.Size || '');
  // the nudge rounds a written half up as the site meant it: 69.35 GB is 69,4, not 69,3 (binary 69.3499…)
  return bytes !== null && bytes > 0 ? fmtBytes(bytes * (1 + 1e-9)) : r.Size || '';
}
