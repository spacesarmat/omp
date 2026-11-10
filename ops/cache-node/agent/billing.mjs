// Calls billing with the node token. The token is a header, never a URL and never a log line.

export function billingOrigin(raw) {
  const u = new URL(String(raw || '').trim());
  if (u.username || u.password) throw new Error('BILLING_URL must not contain a password');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('BILLING_URL must be http or https');
  return u.origin;
}

export async function billingJson(origin, token, method, path, body) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = {};
  }
  return { status: res.status, data };
}
