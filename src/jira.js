/**
 * Thin wrappers over the Jira Cloud REST API used by Kept.
 * `asApp()` is used from triggers (no user present); resolvers that act on a
 * user's behalf pass `asUser()` so Jira enforces that user's permissions.
 */
import api, { route } from '@forge/api';

async function json(res, what) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${what} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function getIssue(issueKey, fields, client = api.asApp(), { names = false } = {}) {
  const f = fields.join(',');
  const res = names
    ? await client.requestJira(route`/rest/api/3/issue/${issueKey}?fields=${f}&expand=names`)
    : await client.requestJira(route`/rest/api/3/issue/${issueKey}?fields=${f}`);
  return json(res, `GET issue ${issueKey}`);
}

/** Returns true when the *current user* can see the issue (for resolver authorization). */
export async function userCanSee(issueKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`);
  return res.ok;
}

/** Comment with its JSM visibility: `jsdPublic` is true for "Reply to customer". */
export async function getComment(issueKey, commentId) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`);
  return json(res, `GET comment ${commentId}`);
}

export async function getUser(accountId) {
  const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
  return json(res, `GET user ${accountId}`);
}

/** Post a comment. `internal: true` makes it a JSM internal note (not sent to the customer). */
export async function addComment(issueKey, adfBody, { internal = false, client = api.asApp() } = {}) {
  const body = { body: adfBody };
  if (internal) body.properties = [{ key: 'sd.public.comment', value: { internal: true } }];
  const res = await client.requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return json(res, `POST comment on ${issueKey}`);
}

/** Issue keys (from `keys`) the current user may browse. */
export async function visibleToUser(keys) {
  if (!keys.length) return new Set();
  const visible = new Set();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql: `key in (${chunk.join(',')})`, fields: ['summary'], maxResults: 100 }),
    });
    if (res.ok) {
      const data = await res.json();
      for (const issue of data.issues || []) visible.add(issue.key);
    }
  }
  return visible;
}

/** Plain text to ADF paragraphs. */
export function textToAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: String(text)
      .split(/\n{2,}/)
      .map((para) => ({
        type: 'paragraph',
        content: para.split('\n').flatMap((line, i) => (i ? [{ type: 'hardBreak' }, { type: 'text', text: line }] : line ? [{ type: 'text', text: line }] : [])),
      })),
  };
}

/** ADF paragraph that @mentions a user followed by text. */
export function mentionAdf(accountId, text) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: accountId } }, { type: 'text', text: ` ${text}` }] }],
  };
}

/** Linked issues of `issue` that live in another project (the dev side). */
export function linkedDevIssueKeys(issue) {
  const project = issue.fields?.project?.key;
  const keys = [];
  for (const link of issue.fields?.issuelinks || []) {
    const other = link.outwardIssue || link.inwardIssue;
    if (other?.key && !other.key.startsWith(`${project}-`)) keys.push(other.key);
  }
  return keys;
}
