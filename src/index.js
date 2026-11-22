/**
 * Kept backend: product-event triggers, the hourly sweep, UI resolvers and
 * Rovo actions. Business rules live in src/core (pure, unit-tested); this file
 * only moves data between Jira, storage and those rules.
 */
import api from '@forge/api';
import Resolver from '@forge/resolver';
import { adfToText } from './core/adf.js';
import { extractPromises } from './core/extract.js';
import { ACTIVE, NO_DUE, applyAgentReply, applyDevChange, draftReply, stats, summariseChangelog, sweep, transition, versionMatches } from './core/lifecycle.js';
import { zonedToUtc, formatLocal } from './core/time.js';
import { addComment, getComment, getIssue, getUser, linkedDevIssueKeys, mentionAdf, textToAdf, userCanSee, visibleToUser } from './jira.js';
import { getPromise, promisesByStatusDueBefore, promisesCreatedSince, promisesForDevIssue, promisesForIssue, savePromise } from './store.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const isServiceDesk = (issue) => issue?.fields?.project?.projectTypeKey === 'service_desk';
const changed = (a, b) => a.status !== b.status || a.reason !== b.reason || a.dueAt !== b.dueAt || a.remindedAt !== b.remindedAt || a.devIssueKey !== b.devIssueKey;

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** avi:jira:commented:issue — scan public agent replies for promises. */
export async function onComment(event) {
  const issueKey = event?.issue?.key;
  const commentId = event?.comment?.id;
  if (!issueKey || !commentId) return;

  const issue = await getIssue(issueKey, ['*navigable', 'issuelinks'], api.asApp(), { names: true });
  if (!isServiceDesk(issue)) return;

  const comment = await getComment(issueKey, commentId);
  // Only "Reply to customer" comments carry promises; internal notes do not.
  if (comment.jsdPublic === false) return;
  const author = comment.author || {};
  // Customers (and the app itself) do not make promises on our behalf.
  if (author.accountType !== 'atlassian' || author.accountId === issue.fields.reporter?.accountId) return;

  const now = Date.parse(comment.created) || Date.now();
  const user = await getUser(author.accountId).catch(() => ({}));
  const timeZone = user.timeZone || 'UTC';

  // 1) This reply may keep earlier promises ("I'll update you by Thursday").
  const existing = await promisesForIssue(issueKey);
  const after = applyAgentReply(existing, { replyAt: now, commentId, authorName: author.displayName });
  for (let i = 0; i < existing.length; i++) if (changed(existing[i], after[i])) await savePromise(after[i]);

  // 2) New promises in this reply. Ids are deterministic, so a retried event is idempotent.
  const found = extractPromises(adfToText(comment.body), { now, timeZone });
  if (!found.length) return;
  const devKeys = linkedDevIssueKeys(issue);
  const customerName = customerOf(issue);

  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    let p = {
      id: `${issueKey}-${commentId}-${i}`,
      issueKey,
      issueId: String(issue.id),
      projectKey: issue.fields.project.key,
      summary: issue.fields.summary || '',
      commentId: String(commentId),
      ownerAccountId: author.accountId,
      ownerName: author.displayName || 'Agent',
      ownerTimeZone: timeZone,
      customerName,
      kind: f.kind,
      quote: f.quote,
      sentence: f.sentence,
      dueAt: f.dueAt ?? NO_DUE,
      dueSource: f.dueSource,
      dueLabel: f.dueLabel,
      releaseRef: f.releaseRef || '',
      devIssueKey: '',
      status: 'open',
      reason: 'Promise found in a public reply.',
      remindedAt: 0,
      createdAt: now,
      updatedAt: now,
      resolvedAt: 0,
      history: [{ at: now, from: null, to: 'open', reason: `${author.displayName || 'An agent'} wrote: “${f.quote}”` }],
    };
    if (f.kind === 'fix' && devKeys.length) p = await linkToDevIssue(p, devKeys[0], now);
    await savePromise(p);
  }
}

