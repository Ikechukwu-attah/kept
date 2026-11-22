import { describe, it, expect, vi } from 'vitest';

vi.mock('@forge/kvs', () => ({ kvs: {}, WhereConditions: {} }));
const { toStored, fromStored } = await import('../src/store.js');
const { NO_DUE } = await import('../src/core/lifecycle.js');

describe('storage conversion', () => {
  it('stores seconds that fit a 32-bit integer and round-trips', () => {
    const p = { id: 'x', dueAt: Date.parse('2026-11-26T22:00:00Z'), createdAt: Date.parse('2026-11-20T15:00:00Z'), updatedAt: 0, resolvedAt: 0, remindedAt: 0, releaseRef: '', devIssueKey: '' };
    const s = toStored(p);
    expect(s.dueAt).toBeLessThan(2 ** 31);
    expect(s).not.toHaveProperty('releaseRef');
    expect(s).not.toHaveProperty('devIssueKey');
    const back = fromStored(s);
    expect(back.dueAt).toBe(p.dueAt);
    expect(back.releaseRef).toBe('');
  });
  it('NO_DUE survives the round trip', () => {
    expect(fromStored(toStored({ dueAt: NO_DUE })).dueAt).toBe(NO_DUE);
  });
});
