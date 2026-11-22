import { describe, it, expect } from 'vitest';
import { applyAgentReply, applyDevChange, summariseChangelog, sweep, versionMatches, stats, NO_DUE } from '../src/core/lifecycle.js';

const T0 = Date.parse('2026-11-20T15:00:00Z');
const H = 3600 * 1000;
const base = (o) => ({ id: 'p1', status: 'open', kind: 'update', commentId: 'c1', createdAt: T0, dueAt: T0 + 48 * H, dueLabel: 'by Sunday', history: [], ...o });

describe('applyAgentReply', () => {
  it('keeps an update promise when the agent replies before the deadline', () => {
    const [p] = applyAgentReply([base()], { replyAt: T0 + H, commentId: 'c2', authorName: 'Maya' });
    expect(p.status).toBe('kept');
    expect(p.reason).toMatch(/Maya replied/);
    expect(p.history).toHaveLength(1);
  });
  it('the reply that made the promise does not keep it', () => {
    const [p] = applyAgentReply([base()], { replyAt: T0, commentId: 'c1' });
    expect(p.status).toBe('open');
  });
  it('a late reply does not rescue a promise past its deadline', () => {
    const [p] = applyAgentReply([base()], { replyAt: T0 + 72 * H, commentId: 'c2' });
    expect(p.status).toBe('open');
  });
  it('a reply does not keep an unshipped fix promise', () => {
    const [p] = applyAgentReply([base({ kind: 'fix', dueAt: NO_DUE })], { replyAt: T0 + H, commentId: 'c2' });
    expect(p.status).toBe('open');
  });
  it('a reply after the fix is ready closes the loop', () => {
    const [p] = applyAgentReply([base({ kind: 'fix', status: 'ready', dueAt: NO_DUE })], { replyAt: T0 + H, commentId: 'c2' });
    expect(p.status).toBe('kept');
  });
});

describe('dev issue changes', () => {
  const fix = base({ kind: 'fix', devIssueKey: 'DEV-12', releaseRef: '2.4', dueAt: NO_DUE });
  it('sprint removal puts the promise at risk with a reason', () => {
    const change = summariseChangelog({ items: [{ field: 'Sprint', fromString: 'Sprint 13, Sprint 14', toString: 'Sprint 13' }] });
    const p = applyDevChange(fix, { ...change, actorName: 'Sam' }, T0);
    expect(p.status).toBe('at_risk');
    expect(p.reason).toBe('DEV-12 was removed from Sprint 14 by Sam.');
  });
  it('moving to a later sprint is not a removal from all sprints but still a slip', () => {
    const change = summariseChangelog({ items: [{ field: 'Sprint', fromString: 'Sprint 14', toString: 'Sprint 15' }] });
    expect(change.removedFromSprint).toBe(true);
    expect(change.sprintName).toBe('Sprint 14');
  });
  it('Agile API move to backlog (ids only) is a sprint removal', () => {
    const change = summariseChangelog({ items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '2', to: '', toString: '' }] });
    expect(change.removedFromSprint).toBe(true);
    expect(change.removedSprintId).toBe('2');
    const p = applyDevChange(fix, { ...change, sprintName: 'Sprint 14' }, T0);
    expect(p.reason).toBe('DEV-12 was removed from Sprint 14.');
  });
  it('being added to a sprint is not a removal', () => {
    expect(summariseChangelog({ items: [{ field: 'Sprint', from: '', fromString: '', to: '2' }] }).removedFromSprint).toBe(false);
  });
  it('fix version moved away from the promised release', () => {
    const change = summariseChangelog({ items: [{ field: 'Fix Version', fromString: '2.4', toString: '2.5' }] });
    const p = applyDevChange(fix, { ...change, toVersions: ['2.5'] }, T0);
    expect(p.status).toBe('at_risk');
    expect(p.reason).toMatch(/moved from release 2.4 to 2.5/);
  });
  it('fix version change that keeps the promised release is fine', () => {
    const p = applyDevChange(fix, { fixVersionChanged: true, toVersions: ['v2.4.0'] }, T0);
    expect(p.status).toBe('open');
  });
  it('resolution set means ready to close the loop', () => {
    const change = summariseChangelog({ items: [{ field: 'resolution', fromString: null, toString: 'Done' }, { field: 'status', fromString: 'In Progress', toString: 'Done' }] }, { statusCategory: 'done' });
    const p = applyDevChange(fix, change, T0);
    expect(p.status).toBe('ready');
  });
  it('reopened fix puts a ready promise back at risk', () => {
    const change = summariseChangelog({ items: [{ field: 'resolution', fromString: 'Done', toString: null }] });
    const p = applyDevChange({ ...fix, status: 'ready' }, change, T0);
    expect(p.status).toBe('at_risk');
  });
  it('non-fix promises ignore dev changes', () => {
    expect(applyDevChange(base(), { resolved: true }, T0).status).toBe('open');
  });
});

describe('sweep', () => {
  it('reminds once within 24h of the deadline', () => {
    const p = base({ dueAt: T0 + 10 * H });
    const r1 = sweep(p, T0);
    expect(r1.remind).toBe(true);
    expect(sweep(r1.promise, T0 + H).remind).toBe(false);
  });
  it('breaks an overdue promise', () => {
    const { promise } = sweep(base({ dueAt: T0 - H }), T0);
    expect(promise.status).toBe('broken');
    expect(promise.reason).toMatch(/Deadline passed/);
  });
  it('ignores release-bound promises with no date', () => {
    expect(sweep(base({ dueAt: NO_DUE }), T0).promise.status).toBe('open');
  });
});

describe('helpers', () => {
  it('version matching', () => {
    expect(versionMatches('Release 2.4', '2.4')).toBe(true);
    expect(versionMatches('2.4.0', '2.4')).toBe(true);
    expect(versionMatches('2.5', '2.4')).toBe(false);
  });
  it('kept rate counts only decided promises', () => {
    const s = stats([base({ status: 'kept' }), base({ status: 'kept' }), base({ status: 'broken' }), base({ status: 'open' })], T0);
    expect(s.keptRate).toBe(67);
    expect(s.broken).toBe(1);
  });
});
