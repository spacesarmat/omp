// HTTP for cache nodes and the admin tab. Tokens are returned once and never logged.
import { randomId } from './crypto.mjs';
import { mergeSettings } from './services.mjs';
import {
  authenticateNode,
  cacheEnabled,
  cleanMagnet,
  clipText,
  freshNodeId,
  maybeRunPopularity,
  newNodeToken,
  normalizeInfohash,
  prefixMbOf,
  prefixPercentOf,
  publicAssignment,
  publicNode,
  resolvePrefix,
  safeNodeUrl,
  sourceFor,
  tokenHash,
  validPrefixMb,
  validPrefixPercent,
} from './cacheNodes.mjs';

const NODE_ID = /^[a-f0-9]{16}$/;
const ERRORS = { '': true, add_failed: true, no_metadata: true, prefix_short: true, torrserver: true };

export function isCachePath(path) {
  return path.indexOf('/v1/cache') === 0 || path.indexOf('/admin/api/cache') === 0 || path.indexOf('/admin/cache') === 0;
}

function reply(res, json, status, body) {
  res.setHeader('cache-control', 'no-store');
  json(res, status, body);
}

function gbBytes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.floor(n * 1024 * 1024 * 1024);
}

function prefixField(v, valid) {
  if (v === undefined || v === '') return 0;
  if (!valid(v)) return null;
  return Math.floor(Number(v));
}

function diskBytes(v) {
  const n = Math.floor(Number(v) || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 2 ** 52 ? 2 ** 52 : n;
}

function nodeFields(body) {
  const name = clipText(body && body.name, 80);
  const url = safeNodeUrl(body && body.url);
  const region = clipText(body && body.region, 40);
  const capacityBytes = gbBytes(body && body.capacityGb);
  const prefixMb = prefixField(body && body.prefixMb, validPrefixMb);
  const prefixPercent = prefixField(body && body.prefixPercent, validPrefixPercent);
  if (!name) return { error: 'Нужно имя узла' };
  if (!url) return { error: 'Адрес узла не подходит' };
  if (capacityBytes === null) return { error: 'Емкость: число гигабайт от 0 до 100000' };
  if (prefixMb === null || prefixPercent === null) return { error: 'Префикс: мегабайты 0-102400 или проценты 0-100' };
  return { name, url, region, capacityBytes, prefixMb, prefixPercent };
}

function assignmentView(row) {
  return {
    id: row.id,
    infohash: row.infohash,
    title: row.title || '',
    magnet: row.magnet || '',
    sizeBytes: row.sizeBytes || 0,
    prefixBytes: row.prefixBytes || 0,
    prefixPercent: row.prefixPercent || 0,
    status: row.status,
    pinned: row.pinned === true,
  };
}

async function requireAdmin(deps, req) {
  const admin = deps.adminOf(req);
  if (!admin) {
    reply(deps.res, deps.json, 401, { auth: false });
    return null;
  }
  return admin;
}

async function adminBody(deps, req, admin) {
  const body = await deps.readBody(req);
  if (!body || body.csrf !== admin.csrf) {
    reply(deps.res, deps.json, 403, { ok: false, error: 'forbidden' });
    return null;
  }
  return body;
}

async function deviceGate(deps, req) {
  const device = String(req.headers['x-device-id'] || '');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 401 };
  const state = await deps.store.read();
  const caller = await deps.deviceCaller(state, token, device, Date.now());
  if (!caller || caller.error) return { error: 401 };
  const rateKey = (device || String(caller.rowId || '')).slice(0, 64);
  return { state, rateKey };
}

