-- Daily check-ins may happen more than once on the same local date.
-- Existing tasks become kind 'daily' with daily_limit 1. This file does not
-- update families.star_balance and does not rewrite check-in points.
-- A Star Burst is awarded once; starburst_awards.task_id is unique.

ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily', 'starburst'));

ALTER TABLE tasks ADD COLUMN daily_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_limit BETWEEN 1 AND 9);

CREATE TABLE checkins_v2 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  local_date TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO checkins_v2 (id, family_id, task_id, child_id, local_date, points, created_at)
SELECT id, family_id, task_id, child_id, local_date, points, created_at FROM checkins;

DROP TABLE checkins;

ALTER TABLE checkins_v2 RENAME TO checkins;

CREATE INDEX checkins_task_date ON checkins(task_id, local_date);

CREATE TABLE starburst_awards (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  parent_id TEXT NOT NULL REFERENCES parents(id),
  points INTEGER NOT NULL CHECK (points BETWEEN 1 AND 999),
  created_at TEXT NOT NULL
);

CREATE INDEX starburst_awards_family ON starburst_awards(family_id, created_at);
