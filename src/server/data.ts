import { text, type Locale } from '../lib/i18n';
import { isTimeZone, localDateISO, localTimeHM } from '../lib/time';
import type { CatalogTask, KidState, KidTask, ParentState, TaskKind } from '../lib/types';
import type { D1Database, D1Result } from './d1';
import { HttpError, nowIso } from './http';

export type FamilyRow = {
  id: string;
  name: string;
  timezone: string;
  family_code: string;
  star_balance: number;
};

export type SessionRow = {
  id: string;
  role: 'parent' | 'child';
  family_id: string;
  parent_id: string | null;
  child_device_id: string | null;
  child_id: string | null;
  parent_email: string | null;
  expires_at: string;
};

type KidTaskRow = {
  id: string;
  name: string;
  points: number;
  kind: string;
  daily_limit: number;
  today_count: number;
};
type CatalogTaskRow = {
  id: string;
  name: string;
  points: number;
  kind: string;
  daily_limit: number;
  awarded: number;
};
type RewardRow = { id: string; name: string; cost: number };
type PendingRow = { id: string; reward_name: string; cost: number; requested_at: string };
type LogRow = { message: string; created_at: string };

export async function loadSession(db: D1Database, tokenHash: string): Promise<SessionRow | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.role, s.family_id, s.parent_id, s.child_device_id, s.expires_at,
              d.child_id AS child_id, p.email AS parent_email
       FROM sessions s
       LEFT JOIN child_devices d ON d.id = s.child_device_id
       LEFT JOIN parents p ON p.id = s.parent_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row || row.expires_at <= nowIso()) return null;
  return row;
}

async function familyOf(db: D1Database, familyId: string): Promise<FamilyRow> {
  const family = await db
    .prepare('SELECT id, name, timezone, family_code, star_balance FROM families WHERE id = ?')
    .bind(familyId)
    .first<FamilyRow>();
  if (!family) throw new HttpError(404, 'familyMissing');
  return family;
}

export async function kidState(db: D1Database, familyId: string, childId: string): Promise<KidState> {
  const family = await familyOf(db, familyId);
  const child = await db.prepare('SELECT display_name FROM children WHERE id = ? AND family_id = ?').bind(childId, familyId).first<{ display_name: string }>();
  if (!child) throw new HttpError(401, 'bindRequired');
  const localDate = localDateISO(family.timezone);
  const tasks = await db
    .prepare(
      `SELECT t.id, t.name, t.points, t.kind, t.daily_limit,
              (SELECT COUNT(*) FROM checkins c WHERE c.task_id = t.id AND c.local_date = ?) AS today_count
       FROM tasks t
       WHERE t.family_id = ? AND t.active = 1
         AND (
           t.kind = 'daily'
           OR NOT EXISTS (SELECT 1 FROM starburst_awards a WHERE a.task_id = t.id)
         )
       ORDER BY t.sort_order, t.created_at`,
    )
    .bind(localDate, familyId)
    .all<KidTaskRow>();
  const rewards = await db
    .prepare('SELECT id, name, cost FROM rewards WHERE family_id = ? AND active = 1 ORDER BY sort_order, created_at')
    .bind(familyId)
    .all<RewardRow>();
  return {
    balance: family.star_balance,
    timezone: family.timezone,
    localDate,
    childName: child.display_name,
    tasks: (tasks.results ?? []).map((task) => toKidTask(task)),
    rewards: rewards.results ?? [],
  };
}

