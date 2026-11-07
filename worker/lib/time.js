// The time the Worker stores with a row (SPEC §14.1). Imports no JSON, so
// Node can load this module too.
//
// Every row the API writes (an event of any type, a rating, a feedback
// message) gets the server's time rounded down to the start of its UTC hour,
// written as ISO 8601 UTC by toISOString(): "2026-11-06T13:00:00.000Z". No
// exact time is stored anywhere, and a client's time is never read (project
// lead's decision, 2026-11-07, extending the rounding that searches and
// feedback already had). Rounded down, never to the nearest hour, so a row
// never moves into the next hour or the next day.

/** `now` rounded down to the hour, as "2026-11-06T13:00:00.000Z". `now` is not changed. */
export function hourTimestamp(now) {
  const ts = new Date(now.getTime());
  ts.setUTCMinutes(0, 0, 0);
  return ts.toISOString();
}
