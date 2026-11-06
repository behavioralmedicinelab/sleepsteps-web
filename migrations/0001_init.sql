-- Migration number: 0001 	 2026-11-06T06:40:01.000Z
-- Initial schema, exactly as SPEC §17. Never edit this file once it has been
-- applied to a remote database: change the schema with a new migration.
--
-- A search is a row in `events` with session_id NULL and ts rounded down to
-- the hour (SPEC §10.1). Ids are sequential, so a search's id sits between
-- the ids of the visit it came from: exports and the admin page must never
-- show the events id column (SPEC §14.4, M6).
CREATE TABLE ratings (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  page TEXT NOT NULL,
  video TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5)
);
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  page TEXT NOT NULL,
  page_title TEXT,
  message TEXT NOT NULL
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  session_id TEXT,
  page TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_ratings_ts ON ratings(ts);
CREATE INDEX idx_feedback_ts ON feedback(ts);
CREATE INDEX idx_events_type_ts ON events(type, ts);
