import { describe, expect, it } from 'vitest';
import { clearCommunityVoices, communityBoost, communityLabel, communityVoiceFor, rememberCommunityVoice } from '../../src/viewer/communityRank';
import { orderSearch, rankScore } from '../../src/sources/seedRank';
import type { SourceResult } from '../../src/sources/types';

function row(title: string, seed: number, extra: Partial<SourceResult> = {}): SourceResult {
  return { Title: title, Seed: seed, Peer: 0, Magnet: '', Link: '', Hash: '', Categories: '', Size: '', CreateDate: '', Tracker: '', source: 't', ...extra };
}

describe('community rank on the client', () => {
  it('adds nothing until billing marks a learned row', () => {
    expect(communityBoost(row('A', 10))).toBe(0);
    expect(communityBoost({ communityReason: 'seeds' })).toBe(0);
    expect(communityBoost({ communityReason: 'seeds', communityRank: 90 })).toBeGreaterThan(0);
    const marked = row('A', 1, { communityReason: 'community', communityRank: 80 });
    expect(communityBoost(marked)).toBeGreaterThan(rankScore(row('B', 5000, { seedCheck: 'live', Seed: 5000 }), 'q', 0));
    expect(communityLabel(marked)).toContain('зрител');
    expect(communityLabel({ communityReason: 'blend', suggestedVoice: 'LostFilm' })).toContain('LostFilm');
  });

  it('never lets a rank bigger than billing ever sends buy more place', () => {
    // scoreOf sends score 0..100 times 100, plus a band of 100000 for an admin pin: 110000 is the honest ceiling
    const pinned = { communityReason: 'pinned', communityRank: 105000 };
    const honest = { communityReason: 'community', communityRank: 110000 };
    const forged = { communityReason: 'community', communityRank: 999999 };
    expect(communityBoost(forged)).toBe(communityBoost(honest));
    expect(communityBoost({ communityReason: 'community', communityRank: 110001 })).toBe(communityBoost(honest));
    expect(communityBoost({ communityReason: 'pinned', communityRank: -5000 })).toBe(communityBoost({ communityReason: 'pinned', communityRank: 0 }));
    // the pin band keeps its advantage over an ordinary rating, which is why the ceiling is not 10000
    expect(communityBoost(pinned)).toBeGreaterThan(communityBoost({ communityReason: 'community', communityRank: 10000 }));
    expect(communityBoost({ communityReason: 'community', communityRank: 5000 })).toBeLessThan(communityBoost(honest));
  });

  it('puts the community row first and remembers the voice', () => {
    clearCommunityVoices();
    const weak = row('Weak', 100, { communityReason: 'community', communityRank: 9000, hash: 'ab' });
    const strong = row('Strong', 5, { Seed: 5 });
    const ordered = orderSearch([strong, weak], 'seeds', 'show', 1);
    expect(ordered[0].Title).toBe('Weak');
    rememberCommunityVoice('ab', 'Show', 'LostFilm');
    expect(communityVoiceFor('ab', '')).toBe('LostFilm');
    expect(communityVoiceFor('', 'Show')).toBe('LostFilm');
    clearCommunityVoices();
    expect(communityVoiceFor('ab', 'Show')).toBe('');
  });
});
