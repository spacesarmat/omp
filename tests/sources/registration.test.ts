import { describe, it, expect } from 'vitest';
import { registrationUrl, registrationOf } from '../../src/sources/registration';

describe('registrationUrl', () => {
  it('rutracker has a fixed page', () => {
    expect(registrationUrl('rutracker')).toBe('https://rutracker.org/forum/profile.php?mode=register');
  });
  it('kinozal follows the active mirror, kinozal.tv by default', () => {
    expect(registrationUrl('kinozal')).toBe('https://kinozal.tv/signup.php');
    expect(registrationUrl('kinozal', 'kinozal.me')).toBe('https://kinozal.me/signup.php');
    expect(registrationUrl('kinozal', 'bad host/x')).toBe('https://kinozal.tv/signup.php');
  });
  it('rustorka is phpBB-style on its host', () => {
    expect(registrationUrl('rustorka')).toBe('https://rustorka.com/forum/profile.php?mode=register');
  });
  it('any other source has none', () => {
    expect(registrationUrl('rutor')).toBeNull();
    expect(registrationUrl('')).toBeNull();
  });
  it('registrationOf takes the host from siteUrl', () => {
    expect(registrationOf({ id: 'kinozal', siteUrl: 'https://kinozal.guru/' })).toBe('https://kinozal.guru/signup.php');
    expect(registrationOf({ id: 'rutracker' })).toBe('https://rutracker.org/forum/profile.php?mode=register');
    expect(registrationOf({ id: 'torrentby', siteUrl: 'https://torrent.by/' })).toBeNull();
  });
});
