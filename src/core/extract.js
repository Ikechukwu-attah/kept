/**
 * Promise extraction — the heart of Kept.
 *
 * Given the plain text of an agent's public reply, return every *promise* the
 * agent made to the customer: what was promised, what kind of promise it is,
 * and when it is due (resolved in the agent's time zone).
 *
 * Design choices (see docs/SPEC.md):
 *  - Deterministic rules + chrono-node, no LLM: free, explainable, testable.
 *  - Conservative: hedged or conditional statements ("we'll try", "might",
 *    "if it happens again") are NOT promises. A false promise is worse than a
 *    missed one, because Kept would nag agents about things they never said.
 *  - Never invent a date: when the agent gave none, the promise gets a default
 *    due date and is clearly labelled as defaulted.
 */
import * as chrono from 'chrono-node';
import { addDays, businessDaysLater, tzOffsetMinutes, wallClock, zonedToUtc } from './time.js';

const DEFAULT_BUSINESS_DAYS = 2;
const END_OF_DAY_HOUR = 17; // "by Thursday" means by 5pm Thursday local time
const MORNING_HOUR = 12; // "tomorrow morning" means before noon

// --- Pattern library --------------------------------------------------------

/** First-person (or "you will get") future commitments. */
const COMMIT = new RegExp(
  [
    String.raw`\b(?:i|we)\s*(?:'|’)ll\b`,
    String.raw`\b(?:i|we)\s+(?:will|shall)\b`,
    String.raw`\b(?:i|we)\s*(?:'|’)?(?:m|re|\s+am|\s+are)\s+going\s+to\b`,
    String.raw`\byou\s*(?:(?:'|’)ll|\s+will|\s+should)\s+(?:get|receive|hear|have|see)\b`,
    String.raw`\bi\s+promise\b`,
    String.raw`\b(?:i|we)\s+(?:commit|guarantee)\b`,
  ].join('|'),
  'i',
);

/** Statements about the fix/release itself ("the fix ships in 2.4"). */
const FIX_FUTURE =
  /\b(?:fix|patch|hotfix|update|change|feature|release|correction)\b[^.?!]*?\b(?:will\s+(?:ship|go\s+(?:out|live)|land|be\s+(?:out|live|available|released|deployed|fixed))|ships|goes\s+(?:out|live)|lands|is\s+(?:scheduled|planned|due|targeted)\s+for|should\s+be\s+(?:out|live|available))\b/i;

