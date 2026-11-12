/** Postgres storage for bot reply templates, with a short cache invalidated by bot_copy_meta.rev. */
import { applyBuilt, copyLangOk, copyStateOk, pickVariant, templateById, validateCopy } from './botCopy.mjs';

const META = 'default';
const HISTORY = 40;

let syncIds = new Set();
let syncRows = new Map();

export function resetCopyCache() {
  syncIds = new Set();
  syncRows = new Map();
}

/** True after warm() once any saved variant of this template exists. False before the first warm. */
export function hasCustomSync(id) {
  return syncIds.has(String(id || ''));
}

/** Saved rows for a template, or null when that template was not saved. Empty before warm(). */
export function customRowsSync(id) {
  return syncRows.get(String(id || '')) || null;
}

function publish(map) {
  const ids = new Set();
  for (const key of map.keys()) ids.add(key);
  syncIds = ids;
  syncRows = map;
}

function rowOf(row) {
  return {
    subState: row.sub_state || '',
    lang: row.lang || '',
    body: row.body || '',
    mediaKind: row.media_kind || '',
    mediaUrl: row.media_url || '',
    buttons: row.buttons == null ? null : row.buttons,
    author: row.author || '',
    updatedAt: Number(row.updated_at) || 0,
  };
}

function jsonButtons(buttons) {
  return buttons == null ? null : JSON.stringify(buttons);
}

const repos = new WeakMap();

export function botCopyRepoFor(store) {
  if (!store || typeof store.query !== 'function') return null;
  let repo = repos.get(store);
  if (!repo) {
    repo = createBotCopyRepo(store);
    repos.set(store, repo);
  }
  return repo;
}

