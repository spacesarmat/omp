// Upload a RuStore-channel APK and submit it for moderation via the RuStore public API.
// Auth: RSA key from RuStore Console (RUSTORE_KEY_ID + RUSTORE_PRIVATE_KEY base64 PKCS#8);
// sign keyId+timestamp with SHA512withRSA, POST /public/auth/ -> JWE (Public-Token header).
// Flow: create draft version -> upload APK (isMainApk) -> commit (moderation). publishType
// INSTANTLY publishes automatically once moderation passes; MANUAL leaves it for a human.
// Usage: node scripts/rustore-publish.mjs --apk <file> --pkg <packageName> --notes <file> [--publishType INSTANTLY|MANUAL]
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'https://public-api-m.rustore.ru';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const apk = arg('apk', '');
const pkg = arg('pkg', process.env.RUSTORE_APP_ID || 'com.spacesarmat.omp');
const notesFile = arg('notes', '');
const publishType = arg('publishType', 'INSTANTLY');
const keyId = String(process.env.RUSTORE_KEY_ID || '').trim();
const privB64 = String(process.env.RUSTORE_PRIVATE_KEY || '').trim();

if (!apk || !keyId || !privB64) {
  console.error('rustore: need --apk and RUSTORE_KEY_ID / RUSTORE_PRIVATE_KEY');
  process.exit(1);
}

async function api(path, { method = 'POST', headers = {}, body } = {}) {
  const res = await fetch(BASE + path, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code === 'error') {
    throw new Error(`rustore ${method} ${path} -> ${res.status} ${json.code || ''} ${json.message || ''}`);
  }
  return json;
}

async function token() {
  // MSK (+03:00) ISO-8601 with milliseconds; must be within 60s of server time.
  const ts = new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace('Z', '+03:00');
  const key = crypto.createPrivateKey({ key: Buffer.from(privB64, 'base64'), format: 'der', type: 'pkcs8' });
  const signature = crypto.sign('sha512', Buffer.from(keyId + ts), key).toString('base64');
  const json = await api('/public/auth/', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId, timestamp: ts, signature }),
  });
  return json.body.jwe;
}

const jwe = await token();
const auth = { 'Public-Token': jwe };

const whatsNew = notesFile ? readFileSync(notesFile, 'utf8').slice(0, 5000) : '';
const draft = await api(`/public/v1/application/${encodeURIComponent(pkg)}/version`, {
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ whatsNew, publishType }),
});
const versionId = draft.body;
console.log('rustore: draft version', versionId);

const fd = new FormData();
fd.append('file', new Blob([readFileSync(apk)]), 'omp.apk');
const up = await api(`/public/v1/application/${encodeURIComponent(pkg)}/version/${versionId}/apk?isMainApk=true&servicesType=Unknown`, {
  headers: auth,
  body: fd,
});
console.log('rustore: uploaded apk', JSON.stringify(up.body && up.body.permissions ? up.body.permissions : {}));

await api(`/public/v1/application/${encodeURIComponent(pkg)}/version/${versionId}/commit?priorityUpdate=0`, { headers: auth });
console.log('rustore: submitted for moderation, publishType', publishType);