/** avi:jira:updated:issue — a dev issue that promises depend on changed. */
export async function onIssueUpdated(event) {
  const devKey = event?.issue?.key;
  if (!devKey || !event.changelog?.items?.length) return;
  const promises = await promisesForDevIssue(devKey);
  if (!promises.length) return;

  const dev = await getIssue(devKey, ['status', 'fixVersions', 'resolution']);
  const change = summariseChangelog(event.changelog, { statusCategory: dev.fields.status?.statusCategory?.key });
  change.toVersions = (dev.fields.fixVersions || []).map((v) => v.name);
  change.actorName = await displayName(event.atlassianId);
  const now = Date.now();

  for (const p of promises) {
    let next = applyDevChange(p, change, now);
    next = refreshReleaseDue(next, dev);
    if (!changed(p, next)) continue;
    await savePromise(next);
    if (next.status !== p.status && (next.status === 'at_risk' || next.status === 'ready')) {
      const verb = next.status === 'ready' ? 'Ready to close the loop' : 'Promise at risk';
      await addComment(p.issueKey, mentionAdf(p.ownerAccountId, `Kept · ${verb}: “${p.quote}” — ${next.reason}`), { internal: true }).catch(console.error);
    }
  }
}

/** avi:jira:created:issuelink — linking a request to a dev issue connects its fix promises. */
export async function onLinkCreated(event) {
  const link = event?.issueLink;
  if (!link) return;
  const [a, b] = await Promise.all([
    getIssue(String(link.sourceIssueId), ['project']),
    getIssue(String(link.destinationIssueId), ['project']),
  ]);
  const request = isServiceDesk(a) ? a : isServiceDesk(b) ? b : null;
  const dev = request === a ? b : a;
  if (!request || isServiceDesk(dev)) return;
  const now = Date.now();
  for (const p of await promisesForIssue(request.key)) {
    if (p.kind !== 'fix' || p.devIssueKey || !ACTIVE.includes(p.status)) continue;
    await savePromise(await linkToDevIssue(p, dev.key, now));
  }
}

