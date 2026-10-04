// Owner tool: prints the support code of a month for the Boosty post.
//   node scripts/donate-code.mjs 2026-11 [--key <path to the Ed25519 private key, PEM>]
// Without --key the path comes from the OMP_DONATE_KEY environment variable; the key never goes into the repository.
// The app checks codes with the public key SUPPORT_PUBLIC_KEY of src/lib/donate.ts.
import { readFileSync } from 'node:fs';
import { publicKeyOf, supportCode } from './donate-lib.mjs';

const args = process.argv.slice(2);
const month = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--key');
const k = args.indexOf('--key');
const keyPath = k >= 0 && args[k + 1] ? args[k + 1] : process.env.OMP_DONATE_KEY || '';

if (!month) {
  console.error('Использование: node scripts/donate-code.mjs ГГГГ-ММ [--key путь-к-ключу.pem]');
  process.exit(2);
}
if (!keyPath) {
  console.error('Не указан ключ: передайте --key путь-к-ключу.pem или задайте переменную OMP_DONATE_KEY');
  process.exit(2);
}
try {
  const pem = readFileSync(keyPath);
  const code = supportCode(month, pem);
  const src = readFileSync(new URL('../src/lib/donate.ts', import.meta.url), 'utf8');
  if (src.indexOf("'" + publicKeyOf(pem) + "'") < 0) console.error('Внимание: ключ не совпадает с SUPPORT_PUBLIC_KEY в src/lib/donate.ts — приложение этот код не примет');
  console.log(code);
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}