export async function parentState(db: D1Database, familyId: string, parentEmail: string, parentId: string): Promise<ParentState> {
  const family = await familyOf(db, familyId);
  const localDate = localDateISO(family.timezone);
  const tasks = await db
    .prepare(
      `SELECT t.id, t.name, t.points, t.kind, t.daily_limit,
              EXISTS(SELECT 1 FROM starburst_awards a WHERE a.task_id = t.id) AS awarded
       FROM tasks t
       WHERE t.family_id = ? AND t.active = 1
       ORDER BY t.sort_order, t.created_at`,
    )
    .bind(familyId)
    .all<CatalogTaskRow>();
  const rewards = await db
    .prepare('SELECT id, name, cost FROM rewards WHERE family_id = ? AND active = 1 ORDER BY sort_order, created_at')
    .bind(familyId)
    .all<RewardRow>();
  const pending = await db
    .prepare(
      `SELECT id, reward_name, cost, requested_at FROM redemptions
       WHERE family_id = ? AND status = 'pending'
       ORDER BY requested_at ASC`,
    )
    .bind(familyId)
    .all<PendingRow>();
  const logs = await db
    .prepare('SELECT message, created_at FROM activity_log WHERE family_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50')
    .bind(familyId)
    .all<LogRow>();
  const passkeys = await db
    .prepare('SELECT COUNT(*) AS n FROM parent_passkeys WHERE parent_id = ?')
    .bind(parentId)
    .first<{ n: number }>();
  const passkeyCount = Number(passkeys?.n ?? 0);
  return {
    balance: family.star_balance,
    timezone: family.timezone,
    familyCode: family.family_code,
    familyName: family.name,
    parentEmail,
    localDate,
    pending: (pending.results ?? []).map((item) => ({
      id: item.id,
      name: item.reward_name,
      cost: item.cost,
      time: localTimeHM(family.timezone, item.requested_at),
    })),
    tasks: (tasks.results ?? []).map((task) => toCatalogTask(task)),
    rewards: rewards.results ?? [],
    logs: (logs.results ?? []).map((item) => ({
      text: item.message,
      time: localTimeHM(family.timezone, item.created_at),
    })),
    hasPasskeys: passkeyCount > 0,
    passkeyCount,
  };
}

