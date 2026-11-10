import { describe, expect, it, vi } from 'vitest';
import { isTrustedPreviewEvent, parsePreviewMessage, sendPreviewCommand } from '../../editor/src/preview/protocol';

const base = { messageId: 'message-1', sessionId: 'session-1' };

describe('preview protocol', () => {
  it('copies only a valid message envelope and known fields', () => {
    expect(parsePreviewMessage({ ...base, type: 'element-selected', elementId: 'sidebar' })).toEqual({
      ...base,
      type: 'element-selected',
      elementId: 'sidebar',
    });
    expect(() => parsePreviewMessage({ type: 'element-selected', elementId: 'x', extra: 'bad' })).toThrow();
    expect(() => parsePreviewMessage({ ...base, type: 'element-selected', elementId: 'x', extra: 'bad' })).toThrow();
    expect(() => parsePreviewMessage({ ...base, type: 'unknown' })).toThrow();
  });

  it('rejects spoofed origins, sources and sessions', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const event = { origin: 'https://attacker.invalid', source: iframe.contentWindow, data: { ...base, type: 'ready' } } as MessageEvent;
    expect(isTrustedPreviewEvent(event, 'http://127.0.0.1:4173', iframe.contentWindow, 'session-1')).toBe(false);
    expect(isTrustedPreviewEvent({ ...event, origin: 'http://127.0.0.1:4173' }, 'http://127.0.0.1:4173', null, 'session-1')).toBe(false);
    expect(isTrustedPreviewEvent({ ...event, origin: 'http://127.0.0.1:4173' }, 'http://127.0.0.1:4173', iframe.contentWindow, 'other')).toBe(false);
    expect(isTrustedPreviewEvent({ ...event, origin: 'http://127.0.0.1:4173' }, 'http://127.0.0.1:4173', iframe.contentWindow, 'session-1')).toBe(true);
  });

  it('sends commands only to an explicit loopback origin without tokens', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    const command = { ...base, type: 'navigate' as const, route: 'settings' as const };
    sendPreviewCommand(iframe, command, 'http://127.0.0.1:4173');
    expect(post).toHaveBeenCalledWith(command, 'http://127.0.0.1:4173');
    expect(JSON.stringify(command)).not.toContain('token');
    expect(() => sendPreviewCommand(iframe, command, 'https://attacker.invalid')).toThrow();
  });
});
