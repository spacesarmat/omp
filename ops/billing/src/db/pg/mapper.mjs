/**
 * State rows ↔ table rows (spec.mjs). encodeRow/decodeRow are exact inverses for JSON rows:
 * decodeRow(encodeRow(row)) deep-equals row, whatever fields and value types the row has.
 */
import { fits } from './spec.mjs';

const ARRAYS = '$arrays';
const SCALAR = '$scalar';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Row keys starting with "$" get one more "$" so they never collide with the markers. */
function escKey(k) {
  return k.charAt(0) === '$' ? '$' + k : k;
}

function unescKey(k) {
  return k.charAt(0) === '$' ? k.slice(1) : k;
}

function encodeFields(cols, obj, skip) {
  const values = new Array(cols.length).fill(null);
  const extra = {};
  const known = new Map();
  for (let i = 0; i < cols.length; i++) known.set(cols[i][0], i);
  const keys = Object.keys(obj);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (skip && skip.has(key)) continue;
    const v = obj[key];
    if (v === undefined) continue;
    const i = known.get(key);
    if (i !== undefined && fits(cols[i][2], v)) {
      values[i] = cols[i][2] === 'json' ? JSON.stringify(v) : v;
    } else {
      extra[escKey(key)] = v;
    }
  }
  return { values, extra };
}

function decodeFields(cols, values, extra, out) {
  for (let i = 0; i < cols.length; i++) {
    if (values[i] !== null && values[i] !== undefined) out[cols[i][0]] = values[i];
  }
  const keys = Object.keys(extra || {});
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (key === ARRAYS || key === SCALAR) continue;
    out[unescKey(key)] = extra[key];
  }
  return out;
}

/** The identity of a state row in its table, or throws: a row without one cannot be stored. */
export function rowKey(spec, row) {
  const v = isPlainObject(row) ? row[spec.key] : undefined;
  if (typeof v !== 'string' || !v) throw new Error('postgres store: ' + spec.name + ' row without a string ' + spec.key);
  return v;
}

/**
 * Encode one collection row. Returns { key, values (spec.cols order; id collections exclude the id),
 * extra, children: { [table]: [{ values, extra } | { value }] } }.
 */
export function encodeRow(spec, row) {
  if (!isPlainObject(row)) throw new Error('postgres store: ' + spec.name + ' row is not an object');
  const key = rowKey(spec, row);
  const skip = new Set(spec.key === 'id' ? ['id'] : []);
  const children = {};
  const arrays = [];
  const kids = spec.children || [];
  for (let c = 0; c < kids.length; c++) {
    const ch = kids[c];
    const list = row[ch.field];
    if (!Array.isArray(list)) continue;
    skip.add(ch.field);
    arrays.push(ch.field);
    children[ch.table] = list.map((item) => {
      if (ch.scalar) return { value: JSON.stringify(item === undefined ? null : item) };
      if (!isPlainObject(item)) return { values: new Array(ch.cols.length).fill(null), extra: { [SCALAR]: item === undefined ? null : item } };
      return encodeFields(ch.cols, item, null);
    });
  }
  const { values, extra } = encodeFields(spec.cols, row, skip);
  if (arrays.length) extra[ARRAYS] = arrays;
  return { key, values, extra, children };
}

/** Rebuild a state row from its table row and child rows ({ [table]: rows in ord order }). */
export function decodeRow(spec, key, values, extra, children) {
  const out = {};
  if (spec.key === 'id') out.id = key;
  decodeFields(spec.cols, values, extra, out);
  const arrays = new Set((extra && extra[ARRAYS]) || []);
  const kids = spec.children || [];
  for (let c = 0; c < kids.length; c++) {
    const ch = kids[c];
    if (!arrays.has(ch.field)) continue;
    const rows = (children && children[ch.table]) || [];
    out[ch.field] = rows.map((r) => {
      if (ch.scalar) return r.value;
      if (r.extra && Object.prototype.hasOwnProperty.call(r.extra, SCALAR)) return r.extra[SCALAR];
      return decodeFields(ch.cols, r.values, r.extra, {});
    });
  }
  return out;
}
