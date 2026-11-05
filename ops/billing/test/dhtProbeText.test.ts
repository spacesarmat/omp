import { describe, expect, it } from 'vitest';
import { createLoadGate } from '../admin/src/lib/dhtLoad';
import { probeText } from '../admin/src/lib/dhtProbe';

describe('DHT probe text', () => {
  it('tells a button limit from a busy sidecar, and a disabled sidecar from one that is not up', () => {
    expect(probeText({ reason: 'probe_rate', status: 429, error: 'rate' })).toBe('лимит проверки - это лимит кнопки, не сбой DHT');
    expect(probeText({ reason: 'sidecar_rate', status: 429, error: 'проверка' })).toBe('sidecar занят (429) - это лимит sidecar, не лимит кнопки');
    expect(probeText({ reason: 'disabled', status: 503, ms: 4 })).toBe('проверка: sidecar выключен (4 мс)');
    expect(probeText({ reason: 'not_ready', status: 503, ms: 9 })).toBe('проверка: DHT еще не поднялся (9 мс)');
    expect(probeText({ reason: 'down', status: 502, ms: 12 })).toBe('проверка: sidecar не ответил (12 мс)');
    expect(probeText({ ok: true, reason: 'ok', peers: 3, ms: 8 })).toBe('ок, пиров 3, 8 мс');
    expect(probeText({ auth: false })).toBe('Нужен вход');
  });

  it('keeps only the newest load', () => {
    const gate = createLoadGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.next();
    expect(gate.isCurrent(second)).toBe(false);
  });
});