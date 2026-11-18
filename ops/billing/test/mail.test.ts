import { describe, expect, it, vi } from 'vitest';

const { created } = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));
vi.mock('nodemailer', () => ({
  createTransport: (opts: Record<string, unknown>) => {
    created.push(opts);
    return { sendMail: async () => undefined };
  },
}));

import { sendMail } from '../src/mail.mjs';

const base = { smtpHost: 'smtp.example.org', smtpUser: 'u', smtpPass: 'p', smtpFrom: 'f@example.org' };

describe('SMTP transport security', () => {
  it('requires STARTTLS on the submission port instead of falling back to plaintext', async () => {
    created.length = 0;
    expect(await sendMail({ ...base, smtpPort: 587 }, { to: 'a@b.c', subject: 's', text: 't' })).toBe(true);
    expect(created[created.length - 1]).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it('uses implicit TLS on 465', async () => {
    created.length = 0;
    expect(await sendMail({ ...base, smtpPort: 465 }, { to: 'a@b.c', subject: 's', text: 't' })).toBe(true);
    expect(created[created.length - 1]).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it('defaults to 587 with requireTLS when no port is configured', async () => {
    created.length = 0;
    expect(await sendMail({ ...base }, { to: 'a@b.c', subject: 's', text: 't' })).toBe(true);
    expect(created[created.length - 1]).toMatchObject({ port: 587, requireTLS: true });
  });

  it('does not create a transport without a host or recipient', async () => {
    created.length = 0;
    expect(await sendMail({ ...base }, { to: '', subject: 's', text: 't' })).toBe(false);
    expect(await sendMail(null, { to: 'a@b.c', subject: 's', text: 't' })).toBe(false);
    expect(created).toHaveLength(0);
  });
});