/** Hourly: remind owners of promises due within 24h; mark overdue promises broken. */
export async function hourly() {
  const now = Date.now();
  for (const status of ACTIVE) {
    for (const p of await promisesByStatusDueBefore(status, now + DAY)) {
      const { promise, remind } = sweep(p, now);
      if (!changed(p, promise)) continue;
      await savePromise(promise);
      if (remind) {
        await addComment(p.issueKey, mentionAdf(p.ownerAccountId, `Kept · Due soon: you promised ${p.customerName || 'the customer'} “${p.quote}” — due ${formatLocal(p.dueAt, p.ownerTimeZone || 'UTC')}.`), { internal: true }).catch(console.error);
      } else if (promise.status === 'broken') {
        await addComment(p.issueKey, mentionAdf(p.ownerAccountId, `Kept · Promise broken: “${p.quote}” — ${promise.reason}`), { internal: true }).catch(console.error);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function linkToDevIssue(p, devKey, now) {
  let next = { ...p, devIssueKey: devKey, updatedAt: now, history: [...(p.history || []), { at: now, from: p.status, to: p.status, reason: `Linked to ${devKey}.` }] };
  const dev = await getIssue(devKey, ['status', 'fixVersions']).catch(() => null);
  if (!dev) return next;
  next = refreshReleaseDue(next, dev);
  if (dev.fields.status?.statusCategory?.key === 'done') {
    next = transition(next, 'ready', `${devKey} is already done. Tell the customer the fix is live.`, now);
  }
  return next;
}

/** A release-bound promise inherits the release date of the matching fix version. */
function refreshReleaseDue(p, dev) {
  if (p.dueSource !== 'release' || !p.releaseRef || p.releaseRef === 'next') return p;
  const version = (dev.fields.fixVersions || []).find((v) => versionMatches(v.name, p.releaseRef));
  if (!version?.releaseDate) return p;
  const [y, m, d] = version.releaseDate.split('-').map(Number);
  const dueAt = zonedToUtc(y, m, d, 17, 0, p.ownerTimeZone || 'UTC');
  if (dueAt === p.dueAt) return p;
  return { ...p, dueAt, dueLabel: `release ${p.releaseRef} (${formatLocal(dueAt, p.ownerTimeZone || 'UTC')})` };
}

/** Reporter name plus JSM organization names, for "What did we promise Acme?". */
function customerOf(issue) {
  const parts = [issue.fields.reporter?.displayName].filter(Boolean);
  for (const [id, name] of Object.entries(issue.names || {})) {
    if (/^organi[sz]ations?$/i.test(name) && Array.isArray(issue.fields[id])) {
      parts.push(...issue.fields[id].map((o) => o.name).filter(Boolean));
    }
  }
  return parts.join(' · ');
}

async function displayName(accountId) {
  if (!accountId) return '';
  const u = await getUser(accountId).catch(() => null);
  return u?.displayName || '';
}

const sortForPanel = (list) => {
  const rank = { broken: 0, at_risk: 1, ready: 2, open: 3, kept: 4, dismissed: 5 };
  return [...list].sort((a, b) => (rank[a.status] - rank[b.status]) || (a.dueAt - b.dueAt));
};

const publicView = (p) => ({ ...p, dueAt: p.dueAt === NO_DUE ? null : p.dueAt });

// ---------------------------------------------------------------------------
// UI resolvers
// ---------------------------------------------------------------------------

const resolver = new Resolver();

resolver.define('getPanel', async ({ context }) => {
  const issueKey = context.extension.issue.key;
  if (!(await userCanSee(issueKey))) return { error: 'You do not have access to this issue.' };
  const own = await promisesForIssue(issueKey);
  if (own.length) return { mode: 'request', issueKey, promises: sortForPanel(own).map(publicView) };
  const riding = await promisesForDevIssue(issueKey);
  if (riding.length) {
    const visible = await visibleToUser([...new Set(riding.map((p) => p.issueKey))]);
    return { mode: 'dev', issueKey, promises: sortForPanel(riding.filter((p) => visible.has(p.issueKey))).map(publicView) };
  }
  return { mode: 'empty', issueKey, promises: [] };
});

resolver.define('updatePromise', async ({ payload, context }) => {
  const p = await getPromise(payload.id);
  if (!p || !(await userCanSee(p.issueKey))) return { error: 'Not found.' };
  const who = (await displayName(context.accountId)) || 'An agent';
  const now = Date.now();
  let next = p;
  if (payload.op === 'kept') next = transition(p, 'kept', `${who} marked this promise as kept.`, now);
  if (payload.op === 'dismiss') next = transition(p, 'dismissed', `${who} marked this as not a promise.`, now);
  if (payload.op === 'reopen') next = transition(p, 'open', `${who} reopened this promise.`, now);
  if (payload.op === 'extend') {
    const days = Math.min(Math.max(Number(payload.days) || 2, 1), 30);
    const from = p.dueAt === NO_DUE ? now : Math.max(p.dueAt, now);
    const dueAt = from + days * DAY;
    next = { ...transition(p, p.status === 'broken' ? 'open' : p.status, `${who} extended the deadline by ${days} day${days > 1 ? 's' : ''}.`, now), dueAt, dueSource: 'explicit', remindedAt: 0, dueLabel: `extended (${formatLocal(dueAt, p.ownerTimeZone || 'UTC')})` };
  }
  await savePromise(next);
  return { promise: publicView(next) };
});

resolver.define('draftReply', async ({ payload }) => {
  const p = await getPromise(payload.id);
  if (!p || !(await userCanSee(p.issueKey))) return { error: 'Not found.' };
  const customerFirstName = (p.customerName || '').split(' · ')[0].split(' ')[0];
  const agentFirstName = (p.ownerName || '').split(' ')[0];
  return { text: draftReply(p, { customerFirstName, agentFirstName }) };
});

/** Sends the reply *as the signed-in agent* (asUser), so Jira permissions and authorship apply. */
resolver.define('sendReply', async ({ payload }) => {
  const p = await getPromise(payload.id);
  if (!p || !(await userCanSee(p.issueKey))) return { error: 'Not found.' };
  const text = String(payload.text || '').trim();
  if (!text) return { error: 'The reply is empty.' };
  await addComment(p.issueKey, textToAdf(text), { client: api.asUser() });
  // The comment trigger marks the promise kept once Jira records the reply.
  return { ok: true };
});

resolver.define('getDashboard', async () => {
  const now = Date.now();
  const all = await promisesCreatedSince(now - 60 * DAY);
  const visible = await visibleToUser([...new Set(all.map((p) => p.issueKey))]);
  const list = all.filter((p) => visible.has(p.issueKey));
  const byOwner = {};
  for (const p of list) {
    const o = (byOwner[p.ownerName] ||= { owner: p.ownerName, kept: 0, broken: 0, active: 0, atRisk: 0 });
    if (p.status === 'kept') o.kept++;
    if (p.status === 'broken') o.broken++;
    if (ACTIVE.includes(p.status)) o.active++;
    if (p.status === 'at_risk') o.atRisk++;
  }
  return {
    now,
    stats: stats(list, now),
    attention: sortForPanel(list.filter((p) => ACTIVE.includes(p.status) || p.status === 'broken')).slice(0, 50).map(publicView),
    owners: Object.values(byOwner).sort((a, b) => b.active - a.active),
  };
});

export const resolverHandler = resolver.getDefinitions();

// ---------------------------------------------------------------------------
// Rovo actions (Promise Keeper agent)
// ---------------------------------------------------------------------------

const STATUSES = ['open', 'at_risk', 'ready', 'kept', 'broken', 'dismissed'];

function rovoLine(p) {
  const due = p.dueAt === NO_DUE ? p.dueLabel : `${p.dueLabel}`;
  return {
    request: p.issueKey,
    summary: p.summary,
    customer: p.customerName,
    agent: p.ownerName,
    promise: p.quote,
    kind: p.kind,
    status: p.status,
    due,
    dueWasDefaulted: p.dueSource === 'default',
    linkedDevIssue: p.devIssueKey || null,
    why: p.reason,
  };
}

export async function rovoListPromises(payload) {
  const now = Date.now();
  let list = payload?.issueKey ? await promisesForIssue(String(payload.issueKey).toUpperCase()) : await promisesCreatedSince(now - 90 * DAY);
  const status = String(payload?.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (STATUSES.includes(status)) list = list.filter((p) => p.status === status);
  const customer = String(payload?.customer || '').toLowerCase().trim();
  if (customer) list = list.filter((p) => `${p.customerName} ${p.summary}`.toLowerCase().includes(customer));

  let visible;
  try {
    visible = await visibleToUser([...new Set(list.map((p) => p.issueKey))]);
  } catch {
    return { error: 'Could not verify your access to these requests.' };
  }
  const result = sortForPanel(list.filter((p) => visible.has(p.issueKey))).slice(0, 40).map(rovoLine);
  return { count: result.length, promises: result };
}

export async function rovoDraftCloseLoop(payload) {
  const issueKey = String(payload?.issueKey || '').toUpperCase();
  if (!issueKey) return { error: 'Give a request key, e.g. SUP-12.' };
  let visible;
  try {
    visible = await visibleToUser([issueKey]);
  } catch {
    return { error: 'Could not verify your access to this request.' };
  }
  if (!visible.has(issueKey)) return { error: `No access to ${issueKey} or it does not exist.` };
  const promises = sortForPanel(await promisesForIssue(issueKey)).filter((p) => ACTIVE.includes(p.status));
  if (!promises.length) return { issueKey, message: 'No open promises on this request.' };
  const p = promises[0];
  return {
    issueKey,
    customer: p.customerName,
    agent: p.ownerName,
    focus: rovoLine(p),
    otherOpenPromises: promises.slice(1).map(rovoLine),
    suggestedDraft: draftReply(p, { customerFirstName: (p.customerName || '').split(' ')[0], agentFirstName: (p.ownerName || '').split(' ')[0] }),
  };
}
