-- Kid Star Rewards. One family: at most 2 parents and 1 child.
-- Child devices are unbounded. Stars live on the family row.

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
  family_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  star_balance INTEGER NOT NULL DEFAULT 0 CHECK (star_balance >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE parents (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX parents_family ON parents(family_id);

CREATE TRIGGER parents_cap_two
BEFORE INSERT ON parents
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM parents WHERE family_id = NEW.family_id) >= 2
BEGIN
  SELECT RAISE(ABORT, 'FAMILY_PARENT_CAP');
END;

CREATE TABLE children (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL UNIQUE REFERENCES families(id),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE child_devices (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX child_devices_child ON child_devices(child_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  family_id TEXT NOT NULL REFERENCES families(id),
  parent_id TEXT REFERENCES parents(id),
  child_device_id TEXT REFERENCES child_devices(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX sessions_family ON sessions(family_id);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX magic_links_parent ON magic_links(parent_id, created_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points BETWEEN 1 AND 999),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX tasks_family ON tasks(family_id, active, sort_order);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  child_id TEXT NOT NULL REFERENCES children(id),
  local_date TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, local_date)
);

CREATE TABLE rewards (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost BETWEEN 1 AND 9999),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX rewards_family ON rewards(family_id, active, sort_order);

CREATE TABLE redemptions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  reward_id TEXT REFERENCES rewards(id),
  reward_name TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_parent_id TEXT REFERENCES parents(id)
);

CREATE INDEX redemptions_family_status ON redemptions(family_id, status, requested_at);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX activity_log_family ON activity_log(family_id, created_at);
