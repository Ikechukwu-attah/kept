/**
 * Promise storage on Forge KVS custom entities (declared in manifest.yml).
 *
 * Indexes:
 *   by-issue       partition issueKey     range createdAt  -> promises on one request
 *   by-dev-issue   partition devIssueKey  range createdAt  -> promises riding on a dev issue
 *   by-status-due  partition status       range dueAt      -> hourly sweep
 *   by-created     range createdAt                         -> dashboard window
 *
 * KVS "integer" attributes are 32-bit, so millisecond timestamps do not fit.
 * The app works in milliseconds everywhere; this module stores whole SECONDS
 * and converts at the boundary. "No due date" (NO_DUE) is stored as the
 * largest 32-bit integer so it sorts after every real date.
 */
import { kvs, WhereConditions } from '@forge/kvs';
import { NO_DUE } from './core/lifecycle.js';

const ENTITY = 'promise';
const entity = () => kvs.entity(ENTITY);
const TIME_FIELDS = ['dueAt', 'remindedAt', 'createdAt', 'updatedAt', 'resolvedAt'];
const STORED_NO_DUE = 2147483647;

export const toSeconds = (ms) => (ms === NO_DUE ? STORED_NO_DUE : Math.floor((Number(ms) || 0) / 1000));
export const toMillis = (s) => (s === STORED_NO_DUE ? NO_DUE : (Number(s) || 0) * 1000);

// KVS rejects empty strings for declared attributes, so optional text fields
// are omitted when empty and restored as '' on read.
const OPTIONAL_TEXT = ['releaseRef', 'devIssueKey', 'customerName', 'summary', 'reason', 'sentence', 'ownerTimeZone', 'dueLabel'];

export function toStored(p) {
  const out = { ...p };
  for (const f of TIME_FIELDS) out[f] = toSeconds(p[f]);
  for (const [k, v] of Object.entries(out)) if (v === '' || v === null || v === undefined) delete out[k];
  return out;
}

export function fromStored(s) {
  if (!s) return s;
  const out = { ...s };
  for (const f of TIME_FIELDS) out[f] = toMillis(s[f]);
  for (const f of OPTIONAL_TEXT) if (out[f] === undefined) out[f] = '';
  return out;
}

export async function savePromise(p) {
  await entity().set(p.id, toStored(p));
  return p;
}

export async function getPromise(id) {
  return fromStored(await entity().get(id));
}

/** Run an index query to completion, following cursors. */
async function all(build) {
  const out = [];
  let cursor;
  do {
    let q = build();
    if (cursor) q = q.cursor(cursor);
    const page = await q.limit(100).getMany();
    out.push(...page.results.map((r) => fromStored(r.value)));
    cursor = page.nextCursor;
  } while (cursor && out.length < 2000);
  return out;
}

export const promisesForIssue = (issueKey) =>
  all(() => entity().query().index('by-issue', { partition: [issueKey] }).sort('ASC'));

export const promisesForDevIssue = (devIssueKey) =>
  all(() => entity().query().index('by-dev-issue', { partition: [devIssueKey] }).sort('ASC'));

export const promisesByStatusDueBefore = (status, beforeMs) =>
  all(() =>
    entity().query().index('by-status-due', { partition: [status] }).where(WhereConditions.lessThanEqualTo(toSeconds(beforeMs))),
  );

export const promisesCreatedSince = (sinceMs) =>
  all(() => entity().query().index('by-created').where(WhereConditions.greaterThan(toSeconds(sinceMs))).sort('DESC'));
