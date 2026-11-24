/**
 * Promise lifecycle rules: pure functions, no Forge APIs, fully unit-tested.
 *
 * Statuses
 *   open      - promise made, not yet due
 *   at_risk   - the dev work it depends on slipped (sprint removal, release change, reopen)
 *   ready     - the linked fix is done; the customer has not been told yet
 *   kept      - delivered before the deadline
 *   broken    - deadline passed without delivery
 *   dismissed - an agent marked it as "not a promise"
 *
 * Every transition records a human-readable reason (see SPEC "Honesty rules").
 */

export const NO_DUE = Number.MAX_SAFE_INTEGER; // release-bound promises without a known date
export const ACTIVE = ['open', 'at_risk', 'ready'];
const DAY = 24 * 3600 * 1000;

/** Return a copy of `p` moved to `status`, with the reason appended to its history. */
export function transition(p, status, reason, now) {
  if (p.status === status && p.reason === reason) return p;
  const history = [...(p.history || []), { at: now, from: p.status, to: status, reason }];
  const done = ['kept', 'broken', 'dismissed'].includes(status);
  return { ...p, status, reason, updatedAt: now, resolvedAt: done ? now : p.resolvedAt || 0, history };
}

/**
 * A new public reply on the request was posted by an agent.
 * Open *update*-style promises made before this reply and not yet overdue are
 * now kept: the agent did get back to the customer.
 */
export function applyAgentReply(promises, { replyAt, commentId, authorName }, now = replyAt) {
  return promises.map((p) => {
    if (!ACTIVE.includes(p.status)) return p;
    if (p.commentId === commentId) return p; // the reply that made the promise cannot keep it
    if (p.createdAt >= replyAt) return p;
    if (p.kind === 'update' || p.kind === 'callback') {
      if (p.dueAt !== NO_DUE && replyAt > p.dueAt) return p; // late replies do not un-break
      return transition(p, 'kept', `${authorName || 'An agent'} replied to the customer before the deadline.`, now);
    }
    if (p.status === 'ready' && p.kind === 'fix') {
      return transition(p, 'kept', `${authorName || 'An agent'} told the customer the fix is live.`, now);
    }
    return p;
  });
}

/**
 * The dev issue a promise depends on changed. `change` summarises the Jira
 * changelog: { removedFromSprint, sprintName, fixVersionChanged, fromVersion,
 * toVersion, resolved, reopened, statusName, actorName }.
 */
export function applyDevChange(p, change, now) {
  if (!ACTIVE.includes(p.status) || p.kind !== 'fix') return p;
  const who = change.actorName ? ` by ${change.actorName}` : '';
  const dev = p.devIssueKey;
  if (change.resolved) {
    return transition(p, 'ready', `${dev} was resolved${who} (${change.statusName || 'Done'}). Tell the customer the fix is live.`, now);
  }
  if (change.reopened) {
    return transition(p, 'at_risk', `${dev} was reopened${who}. The promised fix is not ready.`, now);
  }
  if (change.removedFromSprint) {
    return transition(p, 'at_risk', `${dev} was removed from ${change.sprintName || 'its sprint'}${who}.`, now);
  }
  if (change.fixVersionChanged && p.releaseRef && p.releaseRef !== 'next') {
    const still = (change.toVersions || []).some((v) => versionMatches(v, p.releaseRef));
    if (!still) {
      const to = change.toVersions?.length ? change.toVersions.join(', ') : 'no release';
      return transition(p, 'at_risk', `${dev} moved from release ${p.releaseRef} to ${to}${who}.`, now);
    }
  }
  return p;
}

/** "2.4" matches versions named "2.4", "v2.4", "Release 2.4", "2.4.0". */
export function versionMatches(versionName, ref) {
  const norm = (s) => String(s).toLowerCase().replace(/^(?:release|version|v)\s*/i, '').replace(/(\.0)+$/, '');
  return norm(versionName) === norm(ref);
}

/** Summarise a Jira `avi:jira:updated:issue` changelog into the shape above. */
export function summariseChangelog(changelog, { statusCategory } = {}) {
  const items = changelog?.items || [];
  const out = { removedFromSprint: false, fixVersionChanged: false, resolved: false, reopened: false, toVersions: [] };
  for (const it of items) {
    const field = String(it.field || '').toLowerCase();
    if (field === 'sprint') {
      // Jira sends sprint names in fromString/toString for UI edits, but only
      // sprint ids in from/to for Agile API moves (e.g. "move to backlog").
      const byName = it.fromString != null && it.fromString !== '';
      const from = splitList(byName ? it.fromString : it.from);
      const to = splitList(byName ? it.toString : it.to);
      const removed = from.filter((s) => !to.includes(s));
      if (removed.length) {
        out.removedFromSprint = true;
        if (byName) out.sprintName = removed[removed.length - 1];
        else out.removedSprintId = removed[removed.length - 1];
      }
    }
    if (field === 'fix version' || field === 'fixversions') {
      out.fixVersionChanged = true;
      if (it.fromString) out.fromVersion = it.fromString;
    }
    if (field === 'resolution') {
      if (it.toString && !it.fromString) out.resolved = true;
      if (!it.toString && it.fromString) out.reopened = true;
    }
    if (field === 'status') {
      out.statusName = it.toString;
      if (statusCategory === 'done') out.resolved = true;
      if (statusCategory && statusCategory !== 'done' && /done|closed|resolved/i.test(it.fromString || '')) out.reopened = true;
    }
  }
  return out;
}

