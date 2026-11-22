/**
 * Promise storage on Forge KVS custom entities (declared in manifest.yml).
 *
 * Indexes:
 *   by-issue       partition issueKey     range createdAt  -> promises on one request
 *   by-dev-issue   partition devIssueKey  range createdAt  -> promises riding on a dev issue
 *   by-status-due  partition status       range dueAt      -> hourly sweep
 *   by-created     range createdAt                         -> dashboard window
 */
import { kvs, WhereConditions } from '@forge/kvs';

const ENTITY = 'promise';
const entity = () => kvs.entity(ENTITY);

export async function savePromise(p) {
  await entity().set(p.id, p);
  return p;
}

export async function getPromise(id) {
  return entity().get(id);
}

/** Run an index query to completion, following cursors. */
async function all(build) {
  const out = [];
  let cursor;
  do {
    let q = build();
    if (cursor) q = q.cursor(cursor);
    const page = await q.limit(100).getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor && out.length < 2000);
  return out;
}

export const promisesForIssue = (issueKey) =>
  all(() => entity().query().index('by-issue', { partition: [issueKey] }).sort('ASC'));

export const promisesForDevIssue = (devIssueKey) =>
  all(() => entity().query().index('by-dev-issue', { partition: [devIssueKey] }).sort('ASC'));

export const promisesByStatusDueBefore = (status, before) =>
  all(() =>
    entity().query().index('by-status-due', { partition: [status] }).where(WhereConditions.lessThanEqualTo(before)),
  );

export const promisesCreatedSince = (since) =>
  all(() => entity().query().index('by-created').where(WhereConditions.greaterThan(since)).sort('DESC'));
