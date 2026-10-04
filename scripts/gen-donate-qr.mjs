// Writes src/ui/donateQr.ts: the QR code of the donation link (DONATE_URL of src/lib/donate.ts) as an SVG path,
// made at build time so that the TV bundle carries no QR encoder. Run after changing the link:
//   npm run gen:donate-qr
// (tests/ui/donateCard.test.tsx fails while the module does not match the configured link.)
import { readFileSync, writeFileSync } from 'node:fs';
import { donateUrlFrom, qrModule } from './donate-lib.mjs';

const url = donateUrlFrom(readFileSync('src/lib/donate.ts', 'utf8'));
writeFileSync('src/ui/donateQr.ts', qrModule(url));
console.log('src/ui/donateQr.ts: ' + (url || '(пустая ссылка)'));
