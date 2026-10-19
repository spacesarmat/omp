export type Flash = { code?: string; promo?: string; text?: string; error?: string };

export async function api<T = Record<string, unknown>>(path: string, opts?: RequestInit): Promise<T & { auth?: boolean }> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opts?.headers || {}) },
    ...opts,
  });
  const type = res.headers.get('content-type') || '';
  const data = (type.includes('json') ? await res.json() : { ok: res.ok, status: res.status }) as T & { auth?: boolean };
  if (res.status === 401) return { ...data, auth: false };
  return data;
}

export type PostResult = {
  ok?: boolean;
  redirect?: string;
  flash?: Flash;
  auth?: boolean;
  extra?: { codes?: { code: string; accountId?: string; paidUntil?: number }[]; promos?: { code: string; days: number; maxUses: number; bonusSlots?: number; bonusDays?: number }[] };
  services?: unknown;
};

export async function post(path: string, csrf: string, fields: Record<string, unknown>) {
  return api<PostResult>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ csrf, ...fields }),
  });
}
