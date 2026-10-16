import { readState, writeState } from '../src/store.mjs';

const file = process.env.BILLING_DATA || '/data/billing.db';
const origin = String(process.argv[2] || '')
  .trim()
  .replace(/\/+$/, '');
if (!origin) {
  console.error('usage: node set-public-origin.mjs https://….trycloudflare.com');
  process.exit(1);
}
const state = readState(file);
state.settings = { ...state.settings, publicOrigin: origin };
writeState(file, state);
console.log(JSON.stringify({ publicOrigin: origin }, null, 2));