export async function writeLog(db: D1Database, familyId: string, message: string, createdAt = nowIso()): Promise<void> {
  await db
    .prepare('INSERT INTO activity_log (id, family_id, message, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), familyId, message, createdAt)
    .run();
}

export async function setTimezone(db: D1Database, familyId: string, timezone: string, locale: Locale): Promise<void> {
  if (!isTimeZone(timezone) || timezone.length > 64) throw new HttpError(400, 'timezoneInvalid');
  await db.prepare('UPDATE families SET timezone = ? WHERE id = ?').bind(timezone, familyId).run();
  await writeLog(db, familyId, text(locale).logTimezone(timezone));
}

function changes(result: D1Result | undefined): number {
  return Number(result?.meta.changes ?? 0);
}

function toKidTask(task: KidTaskRow): KidTask {
  const kind: TaskKind = task.kind === 'starburst' ? 'starburst' : 'daily';
  const limit = kind === 'daily' ? Number(task.daily_limit) : 1;
  const count = kind === 'daily' ? Number(task.today_count) : 0;
  return {
    id: task.id,
    name: task.name,
    points: task.points,
    kind,
    count,
    limit,
    done: kind === 'daily' && count >= limit,
  };
}

function toCatalogTask(task: CatalogTaskRow): CatalogTask {
  const kind: TaskKind = task.kind === 'starburst' ? 'starburst' : 'daily';
  return {
    id: task.id,
    name: task.name,
    points: task.points,
    kind,
    dailyLimit: Number(task.daily_limit),
    awarded: Number(task.awarded) === 1,
  };
}

export async function checkIn(
  db: D1Database,
  familyId: string,
  childId: string,
  taskId: string,
  locale: Locale,
): Promise<{ already: boolean; points: number }> {
  const family = await familyOf(db, familyId);
  const localDate = localDateISO(family.timezone);
  const task = await db
    .prepare('SELECT id, name, points, kind, daily_limit FROM tasks WHERE id = ? AND family_id = ? AND active = 1')
    .bind(taskId, familyId)
    .first<{ id: string; name: string; points: number; kind: string; daily_limit: number }>();
  if (!task) throw new HttpError(404, 'taskMissing');
  if (task.kind === 'starburst') throw new HttpError(403, 'starburstParentOnly', 'starburst_parent_only');
  const limit = Number(task.daily_limit);
  const checkinId = crypto.randomUUID();
  const createdAt = nowIso();
  const logged = text(locale).logCheckin(task.name, task.points);
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO checkins (id, family_id, task_id, child_id, local_date, points, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM checkins WHERE task_id = ? AND local_date = ?) < ?`,
      )
      .bind(checkinId, familyId, task.id, childId, localDate, task.points, createdAt, task.id, localDate, limit),
    db
      .prepare(
        `UPDATE families SET star_balance = star_balance + ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM checkins WHERE id = ?)`,
      )
      .bind(task.points, familyId, checkinId),
    db
      .prepare(
        `INSERT INTO activity_log (id, family_id, message, created_at)
         SELECT ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM checkins WHERE id = ?)`,
      )
      .bind(crypto.randomUUID(), familyId, logged, createdAt, checkinId),
  ]);
  if (!changes(results[0])) return { already: true, points: task.points };
  return { already: false, points: task.points };
}

export async function awardStarburst(
  db: D1Database,
  familyId: string,
  parentId: string,
  taskId: string,
  locale: Locale,
): Promise<{ name: string; points: number }> {
  const task = await db
    .prepare('SELECT id, name, points, kind FROM tasks WHERE id = ? AND family_id = ? AND active = 1')
    .bind(taskId, familyId)
    .first<{ id: string; name: string; points: number; kind: string }>();
  if (!task) throw new HttpError(404, 'taskMissing');
  if (task.kind !== 'starburst') throw new HttpError(400, 'taskInvalid');
  const child = await db.prepare('SELECT id FROM children WHERE family_id = ?').bind(familyId).first<{ id: string }>();
  if (!child) throw new HttpError(400, 'noChild');
  const existing = await db
    .prepare('SELECT id FROM starburst_awards WHERE task_id = ?')
    .bind(task.id)
    .first<{ id: string }>();
  if (existing) throw new HttpError(409, 'alreadyAwarded', 'already_awarded');
  const createdAt = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO starburst_awards (id, family_id, task_id, child_id, parent_id, points, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), familyId, task.id, child.id, parentId, task.points, createdAt),
      db.prepare('UPDATE families SET star_balance = star_balance + ? WHERE id = ?').bind(task.points, familyId),
      db
        .prepare('INSERT INTO activity_log (id, family_id, message, created_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), familyId, text(locale).logStarburstAwarded(task.name, task.points), createdAt),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) throw new HttpError(409, 'alreadyAwarded', 'already_awarded');
    throw error;
  }
  return { name: task.name, points: task.points };
}

export async function redeem(db: D1Database, familyId: string, rewardId: string, locale: Locale): Promise<{ name: string; cost: number }> {
  const reward = await db
    .prepare('SELECT id, name, cost FROM rewards WHERE id = ? AND family_id = ? AND active = 1')
    .bind(rewardId, familyId)
    .first<RewardRow & { id: string }>();
  if (!reward) throw new HttpError(404, 'rewardMissing');
  const taken = await db
    .prepare('UPDATE families SET star_balance = star_balance - ? WHERE id = ? AND star_balance >= ?')
    .bind(reward.cost, familyId, reward.cost)
    .run();
  if (!changes(taken)) throw new HttpError(400, 'needStars');

  const createdAt = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO redemptions (id, family_id, reward_id, reward_name, cost, status, requested_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .bind(crypto.randomUUID(), familyId, reward.id, reward.name, reward.cost, createdAt),
      db
        .prepare('INSERT INTO activity_log (id, family_id, message, created_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), familyId, text(locale).logRedeem(reward.name, reward.cost), createdAt),
    ]);
  } catch (error) {
    await db.prepare('UPDATE families SET star_balance = star_balance + ? WHERE id = ?').bind(reward.cost, familyId).run();
    throw error;
  }
  return { name: reward.name, cost: reward.cost };
}

export async function resolveRedemption(
  db: D1Database,
  familyId: string,
  parentId: string,
  redemptionId: string,
  decision: 'approved' | 'rejected',
  locale: Locale,
): Promise<{ name: string; cost: number }> {
  const row = await db
    .prepare('SELECT id, reward_name, cost, status FROM redemptions WHERE id = ? AND family_id = ?')
    .bind(redemptionId, familyId)
    .first<{ id: string; reward_name: string; cost: number; status: string }>();
  if (!row || row.status !== 'pending') throw new HttpError(409, 'alreadyResolved');
  const resolvedAt = nowIso();
  const updated = await db
    .prepare(
      `UPDATE redemptions
       SET status = ?, resolved_at = ?, resolved_by_parent_id = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(decision, resolvedAt, parentId, row.id)
    .run();
  if (!changes(updated)) throw new HttpError(409, 'alreadyResolved');
  if (decision === 'rejected') {
    await db.prepare('UPDATE families SET star_balance = star_balance + ? WHERE id = ?').bind(row.cost, familyId).run();
    await writeLog(db, familyId, text(locale).logReject(row.reward_name, row.cost), resolvedAt);
  } else {
    await writeLog(db, familyId, text(locale).logApprove(row.reward_name, row.cost), resolvedAt);
  }
  return { name: row.reward_name, cost: row.cost };
}

