-- Migration number: 0002 	 2026-11-07T07:00:00.000Z
-- Feedback stores the page id only, not its title (project lead's decision,
-- 2026-11-07, SPEC §17, §22). The admin page shows each message's page by its
-- current title from pages.json. Never edit this file once it has been
-- applied to a remote database: change the schema with a new migration.
--
-- SQLite (3.35+, which D1 runs) can drop page_title: it is a plain nullable
-- column with no index, constraint, trigger or view naming it. The other
-- columns and every row are kept; the titles already stored are dropped.
ALTER TABLE feedback DROP COLUMN page_title;
