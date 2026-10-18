import { describe, expect, it } from 'vitest';
import { fileListPhase } from '../../src/lib/audiobookFiles';

describe('fileListPhase', () => {
  it('waits while metadata is missing and says empty only after the list arrived', () => {
    expect(fileListPhase(null)).toBe('waiting');
    expect(fileListPhase({ stat: 1 })).toBe('waiting');
    expect(fileListPhase({ stat: 5, file_stats: [] })).toBe('waiting');
    expect(fileListPhase({ stat: 3, file_stats: [] })).toBe('empty');
    expect(fileListPhase({ stat: 4, file_stats: [] })).toBe('empty');
    expect(fileListPhase({ stat: 3, file_stats: [{ id: 1 }] })).toBe('ready');
  });
});
