import { describe, it, expect } from 'vitest';
import {
  registerMessage,
  requestMessage,
  buttonFrame,
  moveFrame,
  clickFrame,
  launchOmpPayload,
  OMP_TV_APP_ID,
} from '../src/tv/ssap';

describe('ssap messages', () => {
  it('builds a register message with a PROMPT pairing and a manifest', () => {
    const m = registerMessage('r1') as any;
    expect(m.type).toBe('register');
    expect(m.id).toBe('r1');
    expect(m.payload.pairingType).toBe('PROMPT');
    expect(m.payload['client-key']).toBeUndefined();
    const manifest = m.payload.manifest;
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.signed.appId).toBe('com.lge.test');
    expect(manifest.signatures[0].signature).toMatch(/^eyJ/);
    for (const p of [
      'LAUNCH',
      'CONTROL_AUDIO',
      'CONTROL_POWER',
      'CONTROL_INPUT_TEXT',
      'CONTROL_MOUSE_AND_KEYBOARD',
      'READ_INSTALLED_APPS',
      'READ_POWER_STATE',
      'CONTROL_INPUT_MEDIA_PLAYBACK',
      'READ_RUNNING_APPS',
      'WRITE_NOTIFICATION_TOAST',
    ]) {
      expect(manifest.permissions).toContain(p);
    }
    expect(manifest.permissions).toHaveLength(10);
  });

  it('adds the client key when known', () => {
    const m = registerMessage('r2', 'KEY') as any;
    expect(m.payload['client-key']).toBe('KEY');
  });

  it('builds an unsigned register message for TVs that reject the signed manifest', () => {
    const m = registerMessage('r3', 'KEY', false) as any;
    expect(m.payload.manifest.signed).toBeUndefined();
    expect(m.payload.manifest.appVersion).toBe('1.0');
    expect(m.payload.manifest.signatures[0].signature).toMatch(/^eyJ/);
    expect(m.payload.manifest.permissions).toContain('CONTROL_INPUT_TEXT');
    expect(m.payload['client-key']).toBe('KEY');
  });

  it('does not share manifest objects between messages', () => {
    const a = registerMessage('a') as any;
    a.payload.manifest.permissions.push('X');
    const b = registerMessage('b') as any;
    expect(b.payload.manifest.permissions).not.toContain('X');
  });

  it('builds a request message', () => {
    expect(requestMessage('m1', 'ssap://audio/volumeUp')).toEqual({
      type: 'request',
      id: 'm1',
      uri: 'ssap://audio/volumeUp',
      payload: {},
    });
    expect(requestMessage('m2', 'ssap://x', { a: 1 })).toEqual({ type: 'request', id: 'm2', uri: 'ssap://x', payload: { a: 1 } });
  });

  it('builds pointer frames', () => {
    expect(buttonFrame('UP')).toBe('type:button\nname:UP\n\n');
    expect(buttonFrame('CHANNELDOWN')).toBe('type:button\nname:CHANNELDOWN\n\n');
    expect(moveFrame(3.6, -2)).toBe('type:move\ndx:4\ndy:-2\ndown:0\n\n');
    expect(clickFrame()).toBe('type:click\n\n');
  });

  it('builds the OMP launch payload', () => {
    expect(OMP_TV_APP_ID).toBe('com.spacesarmat.torrplayer');
    expect(launchOmpPayload({ torrent: 'h' })).toEqual({ id: 'com.spacesarmat.torrplayer', params: { torrent: 'h' } });
  });
});