function splitList(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Hourly sweep for one promise. Returns { promise, remind } where `remind`
 * is true when the owner should get a due-soon reminder now.
 */
export function sweep(p, now) {
  if (!ACTIVE.includes(p.status) || p.dueAt === NO_DUE) return { promise: p, remind: false };
  if (now > p.dueAt) {
    if (p.status === 'ready') {
      return { promise: transition(p, 'broken', 'The fix shipped, but the customer was not told before the deadline.', now), remind: false };
    }
    return { promise: transition(p, 'broken', `Deadline passed (${p.dueLabel}) with no reply to the customer.`, now), remind: false };
  }
  const remind = p.dueAt - now <= DAY && !p.remindedAt;
  return { promise: remind ? { ...p, remindedAt: now } : p, remind };
}

/** Facts for a close-the-loop or status reply (used by the panel and Rovo). */
export function draftReply(p, { customerFirstName, agentFirstName } = {}) {
  const hi = customerFirstName ? `Hi ${customerFirstName},` : 'Hi,';
  const sign = agentFirstName ? `\n\n${agentFirstName}` : '';
  if (p.status === 'ready' && p.kind === 'fix') {
    return `${hi}\n\nGood news: the fix I promised is now live. You should no longer see the problem you reported. Could you give it a try and let me know it works on your side?${sign}`;
  }
  if (p.status === 'at_risk') {
    return `${hi}\n\nA quick, honest update: the fix I mentioned has been delayed on our side, so it may not arrive when I said. I am following it closely and will update you as soon as I have a new date.${sign}`;
  }
  return `${hi}\n\nAs promised, here is an update on your request: [what changed].${sign}`;
}

const STATUS_LABEL = { open: 'Open', at_risk: 'At risk', ready: 'Ready to close the loop', kept: 'Kept', broken: 'Broken' };

/**
 * Chart data for the dashboard.
 *  weekly: kept vs broken per week, by the week the promise was *decided* (resolvedAt), last `weeks` weeks
 *  mix:    active promises right now, by status
 *  kinds:  all promises in the window, by kind
 */
export function trends(promises, now, weeks = 6) {
  const WEEK = 7 * DAY;
  const start = now - weeks * WEEK;
  const label = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const weekly = [];
  for (let w = 0; w < weeks; w++) {
    const from = start + w * WEEK;
    const to = from + WEEK;
    const inWeek = promises.filter((p) => p.resolvedAt >= from && p.resolvedAt < to);
    const name = `Wk of ${label(from)}`;
    weekly.push({ week: name, status: 'Kept', count: inWeek.filter((p) => p.status === 'kept').length });
    weekly.push({ week: name, status: 'Broken', count: inWeek.filter((p) => p.status === 'broken').length });
  }
  const mix = ['open', 'at_risk', 'ready']
    .map((s) => ({ status: STATUS_LABEL[s], count: promises.filter((p) => p.status === s).length }))
    .filter((r) => r.count > 0);
  const kindNames = { update: 'Update', fix: 'Fix', refund: 'Refund', callback: 'Callback', action: 'Action' };
  const kinds = Object.entries(kindNames)
    .map(([k, name]) => ({ kind: name, count: promises.filter((p) => p.kind === k).length }))
    .filter((r) => r.count > 0);
  return { weekly, mix, kinds };
}

/** Dashboard numbers from a list of promises. */
export function stats(promises, now) {
  const startOfWindow = now - 30 * DAY;
  const recent = promises.filter((p) => p.createdAt >= startOfWindow);
  const decided = recent.filter((p) => p.status === 'kept' || p.status === 'broken');
  const kept = decided.filter((p) => p.status === 'kept').length;
  const endOfDay = now + DAY;
  return {
    dueSoon: promises.filter((p) => ACTIVE.includes(p.status) && p.dueAt !== NO_DUE && p.dueAt <= endOfDay).length,
    atRisk: promises.filter((p) => p.status === 'at_risk').length,
    ready: promises.filter((p) => p.status === 'ready').length,
    broken: recent.filter((p) => p.status === 'broken').length,
    keptRate: decided.length ? Math.round((kept / decided.length) * 100) : null,
    decided: decided.length,
  };
}
