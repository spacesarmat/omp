/** Admin HTTP for the bot reply constructor. */
import { roleOf } from './desk.mjs';
import {
  CATALOG,
  applyBuilt,
  copyLangOk,
  copyStateOk,
  previewNodes,
  renderBody,
  sampleVars,
  templateById,
  validateCopy,
} from './botCopy.mjs';

const sends = new Map();

export function isBotCopyPath(path) {
  return path.indexOf('/admin/api/bot-replies') === 0;
}

export function resetBotCopySends() {
  sends.clear();
}

function allowSend(id, now) {
  const key = String(id || '');
  const prev = sends.get(key) || [];
  const fresh = prev.filter((t) => now - t < 60000);
  if (fresh.length >= 5) {
    sends.set(key, fresh);
    return false;
  }
  fresh.push(now);
  sends.set(key, fresh);
  return true;
}

function publicTemplate(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    variables: row.variables,
    required: row.required,
  };
}

export async function routeBotCopy(req, res, deps) {
  const path = deps.path;
  const repo = deps.repo;
  const json = deps.json;
  if (!repo) {
    json(res, 503, { error: 'down' });
    return;
  }
  const admin = deps.adminOf(req);
  if (!admin) {
    json(res, 401, { auth: false });
    return;
  }

  if (req.method === 'GET' && path === '/admin/api/bot-replies') {
    const id = deps.url.searchParams.get('id') || '';
    if (!id) {
      const saved = await repo.overview();
      json(res, 200, {
        templates: CATALOG.map((row) => ({ ...publicTemplate(row), saved: saved[row.id] || [] })),
        csrf: admin.csrf,
      });
      return;
    }
    const template = templateById(id);
    if (!template) {
      json(res, 404, { error: 'Неизвестный шаблон' });
      return;
    }
    const state = deps.url.searchParams.get('state') || '';
    const lang = deps.url.searchParams.get('lang') || '';
    if (!copyStateOk(state) || !copyLangOk(lang)) {
      json(res, 400, { error: 'Неизвестный вариант' });
      return;
    }
    const rows = await repo.saved(id);
    const picked = rows.find((row) => row.subState === state && row.lang === lang) || null;
    const body = picked ? picked.body : template.body;
    const preview = renderBody(body, sampleVars(template));
    json(res, 200, {
      template: publicTemplate(template),
      variant: {
        state,
        lang,
        body,
        mediaKind: picked ? picked.mediaKind : '',
        mediaUrl: picked ? picked.mediaUrl : '',
        buttons: picked ? picked.buttons : null,
        customized: !!picked,
        author: picked ? picked.author : '',
        updatedAt: picked ? picked.updatedAt : 0,
      },
      preview,
      nodes: previewNodes(preview),
      history: await repo.history(id, state, lang),
      csrf: admin.csrf,
    });
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { error: 'method' });
    return;
  }
  const body = await deps.readBody(req);
  if (!body || body.csrf !== admin.csrf) {
    json(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  const settings = (await deps.store.read()).settings;
  if (roleOf(settings, admin) !== 'full') {
    json(res, 403, { ok: false, error: 'Режим только просмотра' });
    return;
  }
  const author = String(admin.telegramId || (admin.via === 'cli' ? 'cli' : '')).slice(0, 80);
  const now = Date.now();

  if (path === '/admin/api/bot-replies/save') {
    const out = await repo.save(body, author, now);
    json(res, out.ok ? 200 : 400, out);
    return;
  }
  if (path === '/admin/api/bot-replies/restore') {
    const out = await repo.restore(body.id, body.versionId, author, now);
    json(res, out.ok ? 200 : 400, out);
    return;
  }
  if (path === '/admin/api/bot-replies/reset') {
    const out = await repo.reset(body.id, body.state, body.lang, author, now);
    json(res, out.ok ? 200 : 400, out);
    return;
  }
  if (path === '/admin/api/bot-replies/send') {
    const template = templateById(body.id);
    if (!template) {
      json(res, 400, { ok: false, error: 'Неизвестный шаблон' });
      return;
    }
    const checked = validateCopy(template, body);
    if (!checked.ok) {
      json(res, 400, { ok: false, error: checked.errors[0], errors: checked.errors });
      return;
    }
    const chat = String(admin.telegramId || '');
    if (!chat) {
      json(res, 400, { ok: false, error: 'Нет Telegram у этой сессии. Войдите через Telegram.' });
      return;
    }
    if (!allowSend(chat, now)) {
      json(res, 429, { ok: false, error: 'Слишком часто. Подождите минуту.' });
      return;
    }
    if (!settings.botToken) {
      json(res, 400, { ok: false, error: 'Токен бота не задан' });
      return;
    }
    const applied = applyBuilt(checked.value, { text: '' }, sampleVars(template));
    const sent = await deps.telegramSend(settings.botToken, chat, applied.text, {
      parseMode: applied.parseMode,
      inline: applied.inline,
      media: applied.media,
    });
    json(res, 200, sent && sent.ok ? { ok: true } : { ok: false, error: 'Telegram не принял сообщение' });
    return;
  }
  json(res, 404, { error: 'not_found' });
}
