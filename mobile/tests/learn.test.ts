import { describe, expect, it } from 'vitest';
import { captureLearner, type LearnerHttp } from '../src/tv/power/learn';

describe('IR learner client', () => {
  it('saves the token before waiting for a button and pairs again after 401', async () => {
    const saved: string[] = [];
    let captures = 0;
    const http: LearnerHttp = async (req) => {
      if (req.url.endsWith('/api/pair')) {
        const token = saved.length === 0 ? 'a'.repeat(32) : 'b'.repeat(32);
        return { status: 200, text: JSON.stringify({ token }) };
      }
      captures += 1;
      if (captures === 1) return { status: 401, text: '' };
      return { status: 200, text: JSON.stringify({ frequency: 38000, pulses: [100, 200] }) };
    };
    const got = await captureLearner('http://10.0.0.8', null, http, async (token) => {
      saved.push(token);
    });
    expect(saved).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
    expect(got.token).toBe('b'.repeat(32));
    expect(got.signal.pulses).toEqual([100, 200]);
  });
});
