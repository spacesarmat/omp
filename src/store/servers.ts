import { signal, computed } from '@preact/signals';
import { loadJson, saveJson, isObject } from './storage';
import { resetLibrary } from './library';
import { resetViewed } from './progress';
import { TorrServerClient, normalizeServerUrl } from '../api/torrserver';
import { t } from '../i18n';

export interface SavedServer {
  id: string;
  name: string;
  url: string;
  user?: string;
  password?: string;
}

const KEY = 'tsp.servers';
const ACTIVE_KEY = 'tsp.activeServer';

export function sanitizeServers(v: unknown): SavedServer[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is SavedServer =>
      isObject(s) && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.url === 'string',
  );
}

export const servers = signal<SavedServer[]>(sanitizeServers(loadJson<unknown>(KEY, [], Array.isArray)));
export const activeServerId = signal<string | null>(
  loadJson<string | null>(ACTIVE_KEY, null, (v) => v === null || typeof v === 'string'),
);
export const activeServer = computed(() => servers.value.find((s) => s.id === activeServerId.value) || null);
export const client = computed(() => (activeServer.value ? new TorrServerClient(activeServer.value) : null));

function persist() {
  saveJson(KEY, servers.value);
  saveJson(ACTIVE_KEY, activeServerId.value);
}

export function addServer(input: { name?: string; url: string; user?: string; password?: string }): SavedServer {
  const url = normalizeServerUrl(input.url);
  const name = input.name || url.replace(/^https?:\/\//, '');
  const existing = servers.value.find((s) => s.url === url);
  if (existing) {
    const updated: SavedServer = { ...existing, name: input.name || existing.name,
      user: input.user !== undefined ? input.user : existing.user,
      password: input.password !== undefined ? input.password : existing.password,
    };
    servers.value = servers.value.map((s) => (s.id === existing.id ? updated : s));
    persist();
    return updated;
  }
  const server: SavedServer = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    url,
    user: input.user,
    password: input.password,
  };
  servers.value = servers.value.concat(server);
  persist();
  return server;
}

export function removeServer(id: string): void {
  servers.value = servers.value.filter((s) => s.id !== id);
  if (activeServerId.value === id) activeServerId.value = null;
  persist();
}

export type UpdateServerResult = 'ok' | 'duplicate' | 'missing';

export function updateServer(
  id: string,
  patch: { name?: string; url?: string; user?: string; password?: string },
): UpdateServerResult {
  const cur = servers.value.find((s) => s.id === id);
  if (!cur) return 'missing';
  const url = patch.url !== undefined ? normalizeServerUrl(patch.url) : cur.url;
  if (servers.value.some((s) => s.id !== id && s.url === url)) return 'duplicate';
  const name = patch.name !== undefined && patch.name.trim() ? patch.name.trim() : cur.name;
  const user = patch.user === undefined ? cur.user : patch.user.trim() || undefined;
  // passwords are kept verbatim; empty means no auth
  const password = patch.password === undefined ? cur.password : patch.password || undefined;
  if (url !== cur.url && activeServerId.value === id) {
    resetViewed();
    resetLibrary();
  }
  servers.value = servers.value.map((s) => (s.id === id ? { id, name, url, user, password } : s));
  persist();
  return 'ok';
}

export function setActiveServer(id: string | null): void {
  if (id !== activeServerId.value) {
    // data from the previous server must not leak into the new one
    resetViewed();
    resetLibrary();
  }
  activeServerId.value = id;
  persist();
}

export function requireClient(): TorrServerClient {
  const c = client.value;
  if (!c) throw new Error(t('errors.noServerSelected'));
  return c;
}