export async function routeCache(req, res, deps) {
  const path = deps.path;
  const repo = deps.repo;
  const json = deps.json;
  if (!repo) {
    reply(res, json, 503, { error: 'down' });
    return;
  }
  const now = Date.now();
  const state = path.indexOf('/admin/') === 0 ? null : await deps.store.read();

  if (req.method === 'GET' && path === '/admin/api/cache') {
    const admin = await requireAdmin(deps, req);
    if (!admin) return;
    const settings = (await deps.store.read()).settings;
    const nodes = await repo.listNodes();
    const assignments = await repo.listAssignments(300);
    reply(res, json, 200, {
      enabled: cacheEnabled(settings),
      prefixMb: prefixMbOf(settings),
      prefixPercent: prefixPercentOf(settings),
      nodes: nodes.map((n) => publicNode(n, now)),
      assignments: assignments.filter((a) => a.status !== 'removed').map(publicAssignment),
      csrf: admin.csrf,
    });
    return;
  }

  if (req.method === 'POST' && path.indexOf('/admin/cache') === 0) {
    const admin = await requireAdmin(deps, req);
    if (!admin) return;
    const body = await adminBody(deps, req, admin);
    if (!body) return;
    if (path === '/admin/cache/settings') {
      const patch = {};
      if (body.enabled !== undefined) patch.cacheNodesEnabled = body.enabled;
      if (body.prefixMb !== undefined) patch.cachePrefixMb = body.prefixMb;
      if (body.prefixPercent !== undefined) patch.cachePrefixPercent = body.prefixPercent;
      if (body.prefixMb !== undefined && body.prefixMb !== '' && !validPrefixMb(body.prefixMb)) {
        reply(res, json, 200, { ok: false, error: 'Префикс: мегабайты 0-102400' });
        return;
      }
      if (body.prefixPercent !== undefined && body.prefixPercent !== '' && !validPrefixPercent(body.prefixPercent)) {
        reply(res, json, 200, { ok: false, error: 'Префикс: проценты 0-100' });
        return;
      }
      await deps.store.update((cur) => ({ state: { ...cur, settings: mergeSettings(cur.settings, patch) } }));
      const saved = (await deps.store.read()).settings;
      await deps.audit('cache_settings', cacheEnabled(saved) ? 'включено' : 'выключено');
      reply(res, json, 200, { ok: true, enabled: cacheEnabled(saved), prefixMb: prefixMbOf(saved), prefixPercent: prefixPercentOf(saved) });
      return;
    }
    if (path === '/admin/cache/recalc') {
      const settings = (await deps.store.read()).settings;
      const result = await maybeRunPopularity(repo, settings, now, true);
      await deps.audit('cache_recalc', result.skipped ? 'пропуск' : 'добавлено ' + result.created);
      reply(res, json, 200, { ok: true, ...result });
      return;
    }
    if (path === '/admin/cache/node') {
      const fields = nodeFields(body);
      if (fields.error) {
        reply(res, json, 200, { ok: false, error: fields.error });
        return;
      }
      const token = newNodeToken();
      const id = freshNodeId();
      await repo.insertNode({ ...fields, id, tokenHash: tokenHash(token), now });
      const node = await repo.getNode(id);
      await deps.audit('cache_node_create', fields.name);
      reply(res, json, 200, { ok: true, token, node: publicNode(node, now) });
      return;
    }
    if (path === '/admin/cache/node/update') {
      const id = String(body.id || '');
      if (!NODE_ID.test(id) || !(await repo.getNode(id))) {
        reply(res, json, 200, { ok: false, error: 'Узел не найден' });
        return;
      }
      const fields = nodeFields(body);
      if (fields.error) {
        reply(res, json, 200, { ok: false, error: fields.error });
        return;
      }
      await repo.updateNode({ ...fields, id, now });
      await deps.audit('cache_node_update', fields.name);
      reply(res, json, 200, { ok: true, node: publicNode(await repo.getNode(id), now) });
      return;
    }
    if (path === '/admin/cache/node/disable') {
      const id = String(body.id || '');
      const node = NODE_ID.test(id) ? await repo.getNode(id) : null;
      if (!node) {
        reply(res, json, 200, { ok: false, error: 'Узел не найден' });
        return;
      }
      const disabled = body.disabled === true || body.disabled === 'true' || body.disabled === '1';
      await repo.setNodeStatus(id, disabled ? 'disabled' : 'active', now);
      await deps.audit('cache_node_disable', node.name + (disabled ? ' выключен' : ' включен'));
      reply(res, json, 200, { ok: true, node: publicNode(await repo.getNode(id), now) });
      return;
    }
    if (path === '/admin/cache/token') {
      const id = String(body.id || '');
      const node = NODE_ID.test(id) ? await repo.getNode(id) : null;
      if (!node) {
        reply(res, json, 200, { ok: false, error: 'Узел не найден' });
        return;
      }
      const token = newNodeToken();
      await repo.setTokenHash(id, tokenHash(token), now);
      await deps.audit('cache_token', node.name + ' выдан');
      reply(res, json, 200, { ok: true, token, node: publicNode(await repo.getNode(id), now) });
      return;
    }
    if (path === '/admin/cache/token/revoke') {
      const id = String(body.id || '');
      const node = NODE_ID.test(id) ? await repo.getNode(id) : null;
      if (!node) {
        reply(res, json, 200, { ok: false, error: 'Узел не найден' });
        return;
      }
      await repo.setTokenHash(id, '', now);
      await deps.audit('cache_token', node.name + ' отозван');
      reply(res, json, 200, { ok: true, node: publicNode(await repo.getNode(id), now) });
      return;
    }
    if (path === '/admin/cache/pin') {
      const hash = normalizeInfohash(body.infohash);
      const nodeId = String(body.nodeId || '');
      const node = NODE_ID.test(nodeId) ? await repo.getNode(nodeId) : null;
      if (!hash || !node) {
        reply(res, json, 200, { ok: false, error: 'Нужны узел и infohash' });
        return;
      }
      const pasted = String(body.magnet || '').trim();
      const magnet = cleanMagnet(pasted, hash);
      if (pasted && !magnet) {
        reply(res, json, 200, { ok: false, error: 'Магнит не подходит. Секреты трекера не сохраняются' });
        return;
      }
      const settings = (await deps.store.read()).settings;
      const sizeBytes = diskBytes(body.sizeBytes);
      const prefix = resolvePrefix(settings, node, sizeBytes);
      await repo.upsertAssignment(
        {
          id: randomId(),
          nodeId,
          infohash: hash,
          title: clipText(body.title, 300),
          magnet,
          sizeBytes,
          prefixBytes: prefix.prefixBytes,
          prefixPercent: prefix.prefixPercent,
          pinned: true,
          source: 'manual',
          score: 0,
        },
        now,
      );
      await deps.audit('cache_pin', node.name + ' ' + hash.slice(0, 8));
      reply(res, json, 200, { ok: true });
      return;
    }
    if (path === '/admin/cache/unpin') {
      const id = String(body.id || '');
      if (!NODE_ID.test(id)) {
        reply(res, json, 200, { ok: false, error: 'Назначение не найдено' });
        return;
      }
      await repo.unpinAssignment(id, now);
      await deps.audit('cache_unpin', id);
      reply(res, json, 200, { ok: true });
      return;
    }
    reply(res, json, 404, { ok: false, error: 'not_found' });
    return;
  }

  if (path.indexOf('/v1/cache') !== 0) {
    reply(res, json, 404, { error: 'not_found' });
    return;
  }

  const settings = state.settings;
  const header = req.headers.authorization || '';

  if (req.method === 'GET' && path === '/v1/cache/source') {
    const gate = await deviceGate(deps, req);
    if (gate.error) {
      reply(res, json, 401, { error: 'bad_token' });
      return;
    }
    if (!deps.sourceRate.allow(gate.rateKey)) {
      res.setHeader('retry-after', String(deps.sourceRate.retryAfter(gate.rateKey) || 1));
      reply(res, json, 429, { error: 'rate' });
      return;
    }
    if (!cacheEnabled(settings)) {
      reply(res, json, 200, { enabled: false });
      return;
    }
    const hash = normalizeInfohash(deps.url.searchParams.get('infohash'));
    if (!hash) {
      reply(res, json, 400, { error: 'bad_request' });
      return;
    }
    const rows = await repo.sourcesForHash(hash);
    reply(res, json, 200, { enabled: true, source: sourceFor(rows, hash, now) });
    return;
  }

  if (req.method === 'POST' && path === '/v1/cache/interest') {
    const gate = await deviceGate(deps, req);
    if (gate.error) {
      reply(res, json, 401, { error: 'bad_token' });
      return;
    }
    if (!deps.interestRate.allow(gate.rateKey)) {
      res.setHeader('retry-after', String(deps.interestRate.retryAfter(gate.rateKey) || 1));
      reply(res, json, 429, { error: 'rate' });
      return;
    }
    if (!cacheEnabled(settings)) {
      reply(res, json, 200, { enabled: false });
      return;
    }
    const body = await deps.readBody(req);
    const hash = normalizeInfohash(body && body.infohash);
    if (!hash) {
      reply(res, json, 400, { error: 'bad_request' });
      return;
    }
    const event = body.event === 'play' ? 'play' : 'search';
    await repo.noteInterest(
      { infohash: hash, title: clipText(body.title, 300), event, seeders: diskBytes(body.seeders), sizeBytes: diskBytes(body.sizeBytes) },
      now,
    );
    reply(res, json, 200, { enabled: true });
    return;
  }

  const node = await authenticateNode(repo, header);
  if (!node) {
    reply(res, json, 401, { error: 'bad_token' });
    return;
  }
  if (!deps.nodeRate.allow(node.id)) {
    res.setHeader('retry-after', String(deps.nodeRate.retryAfter(node.id) || 1));
    reply(res, json, 429, { error: 'rate' });
    return;
  }

  if (req.method === 'GET' && path === '/v1/cache/assignments') {
    const enabled = cacheEnabled(settings) && node.status !== 'disabled';
    const rows = enabled ? await repo.assignmentsForNode(node.id) : [];
    reply(res, json, 200, {
      enabled: cacheEnabled(settings),
      disabled: node.status === 'disabled',
      assignments: rows.map(assignmentView),
    });
    return;
  }

  if (req.method === 'POST' && (path === '/v1/cache/register' || path === '/v1/cache/heartbeat')) {
    const body = await deps.readBody(req);
    await repo.touchHeartbeat(node.id, {
      now,
      diskUsedBytes: diskBytes(body && body.diskUsedBytes),
      diskTotalBytes: diskBytes(body && body.diskTotalBytes),
      torrserverOk: body && (body.torrserverOk === true || body.ok === true),
    });
    if (node.status !== 'disabled') {
      try {
        await maybeRunPopularity(repo, settings, now, false);
      } catch (e) {
        /* a failed recount must not fail the heartbeat */
      }
    }
    const fresh = await repo.getNode(node.id);
    reply(res, json, 200, {
      ok: true,
      enabled: cacheEnabled(settings),
      disabled: fresh.status === 'disabled',
      node: {
        id: fresh.id,
        name: fresh.name,
        url: fresh.url,
        region: fresh.region || '',
        capacityBytes: fresh.capacityBytes,
        prefixMb: fresh.prefixMb,
        prefixPercent: fresh.prefixPercent,
      },
    });
    return;
  }

  if (req.method === 'POST' && path === '/v1/cache/report') {
    const body = await deps.readBody(req);
    const id = String((body && body.id) || '');
    const status = String((body && body.status) || '');
    const error = ERRORS[String((body && body.error) || '')] ? String((body && body.error) || '') : '';
    if (!NODE_ID.test(id) || (status !== 'assigned' && status !== 'caching' && status !== 'cached' && status !== 'failed')) {
      reply(res, json, 400, { error: 'bad_request' });
      return;
    }
    const saved = await repo.reportAssignment(node.id, id, status, error, now);
    if (!saved) {
      reply(res, json, 404, { error: 'not_found' });
      return;
    }
    reply(res, json, 200, { ok: true });
    return;
  }

  reply(res, json, 404, { error: 'not_found' });
}
