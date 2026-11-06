// The time the Worker stores with a row (SPEC §14.1). Imports no JSON, so
// Node can load this module too.
//
// Timestamps are the server's, as ISO 8601 UTC with milliseconds
// (toISOString()); a client's time is never read. Free text from anyone is
// stored with its time rounded down to the hour, so it is hard to match to
// the same visit's other rows by time: a search (SPEC §10.1) and a feedback
// message (§13, §14.2). Ratings and the other events keep the exact time.

/** `now` rounded down to the hour, as "2026-11-06T13:00:00.000Z". `now` is not changed. */
export function hourTimestamp(now) {
  const ts = new Date(now.getTime());
  ts.setUTCMinutes(0, 0, 0);
  return ts.toISOString();
}
