import { describe, it, expect } from 'vitest';
import { extractPromises, splitSentences } from '../src/core/extract.js';
import { adfToText } from '../src/core/adf.js';
import { wallClock, zonedToUtc, businessDaysLater } from '../src/core/time.js';

// Friday 20 Nov 2026, 10:00 in Toronto (EST, UTC-5).
const TZ = 'America/Toronto';
const NOW = Date.parse('2026-11-20T15:00:00Z');
const run = (text) => extractPromises(text, { now: NOW, timeZone: TZ });
const local = (ms) => {
  const w = wallClock(ms, TZ);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
};

describe('extractPromises: catches real promises', () => {
  it('update promise with a weekday resolves to 5pm local', () => {
    const [p] = run("Thanks for the logs. I'll update you by Thursday.");
    expect(p.kind).toBe('update');
    expect(p.dueSource).toBe('explicit');
    expect(local(p.dueAt)).toBe('2026-11-26 17:00');
  });

  it('two promises in one sentence: update + fix in a release', () => {
    const ps = run("I'll update you by Thursday, and the fix ships in 2.4.");
    expect(ps).toHaveLength(2);
    expect(ps[0].kind).toBe('update');
    expect(ps[1]).toMatchObject({ kind: 'fix', releaseRef: '2.4', dueSource: 'release', dueAt: null });
  });

  it('refund tomorrow', () => {
    const [p] = run('We will process your refund tomorrow.');
    expect(p.kind).toBe('refund');
    expect(local(p.dueAt)).toBe('2026-11-21 17:00');
  });

  it('end of day', () => {
    const [p] = run("I'll get back to you by end of day.");
    expect(p.kind).toBe('update');
    expect(local(p.dueAt)).toBe('2026-11-20 17:00');
  });

  it('within 24 hours is an exact instant', () => {
    const [p] = run("You'll hear from us within 24 hours.");
    expect(p.dueAt).toBe(NOW + 24 * 3600 * 1000);
  });

  it('business days skip the weekend', () => {
    const [p] = run("We'll send the replacement within 3 business days.");
    expect(local(p.dueAt)).toBe('2026-11-25 17:00'); // Mon, Tue, Wed
  });

  it('explicit time is kept', () => {
    const [p] = run("I'll call you Monday at 2pm.");
    expect(p.kind).toBe('callback');
    expect(local(p.dueAt)).toBe('2026-11-23 14:00');
  });

  it('"it ships" refers back to a fix named earlier in the sentence', () => {
    const ps = run('Thanks Priya. Engineering has a fix for large exports, and it ships in 2.4.');
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: 'fix', releaseRef: '2.4' });
  });

  it('a bare "it ships" with no fix mentioned is not a promise', () => {
    expect(run('It ships in 2.4 boxes.')).toEqual([]);
  });

  it('drops the greeting from the quote', () => {
    const [p] = run("Hi Grace, I'll send the countersigned DPA within 2 hours.");
    expect(p.quote).toBe("I'll send the countersigned DPA within 2 hours.");
    expect(p.dueAt).toBe(NOW + 2 * 3600 * 1000);
  });

  it('an explicit time beats "today"', () => {
    const [p] = run("I'll call you today at 4pm with an update.");
    expect(p.kind).toBe('callback');
    expect(local(p.dueAt)).toBe('2026-11-20 16:00');
  });

  it('next week means end of next week', () => {
    const [p] = run("We're going to deploy the patch next week.");
    expect(p.kind).toBe('fix');
    expect(local(p.dueAt)).toBe('2026-11-27 17:00');
  });

  it('vague promise gets a labelled default, never a fake date', () => {
    const [p] = run("I'll follow up with the engineering team's findings.");
    expect(p.dueSource).toBe('default');
    expect(p.dueLabel).toMatch(/no date given/);
    expect(local(p.dueAt)).toBe('2026-11-24 17:00'); // 2 business days: Mon, Tue
  });

  it('next release', () => {
    const [p] = run('The fix will go out in the next release.');
    expect(p).toMatchObject({ kind: 'fix', releaseRef: 'next', dueSource: 'release' });
  });

  it('version keyword', () => {
    const [p] = run('We will ship this in v3.1.');
    expect(p.releaseRef).toBe('3.1');
  });

  it('curly apostrophes from rich-text editors', () => {
    const [p] = run('I’ll update you tomorrow morning.');
    expect(p.kind).toBe('update');
    expect(local(p.dueAt)).toBe('2026-11-21 12:00');
  });
});

describe('extractPromises: ignores non-promises', () => {
  const none = [
    "We'll try to get this fixed soon.",
    'This might be resolved in the next release.',
    "Hopefully we'll have news by Friday.",
    "I'll update you if anything changes.",
    "We're looking into it.",
    "We'll look into it.",
    "We won't be able to refund this charge.",
    "We'll need you to send us the logs.",
    'Could you send a screenshot?',
    'Will you be available Monday?',
    "We'll see what engineering says.",
    'The issue was fixed last week.',
    'Thanks for reaching out!',
  ];
  for (const text of none) {
    it(`no promise in: ${text}`, () => expect(run(text)).toEqual([]));
  }
});

describe('splitSentences', () => {
  it('keeps version numbers intact', () => {
    expect(splitSentences('Fixed in 2.4. Thanks!')).toEqual(['Fixed in 2.4.', 'Thanks!']);
  });
});

describe('adfToText', () => {
  it('flattens paragraphs, mentions and breaks', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { text: '@Ana' } }] },
        { type: 'paragraph', content: [{ type: 'text', text: "I'll update you" }, { type: 'hardBreak' }, { type: 'text', text: 'by Friday.' }] },
      ],
    };
    expect(adfToText(adf)).toBe("Hi @Ana\nI'll update you\nby Friday.\n");
  });
});

describe('time helpers', () => {
  it('zonedToUtc handles DST (Toronto summer = UTC-4)', () => {
    expect(new Date(zonedToUtc(2026, 7, 1, 17, 0, TZ)).toISOString()).toBe('2026-07-01T21:00:00.000Z');
  });
  it('businessDaysLater from Friday lands on Tuesday for 2 days', () => {
    expect(local(businessDaysLater(NOW, 2, TZ))).toBe('2026-11-24 17:00');
  });
});
