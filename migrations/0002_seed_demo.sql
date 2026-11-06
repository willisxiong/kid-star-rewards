-- Closed beta demo family. Idempotent. There is no public signup.
-- Family code: STAR-4821
-- Parents: willis.parent1@example.com, willis.parent2@example.com
-- Child: 小星
-- Starting balance matches the kid prototype home (12 stars, nothing pending).

INSERT OR IGNORE INTO families (id, name, timezone, family_code, star_balance, created_at)
VALUES (
  'fam_demo',
  '示范家庭',
  'Asia/Hong_Kong',
  'STAR-4821',
  12,
  '2026-11-05T07:22:00.000Z'
);

INSERT OR IGNORE INTO parents (id, family_id, email, created_at) VALUES
  ('par_demo_1', 'fam_demo', 'willis.parent1@example.com', '2026-11-05T07:22:00.000Z'),
  ('par_demo_2', 'fam_demo', 'willis.parent2@example.com', '2026-11-05T07:22:00.000Z');

INSERT OR IGNORE INTO children (id, family_id, display_name, created_at)
VALUES ('chi_demo', 'fam_demo', '小星', '2026-11-05T07:22:00.000Z');

INSERT OR IGNORE INTO tasks (id, family_id, name, points, active, sort_order, created_at) VALUES
  ('task_brush', 'fam_demo', '自己刷牙', 2, 1, 1, '2026-11-05T07:22:00.000Z'),
  ('task_eat', 'fam_demo', '自己吃饭', 2, 1, 2, '2026-11-05T07:22:00.000Z'),
  ('task_room', 'fam_demo', '收拾房间', 3, 1, 3, '2026-11-05T07:22:00.000Z'),
  ('task_homework', 'fam_demo', '完成作业', 5, 1, 4, '2026-11-05T07:22:00.000Z');

INSERT OR IGNORE INTO rewards (id, family_id, name, cost, active, sort_order, created_at) VALUES
  ('reward_story', 'fam_demo', '听一集故事', 5, 1, 1, '2026-11-05T07:22:00.000Z'),
  ('reward_ice', 'fam_demo', '吃冰淇淋', 10, 1, 2, '2026-11-05T07:22:00.000Z'),
  ('reward_cartoon', 'fam_demo', '看一集动画片', 15, 1, 3, '2026-11-05T07:22:00.000Z'),
  ('reward_toy', 'fam_demo', '买一个玩具', 50, 1, 4, '2026-11-05T07:22:00.000Z');

INSERT OR IGNORE INTO activity_log (id, family_id, message, created_at)
VALUES (
  'log_seed_init',
  'fam_demo',
  '系统初始化，初始积分 12 星',
  '2026-11-05T07:22:00.000Z'
);