export function createBotCopyRepo(store, opts) {
  const checkMs = opts && opts.checkMs !== undefined ? opts.checkMs : 1000;
  const query = (sql, params) => store.query(sql, params);
  let box = null;

  async function load(force) {
    const now = Date.now();
    if (!force && box && now - box.at < checkMs) return box;
    try {
      const revRes = await query('SELECT rev FROM bot_copy_meta WHERE id = $1', [META]);
      const rev = revRes.rows[0] ? Number(revRes.rows[0].rev) : 0;
      if (!force && box && box.rev === rev) {
        box.at = now;
        publish(box.map);
        return box;
      }
      const rows = await query(
        'SELECT template_id, sub_state, lang, body, media_kind, media_url, buttons, author, updated_at FROM bot_copy',
      );
      const map = new Map();
      for (let i = 0; i < rows.rows.length; i++) {
        const row = rows.rows[i];
        const id = row.template_id;
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(rowOf(row));
      }
      box = { rev, map, at: now };
      publish(map);
      return box;
    } catch (e) {
      if (!e || e.code !== '42P01') throw e;
      box = { rev: 0, map: new Map(), at: now };
      publish(box.map);
      return box;
    }
  }

  function drop() {
    box = null;
  }

  async function tx(fn) {
    if (typeof store.withClient === 'function') return store.withClient(fn);
    return fn(query);
  }

  async function writeVersion(q, row, action, now, author) {
    await q(
      `INSERT INTO bot_copy_versions
        (template_id, sub_state, lang, body, media_kind, media_url, buttons, author, created_at, action)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [row.templateId, row.subState, row.lang, row.body, row.mediaKind, row.mediaUrl, jsonButtons(row.buttons), author, now, action],
    );
    await q(
      `DELETE FROM bot_copy_versions WHERE id IN (
         SELECT id FROM bot_copy_versions
         WHERE template_id = $1 AND sub_state = $2 AND lang = $3
         ORDER BY id DESC
         OFFSET $4
       )`,
      [row.templateId, row.subState, row.lang, HISTORY],
    );
    await q('UPDATE bot_copy_meta SET rev = rev + 1 WHERE id = $1', [META]);
  }

  async function upsert(q, row, author, now) {
    await q(
      `INSERT INTO bot_copy (template_id, sub_state, lang, body, media_kind, media_url, buttons, author, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (template_id, sub_state, lang) DO UPDATE SET
         body = EXCLUDED.body,
         media_kind = EXCLUDED.media_kind,
         media_url = EXCLUDED.media_url,
         buttons = EXCLUDED.buttons,
         author = EXCLUDED.author,
         updated_at = EXCLUDED.updated_at`,
      [row.templateId, row.subState, row.lang, row.body, row.mediaKind, row.mediaUrl, jsonButtons(row.buttons), author, now],
    );
  }

  return {
    warm() {
      return load(false);
    },
    async saved(id) {
      const current = await load(false);
      return current.map.get(id) || [];
    },
    async overview() {
      const current = await load(false);
      const out = {};
      for (const [id, rows] of current.map) {
        out[id] = rows.map((row) => ({ state: row.subState, lang: row.lang, updatedAt: row.updatedAt, author: row.author }));
      }
      return out;
    },
    async lookup(id, state, lang) {
      const current = await load(false);
      return pickVariant(current.map.get(id) || [], state || '', lang || '');
    },
    async anyCustom(ids) {
      const current = await load(false);
      const list = ids || [];
      for (let i = 0; i < list.length; i++) if ((current.map.get(list[i]) || []).length) return true;
      return false;
    },
    async apply(spec, built) {
      if (!spec || !spec.id) return applyBuilt(null, built, {});
      const row = await this.lookup(spec.id, spec.state, spec.lang);
      return applyBuilt(row, built, spec.vars || {});
    },
    async history(id, state, lang) {
      const res = await query(
        `SELECT id, body, media_kind, media_url, buttons, author, created_at, action
         FROM bot_copy_versions
         WHERE template_id = $1 AND sub_state = $2 AND lang = $3
         ORDER BY id DESC
         LIMIT $4`,
        [id, state || '', lang || '', HISTORY],
      );
      return res.rows.map((row) => ({
        id: Number(row.id),
        body: row.body || '',
        mediaKind: row.media_kind || '',
        mediaUrl: row.media_url || '',
        buttons: row.buttons == null ? null : row.buttons,
        author: row.author || '',
        at: Number(row.created_at) || 0,
        action: row.action || '',
      }));
    },
    async save(input, author, now) {
      const template = templateById(input && input.id);
      if (!template) return { ok: false, error: 'Неизвестный шаблон' };
      const state = String((input && input.state) || '');
      const lang = String((input && input.lang) || '');
      if (!copyStateOk(state) || !copyLangOk(lang)) return { ok: false, error: 'Неизвестный вариант' };
      const checked = validateCopy(template, input || {});
      if (!checked.ok) return { ok: false, error: checked.errors[0] || 'Некорректный текст', errors: checked.errors };
      const who = String(author || '').slice(0, 80);
      const at = Number(now) || Date.now();
      const value = checked.value;
      const row = {
        templateId: template.id,
        subState: state,
        lang,
        body: value.body,
        mediaKind: value.mediaKind,
        mediaUrl: value.mediaUrl,
        buttons: value.buttons,
      };
      await tx(async (q) => {
        await upsert(q, row, who, at);
        await writeVersion(q, row, 'save', at, who);
      });
      drop();
      await load(true);
      return { ok: true };
    },
    async restore(id, versionId, author, now) {
      const template = templateById(id);
      if (!template) return { ok: false, error: 'Неизвестный шаблон' };
      const found = await query('SELECT * FROM bot_copy_versions WHERE id = $1', [Number(versionId)]);
      const prev = found.rows[0];
      if (!prev || prev.template_id !== template.id) return { ok: false, error: 'Версия не найдена' };
      const who = String(author || '').slice(0, 80);
      const at = Number(now) || Date.now();
      const row = {
        templateId: prev.template_id,
        subState: prev.sub_state || '',
        lang: prev.lang || '',
        body: prev.body || '',
        mediaKind: prev.media_kind || '',
        mediaUrl: prev.media_url || '',
        buttons: prev.buttons == null ? null : prev.buttons,
      };
      await tx(async (q) => {
        await upsert(q, row, who, at);
        await writeVersion(q, row, 'restore', at, who);
      });
      drop();
      await load(true);
      return { ok: true, state: row.subState, lang: row.lang };
    },
    async reset(id, state, lang, author, now) {
      const template = templateById(id);
      if (!template) return { ok: false, error: 'Неизвестный шаблон' };
      const st = String(state || '');
      const ln = String(lang || '');
      if (!copyStateOk(st) || !copyLangOk(ln)) return { ok: false, error: 'Неизвестный вариант' };
      const current = await query(
        'SELECT body, media_kind, media_url, buttons FROM bot_copy WHERE template_id = $1 AND sub_state = $2 AND lang = $3',
        [template.id, st, ln],
      );
      if (!current.rows[0]) return { ok: true, cleared: false };
      const prev = current.rows[0];
      const who = String(author || '').slice(0, 80);
      const at = Number(now) || Date.now();
      await tx(async (q) => {
        await q('DELETE FROM bot_copy WHERE template_id = $1 AND sub_state = $2 AND lang = $3', [template.id, st, ln]);
        await writeVersion(
          q,
          {
            templateId: template.id,
            subState: st,
            lang: ln,
            body: prev.body || '',
            mediaKind: prev.media_kind || '',
            mediaUrl: prev.media_url || '',
            buttons: prev.buttons == null ? null : prev.buttons,
          },
          'reset',
          at,
          who,
        );
      });
      drop();
      await load(true);
      return { ok: true, cleared: true };
    },
  };
}
