/**
 * Which Crypto Pay token and host are active.
 * A wrong branch here would send the live token to testnet, or let a testnet webhook extend a live subscription.
 */
import { describe, expect, it } from 'vitest';
import { createCryptoInvoice, cryptoPayCredentials, cryptoPaySign, cryptoPaySignatureMode } from '../src/cryptoPay.mjs';
import { ENV_SECRETS, secretViews } from '../src/envSecrets.mjs';
import { mergeSettings, publicAdminSettings } from '../src/services.mjs';
import { emptyState } from '../src/state.mjs';

const LIVE = 'crypto-live-token-LLLL';
const TESTNET = 'crypto-test-token-TTTT';
const RAW = '{"update_id":7,"update_type":"invoice_paid"}';

function signed(token: string) {
  return cryptoPaySign(RAW, token);
}

describe('cryptoPayCredentials', () => {
  it('uses the live token and pay.crypt.bot when testnet is off', () => {
    expect(cryptoPayCredentials({ cryptoTestnet: false, cryptoPayToken: LIVE, cryptoPayTestnetToken: TESTNET })).toEqual({
      testnet: false,
      host: 'https://pay.crypt.bot',
      token: LIVE,
      ready: true,
    });
  });

  it('uses the testnet token and testnet-pay.crypt.bot when testnet is on', () => {
    expect(cryptoPayCredentials({ cryptoTestnet: true, cryptoPayToken: LIVE, cryptoPayTestnetToken: TESTNET })).toEqual({
      testnet: true,
      host: 'https://testnet-pay.crypt.bot',
      token: TESTNET,
      ready: true,
    });
  });

  it('is not ready on testnet when the testnet token is missing, and does not return the live token', () => {
    const creds = cryptoPayCredentials({ cryptoTestnet: true, cryptoPayToken: LIVE, cryptoPayTestnetToken: '' });
    expect(creds).toEqual({
      testnet: true,
      host: 'https://testnet-pay.crypt.bot',
      token: '',
      ready: false,
    });
    expect(JSON.stringify(creds)).not.toContain(LIVE);
  });

  it('is not ready on the live host when only the testnet token is set', () => {
    expect(cryptoPayCredentials({ cryptoTestnet: false, cryptoPayToken: '', cryptoPayTestnetToken: TESTNET })).toEqual({
      testnet: false,
      host: 'https://pay.crypt.bot',
      token: '',
      ready: false,
    });
  });

  it('posts only the active token to the active host and does not log either token', async () => {
    const creds = cryptoPayCredentials({ cryptoTestnet: true, cryptoPayToken: LIVE, cryptoPayTestnetToken: TESTNET });
    const seen: { url: string; token: string; body: string }[] = [];
    const logs: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const invoice = await createCryptoInvoice(
        async (url: string, init: { headers: Record<string, string>; body: string }) => {
          seen.push({ url: String(url), token: init.headers['Crypto-Pay-API-Token'], body: String(init.body) });
          return { ok: false, status: 401, json: async () => ({ ok: false }) };
        },
        { testnet: creds.testnet, token: creds.token, asset: 'USDT', amount: '2.00', payload: 'buy:1' },
      );
      expect(invoice).toBeNull();
    } finally {
      process.stderr.write = write;
    }
    expect(seen).toEqual([
      {
        url: 'https://testnet-pay.crypt.bot/api/createInvoice',
        token: TESTNET,
        body: expect.any(String),
      },
    ]);
    expect(seen[0].body).not.toContain(LIVE);
    expect(seen[0].body).not.toContain(TESTNET);
    expect(logs.join('')).not.toContain(LIVE);
    expect(logs.join('')).not.toContain(TESTNET);
  });
});

describe('crypto pay webhook mode', () => {
  it('accepts only the live signature when testnet is off', () => {
    const settings = { cryptoTestnet: false, cryptoPayToken: LIVE, cryptoPayTestnetToken: TESTNET };
    expect(cryptoPaySignatureMode(RAW, signed(LIVE), settings)).toBe('active');
    expect(cryptoPaySignatureMode(RAW, signed(TESTNET), settings)).toBe('inactive');
    expect(cryptoPaySignatureMode(RAW, signed('other-token-XXXX'), settings)).toBe('none');
    expect(cryptoPaySignatureMode(RAW + ' ', signed(LIVE), settings)).toBe('none');
  });

  it('accepts only the testnet signature when testnet is on', () => {
    const settings = { cryptoTestnet: true, cryptoPayToken: LIVE, cryptoPayTestnetToken: TESTNET };
    expect(cryptoPaySignatureMode(RAW, signed(TESTNET), settings)).toBe('active');
    expect(cryptoPaySignatureMode(RAW, signed(LIVE), settings)).toBe('inactive');
    expect(cryptoPaySignatureMode(RAW, '', settings)).toBe('none');
  });

  it('does not treat the live signature as active when testnet is on and the testnet token is missing', () => {
    const settings = { cryptoTestnet: true, cryptoPayToken: LIVE, cryptoPayTestnetToken: '' };
    expect(cryptoPaySignatureMode(RAW, signed(LIVE), settings)).toBe('inactive');
    expect(cryptoPaySignatureMode(RAW, signed(TESTNET), settings)).toBe('none');
  });
});

describe('crypto pay tokens in the admin payload', () => {
  it('masks both tokens and ignores a token posted from the form', () => {
    const cur = {
      ...emptyState().settings,
      cryptoPayToken: LIVE,
      cryptoPayTestnetToken: TESTNET,
      cryptoTestnet: false,
    };
    const next = mergeSettings(cur, { cryptoPayToken: 'posted-live', cryptoPayTestnetToken: 'posted-test', cryptoTestnet: 'true' });
    expect(next.cryptoPayToken).toBe(LIVE);
    expect(next.cryptoPayTestnetToken).toBe(TESTNET);
    expect(next.cryptoTestnet).toBe(true);
    const pub = publicAdminSettings(next);
    expect(pub.cryptoPayToken).toBe('задан ✅, ****LLLL');
    expect(pub.cryptoPayTestnetToken).toBe('задан ✅, ****TTTT');
    const body = JSON.stringify(pub);
    expect(body).not.toContain(LIVE);
    expect(body).not.toContain(TESTNET);
    expect(body).not.toContain('posted-live');
    expect(body).not.toContain('posted-test');
  });

  it('lists CRYPTO_PAY_TESTNET_TOKEN as its own masked secret', () => {
    expect(ENV_SECRETS.find((s) => s.env === 'CRYPTO_PAY_TESTNET_TOKEN')).toEqual({
      key: 'cryptoPayTestnetToken',
      env: 'CRYPTO_PAY_TESTNET_TOKEN',
      label: 'Токен Crypto Pay (testnet)',
    });
    const views = secretViews({ cryptoPayTestnetToken: 'db-crypto-pay-testnet' }, { CRYPTO_PAY_TESTNET_TOKEN: TESTNET });
    const view = views.find((v: { key: string }) => v.key === 'cryptoPayTestnetToken');
    expect(view).toMatchObject({
      env: 'CRYPTO_PAY_TESTNET_TOKEN',
      label: 'Токен Crypto Pay (testnet)',
      source: 'env',
      text: 'задан ✅, ****TTTT',
    });
    expect(JSON.stringify(views)).not.toContain(TESTNET);
    expect(JSON.stringify(views)).not.toContain('db-crypto-pay-testnet');
  });
});