async function nextSort(db: D1Database, table: 'tasks' | 'rewards', familyId: string): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM ${table} WHERE family_id = ?`).bind(familyId).first<{ n: number }>();
  return Number(row?.n ?? 0) + 1;
}

export async function addTask(
  db: D1Database,
  familyId: string,
  name: string,
  points: number,
  locale: Locale,
  options: { kind?: TaskKind; dailyLimit?: number } = {},
): Promise<void> {
  const kind: TaskKind = options.kind === 'starburst' ? 'starburst' : 'daily';
  const dailyLimit = kind === 'daily' ? (options.dailyLimit ?? 1) : 1;
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 9) throw new HttpError(400, 'dailyLimitInvalid');
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO tasks (id, family_id, name, points, active, sort_order, created_at, kind, daily_limit)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), familyId, name, points, await nextSort(db, 'tasks', familyId), createdAt, kind, dailyLimit)
    .run();
  const copy = text(locale);
  await writeLog(
    db,
    familyId,
    kind === 'daily' ? copy.logTaskAdded(name, points, dailyLimit) : copy.logStarburstAdded(name, points),
    createdAt,
  );
}

export async function updateTask(
  db: D1Database,
  familyId: string,
  taskId: string,
  name: string,
  points: number,
  locale: Locale,
  dailyLimit: number | null = null,
): Promise<void> {
  const existing = await db
    .prepare('SELECT id, kind, daily_limit FROM tasks WHERE id = ? AND family_id = ? AND active = 1')
    .bind(taskId, familyId)
    .first<{ id: string; kind: string; daily_limit: number }>();
  if (!existing) throw new HttpError(404, 'taskMissing');
  const kind: TaskKind = existing.kind === 'starburst' ? 'starburst' : 'daily';
  const nextLimit = kind === 'daily' ? (dailyLimit ?? Number(existing.daily_limit)) : Number(existing.daily_limit);
  if (!Number.isInteger(nextLimit) || nextLimit < 1 || nextLimit > 9) throw new HttpError(400, 'dailyLimitInvalid');
  const updated = await db
    .prepare('UPDATE tasks SET name = ?, points = ?, daily_limit = ? WHERE id = ? AND family_id = ? AND active = 1')
    .bind(name, points, nextLimit, taskId, familyId)
    .run();
  if (!changes(updated)) throw new HttpError(404, 'taskMissing');
  const copy = text(locale);
  await writeLog(
    db,
    familyId,
    kind === 'daily' ? copy.logTaskUpdated(name, points, nextLimit) : copy.logStarburstUpdated(name, points),
  );
}

export async function disableTask(db: D1Database, familyId: string, taskId: string, locale: Locale): Promise<string> {
  const task = await db
    .prepare('SELECT name, kind FROM tasks WHERE id = ? AND family_id = ? AND active = 1')
    .bind(taskId, familyId)
    .first<{ name: string; kind: string }>();
  if (!task) throw new HttpError(404, 'taskMissing');
  await db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').bind(taskId).run();
  const copy = text(locale);
  await writeLog(db, familyId, task.kind === 'starburst' ? copy.logStarburstDisabled(task.name) : copy.logTaskDisabled(task.name));
  return task.name;
}

export async function addReward(db: D1Database, familyId: string, name: string, cost: number, locale: Locale): Promise<void> {
  const createdAt = nowIso();
  await db
    .prepare('INSERT INTO rewards (id, family_id, name, cost, active, sort_order, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .bind(crypto.randomUUID(), familyId, name, cost, await nextSort(db, 'rewards', familyId), createdAt)
    .run();
  await writeLog(db, familyId, text(locale).logRewardAdded(name, cost), createdAt);
}

export async function updateReward(
  db: D1Database,
  familyId: string,
  rewardId: string,
  name: string,
  cost: number,
  locale: Locale,
): Promise<void> {
  const updated = await db
    .prepare('UPDATE rewards SET name = ?, cost = ? WHERE id = ? AND family_id = ? AND active = 1')
    .bind(name, cost, rewardId, familyId)
    .run();
  if (!changes(updated)) throw new HttpError(404, 'rewardMissing');
  await writeLog(db, familyId, text(locale).logRewardUpdated(name, cost));
}

export async function disableReward(db: D1Database, familyId: string, rewardId: string, locale: Locale): Promise<string> {
  const reward = await db
    .prepare('SELECT name FROM rewards WHERE id = ? AND family_id = ? AND active = 1')
    .bind(rewardId, familyId)
    .first<{ name: string }>();
  if (!reward) throw new HttpError(404, 'rewardMissing');
  await db.prepare('UPDATE rewards SET active = 0 WHERE id = ?').bind(rewardId).run();
  await writeLog(db, familyId, text(locale).logRewardDisabled(reward.name));
  return reward.name;
}