/** Hedges, conditionals and negations — these are not promises. */
const HEDGE =
  /\b(?:try|trying|attempt|hope|hopefully|might|may|maybe|possibly|perhaps|probably|not\s+sure|can(?:'|’)?t\s+promise|cannot\s+promise|no\s+promises|won(?:'|’)t|will\s+not|unless|if\s+(?:we|i|you|it|this|that|there|anything|the|any|needed|necessary|possible))\b|\bwe(?:'|’)ll\s+see\b/i;

/** Asking the customer to do something is not a promise to them. */
const REQUEST_TO_CUSTOMER = /\b(?:i|we)\s*(?:(?:'|’)ll|\s+will)\s+(?:need|have\s+to\s+ask|require)\b/i;

/** Verbs that deliver something to the customer. */
const DELIVERABLE =
  /\b(?:update|get\s+back|follow(?:\s|-)?up|let\s+you\s+know|keep\s+you\s+(?:posted|updated|informed)|send|refund|credit|reimburse|call|ring|phone|fix|patch|deploy|ship|release|escalate|reply|respond|confirm|share|email|reach\s+out|check\s+in|resolve|process|replace|restore|enable|activate|unlock|reset|schedule|book|deliver|provide|hear|receive|report)\b/i;

const KIND_RULES = [
  ['refund', /\b(?:refund|credit|reimburs|chargeback|money\s+back|compensat)/i],
  ['fix', /\b(?:fix|patch|hotfix|bug|deploy|ship|release|version|v\d|resolved?\s+(?:the|this)\s+(?:bug|issue|problem))/i],
  ['callback', /\b(?:call|ring|phone)\b/i],
  ['update', /\b(?:update|get\s+back|follow(?:\s|-)?up|let\s+you\s+know|keep\s+you|hear\s+from|reply|respond|check\s+in|status|reach\s+out|confirm)/i],
];

// Release references: "v2.4", "version 2.4.1", "release 3.0", "in 2.4" next to fix words.
const RELEASE_EXPLICIT = /\b(?:v|version\s*|release\s+)(\d+(?:\.\d+){1,2})\b/i;
const RELEASE_BARE = /\b(?:in|with|by)\s+(\d+\.\d+(?:\.\d+)?)\b/i;
const RELEASE_NEXT = /\b(?:the\s+)?(?:next|upcoming|following)\s+(?:release|version|update|deploy(?:ment)?|patch)\b/i;

const END_OF_DAY = /\b(?:end\s+of\s+(?:the\s+)?(?:business\s+)?day|eod|cob|close\s+of\s+business|later\s+today|by\s+tonight|today)\b/i;
const END_OF_WEEK = /\b(?:end\s+of\s+(?:the\s+)?week|eow|this\s+week)\b/i;
const NEXT_WEEK_ONLY = /\bnext\s+week\b/i;
const BUSINESS_DAYS = /\b(?:within|in)\s+(\d+|one|two|three|four|five)\s+business\s+days?\b/i;
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };

// --- Public API ---------------------------------------------------------------

/**
 * Extract promises from a reply.
 *
 * @param {string} text      Plain text of the reply (see adfToText).
 * @param {object} opts
 * @param {number} opts.now       When the reply was posted (ms since epoch).
 * @param {string} opts.timeZone  Agent's IANA time zone (default UTC).
 * @returns {Array<{quote:string, sentence:string, kind:string, dueAt:number|null,
 *   dueSource:'explicit'|'release'|'default', dueLabel:string, releaseRef:string|null}>}
 */
export function extractPromises(text, { now = Date.now(), timeZone = 'UTC' } = {}) {
  const results = [];
  for (const sentence of splitSentences(text)) {
    if (/\?\s*$/.test(sentence)) continue; // questions are not promises
    const clauses = splitClauses(sentence);
    let sentenceHasCommitment = false;

    for (const clause of clauses) {
      if (HEDGE.test(clause) || REQUEST_TO_CUSTOMER.test(clause)) continue;

      const commits = COMMIT.test(clause);
      const fixFuture = FIX_FUTURE.test(clause);
      if (commits) sentenceHasCommitment = true;
      if (!commits && !fixFuture) continue;

      const release = findRelease(clause);
      const due = resolveDue(stripRelease(clause), { now, timeZone });

      // "We'll look into it" with no deliverable and no time is reassurance,
      // not a promise. Require something the customer will actually receive,
      // a time, or a release.
      if (!DELIVERABLE.test(clause) && !due && !release) continue;
      // A bare "the fix ships" statement only counts if it is pinned to a time
      // or release, or sits in a sentence where the agent committed.
      if (!commits && !due && !release && !sentenceHasCommitment) continue;

      const kind = classify(clause, release);
      results.push(buildPromise({ clause, sentence, kind, due, release, now, timeZone }));
    }
  }
  return dedupe(results);
}

// --- Internals ----------------------------------------------------------------

/** Split text into sentences, keeping version numbers like "2.4" intact. */
export function splitSentences(text) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z"“(])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

/** Split a sentence into independent clauses ("…, and the fix ships in 2.4"). */
export function splitClauses(sentence) {
  return sentence
    .split(/\s*;\s*|,?\s+(?:and|but|also|plus)\s+(?=(?:i|we|you|the|it|this|that|a|your|our)\b)/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

function classify(clause, release) {
  if (release) return 'fix';
  for (const [kind, re] of KIND_RULES) if (re.test(clause)) return kind;
  return 'action';
}

function findRelease(clause) {
  const explicit = clause.match(RELEASE_EXPLICIT);
  if (explicit) return explicit[1];
  if (/\b(?:fix|patch|ship|release|deploy|land|version|out|live)\b/i.test(clause)) {
    const bare = clause.match(RELEASE_BARE);
    if (bare) return bare[1];
  }
  if (RELEASE_NEXT.test(clause)) return 'next';
  return null;
}

/** Remove version numbers so chrono does not read "2.4" as February 4th. */
function stripRelease(clause) {
  return clause.replace(RELEASE_EXPLICIT, ' ').replace(RELEASE_BARE, ' ').replace(/\b\d+\.\d+(?:\.\d+)?\b/g, ' ');
}

/**
 * Resolve the due instant of a clause, or null if it names no time.
 * Returns { at, phrase } where phrase is the words that set the date.
 */
export function resolveDue(clause, { now, timeZone }) {
  const local = wallClock(now, timeZone);
  const ref = { instant: new Date(now), timezone: tzOffsetMinutes(now, timeZone) };
  const parsed = chrono.parse(clause, ref, { forwardDate: true })[0];

  // An explicit clock time wins over day words: "today at 4pm" is 4pm, not end of day.
  if (parsed && parsed.start.isCertain('hour') && !/\bwithin\b/i.test(parsed.text)) {
    return { at: parsed.start.date().getTime(), phrase: parsed.text };
  }

  const bd = clause.match(BUSINESS_DAYS);
  if (bd) {
    const n = WORD_NUM[bd[1].toLowerCase()] || Number(bd[1]);
    return { at: businessDaysLater(now, n, timeZone, END_OF_DAY_HOUR), phrase: bd[0] };
  }

  if (END_OF_DAY.test(clause)) {
    let at = zonedToUtc(local.year, local.month, local.day, END_OF_DAY_HOUR, 0, timeZone);
    if (at <= now) at = now + 2 * 3600 * 1000; // already past 5pm: give it two hours
    return { at, phrase: clause.match(END_OF_DAY)[0] };
  }

  if (END_OF_WEEK.test(clause)) {
    const toFriday = (5 - local.weekday + 7) % 7;
    const d = addDays(local.year, local.month, local.day, toFriday);
    let at = zonedToUtc(d.year, d.month, d.day, END_OF_DAY_HOUR, 0, timeZone);
    if (at <= now) at = now + 2 * 3600 * 1000;
    return { at, phrase: clause.match(END_OF_WEEK)[0] };
  }

  // "next week" with no weekday means "by the end of next week" (Friday 5pm).
  if (NEXT_WEEK_ONLY.test(clause) && (!parsed || !parsed.start.isCertain('weekday'))) {
    const toNextFriday = ((5 - local.weekday + 7) % 7) + 7;
    const d = addDays(local.year, local.month, local.day, toNextFriday);
    return { at: zonedToUtc(d.year, d.month, d.day, END_OF_DAY_HOUR, 0, timeZone), phrase: 'next week' };
  }

  if (!parsed) return null;
  const start = parsed.start;

  // Relative durations ("within 24 hours", "in 2 days") are exact instants.
  if (/\b(?:within|in)\s+\d+\s+(?:minutes?|hours?|days?)\b/i.test(parsed.text) || /\bwithin\b/i.test(parsed.text)) {
    return { at: start.date().getTime(), phrase: parsed.text };
  }

  if (start.isCertain('hour')) return { at: start.date().getTime(), phrase: parsed.text };

  // Date without a time: end of that local business day (or noon for "morning").
  const hour = /\bmorning\b/i.test(parsed.text) ? MORNING_HOUR : END_OF_DAY_HOUR;
  const at = zonedToUtc(start.get('year'), start.get('month'), start.get('day'), hour, 0, timeZone);
  return { at, phrase: parsed.text };
}

function buildPromise({ clause, sentence, kind, due, release, now, timeZone }) {
  if (due) {
    return {
      quote: clause,
      sentence,
      kind,
      dueAt: due.at,
      dueSource: 'explicit',
      dueLabel: `${due.phrase.trim()} (${formatLocal(due.at, timeZone)})`,
      releaseRef: release,
    };
  }
  if (release) {
    return {
      quote: clause,
      sentence,
      kind,
      dueAt: null,
      dueSource: 'release',
      dueLabel: release === 'next' ? 'next release' : `release ${release}`,
      releaseRef: release,
    };
  }
  const at = businessDaysLater(now, DEFAULT_BUSINESS_DAYS, timeZone, END_OF_DAY_HOUR);
  return {
    quote: clause,
    sentence,
    kind,
    dueAt: at,
    dueSource: 'default',
    dueLabel: `no date given, defaulted to ${DEFAULT_BUSINESS_DAYS} business days (${formatLocal(at, timeZone)})`,
    releaseRef: null,
  };
}

/** One promise per kind per sentence: "I'll call you and update you Friday" is one update. */
function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => {
    const key = `${p.sentence}|${p.kind}|${p.dueAt}|${p.releaseRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatLocal(ms, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}
