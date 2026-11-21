/**
 * Time-zone helpers for Kept.
 *
 * Forge functions run in UTC, but a promise like "by Thursday" means Thursday
 * in the *agent's* time zone. These helpers convert between a wall-clock time
 * in an IANA zone (e.g. "America/Toronto") and an absolute UTC instant using
 * only the built-in Intl API (no extra dependencies).
 */

/**
 * Offset of `timeZone` from UTC at the given instant, in minutes.
 * Positive east of Greenwich (e.g. Europe/Berlin in winter = +60),
 * negative west (America/Toronto in winter = -300).
 */
export function tzOffsetMinutes(instantMs, timeZone) {
  const parts = wallClock(instantMs, timeZone);
  // Re-interpret the wall-clock parts as if they were UTC; the difference to
  // the real instant is the zone offset.
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

/** Wall-clock calendar parts of an instant in a time zone. */
export function wallClock(instantMs, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: weekdays[out.weekday],
  };
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant (ms).
 * Uses a two-pass offset lookup so it is correct across DST changes.
 */
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const off1 = tzOffsetMinutes(guess, timeZone);
  const first = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(first, timeZone);
  return guess - off2 * 60000;
}

/** Add `n` calendar days to a wall-clock date (handles month/year rollover). */
export function addDays(year, month, day, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The instant `n` business days (Mon–Fri) after `instantMs`, at `hour`:00
 * local time in `timeZone`. Used for vague promises ("we'll be in touch").
 */
export function businessDaysLater(instantMs, n, timeZone, hour = 17) {
  let { year, month, day, weekday } = wallClock(instantMs, timeZone);
  let added = 0;
  while (added < n) {
    ({ year, month, day } = addDays(year, month, day, 1));
    weekday = (weekday + 1) % 7;
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return zonedToUtc(year, month, day, hour, 0, timeZone);
}
