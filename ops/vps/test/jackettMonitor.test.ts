import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = 'ops/vps/jackett-monitor';
const files = [
  'monitor.py',
  'jackett-monitor.service',
  'jackett-monitor.timer',
  'install.sh',
  'telegram.env.example',
  'README.md',
];

/** Telegram bot tokens are `<numeric id>:<secret>`. Passwords and API keys are quoted assignments. */
const TOKEN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/;
const SECRET_ASSIGNMENT = /(?:password|token|api[_-]?key|secret)\s*[:=]\s*['"][^'"]+['"]/i;

describe('jackett indexer monitor', () => {
  it('includes the deployed files, with LF text and executable scripts', () => {
    for (const name of files) {
      const file = path.join(dir, name);
      accessSync(file, constants.R_OK);
      const body = readFileSync(file);
      expect(body.includes(13), name).toBe(false);
      expect(body.length, name).toBeGreaterThan(0);
    }
    for (const name of ['install.sh', 'monitor.py']) {
      expect(statSync(path.join(dir, name)).mode & 0o111, name).not.toBe(0);
    }
  });

  it('reads the Jackett password and Telegram token from files', () => {
    const src = readFileSync(path.join(dir, 'monitor.py'), 'utf8');
    expect(src).toContain('ADMIN_PASSWORD_FILE = "/root/jackett-admin-password.txt"');
    expect(src).toContain('TELEGRAM_FILE = "/etc/jackett-monitor/telegram.env"');
    expect(src).toMatch(/with open\(ADMIN_PASSWORD_FILE\) as f:\n\s+pw = f\.read\(\)\.strip\(\)/);
    expect(src).toContain('read_env(TELEGRAM_FILE)');
    expect(src).toContain('env.get("TG_BOT_TOKEN")');
    expect(src).toContain('env.get("TG_CHAT_ID")');
    expect(src).not.toMatch(TOKEN);
    expect(src).not.toMatch(SECRET_ASSIGNMENT);
    expect(src).not.toMatch(/TG_BOT_TOKEN\s*=\s*['"][^'"]+['"]/);
    expect(src).not.toMatch(/TG_CHAT_ID\s*=\s*['"]?\d+/);

    const example = readFileSync(path.join(dir, 'telegram.env.example'), 'utf8');
    expect(example).toMatch(/^TG_BOT_TOKEN=\s*$/m);
    expect(example).not.toMatch(TOKEN);
    for (const name of files) {
      if (name === 'monitor.py' || name === 'telegram.env.example') continue;
      const text = readFileSync(path.join(dir, name), 'utf8');
      expect(text, name).not.toMatch(TOKEN);
      expect(text, name).not.toMatch(SECRET_ASSIGNMENT);
    }
  });
});
