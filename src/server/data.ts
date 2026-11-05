import { isTimeZone, localDateISO, localTimeHM } from '../lib/time';
import type { KidState, ParentState } from '../lib/types';
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

type TaskRow = { id: string; name: string; points: number; done: number };
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
  if (!family) throw new HttpError(404, '家庭不存在');
  return family;
}

export async function kidState(db: D1Database, familyId: string, childId: string): Promise<KidState> {
  const family = await familyOf(db, familyId);
  const child = await db.prepare('SELECT display_name FROM children WHERE id = ? AND family_id = ?').bind(childId, familyId).first<{ display_name: string }>();
  if (!child) throw new HttpError(401, '请先绑定设备');
  const localDate = localDateISO(family.timezone);
  const tasks = await db
    .prepare(
      `SELECT t.id, t.name, t.points,
              EXISTS(SELECT 1 FROM checkins c WHERE c.task_id = t.id AND c.local_date = ?) AS done
       FROM tasks t
       WHERE t.family_id = ? AND t.active = 1
       ORDER BY t.sort_order, t.created_at`,
    )
    .bind(localDate, familyId)
    .all<TaskRow>();
  const rewards = await db
    .prepare('SELECT id, name, cost FROM rewards WHERE family_id = ? AND active = 1 ORDER BY sort_order, created_at')
    .bind(familyId)
    .all<RewardRow>();
  return {
    balance: family.star_balance,
    timezone: family.timezone,
    localDate,
    childName: child.display_name,
    tasks: (tasks.results ?? []).map((task) => ({
      id: task.id,
      name: task.name,
      points: task.points,
      done: Number(task.done) === 1,
    })),
    rewards: rewards.results ?? [],
  };
}

export async function parentState(db: D1Database, familyId: string, parentEmail: string): Promise<ParentState> {
  const family = await familyOf(db, familyId);
  const localDate = localDateISO(family.timezone);
  const tasks = await db
    .prepare('SELECT id, name, points FROM tasks WHERE family_id = ? AND active = 1 ORDER BY sort_order, created_at')
    .bind(familyId)
    .all<{ id: string; name: string; points: number }>();
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
    tasks: tasks.results ?? [],
    rewards: rewards.results ?? [],
    logs: (logs.results ?? []).map((item) => ({
      text: item.message,
      time: localTimeHM(family.timezone, item.created_at),
    })),
  };
}

export async function writeLog(db: D1Database, familyId: string, message: string, createdAt = nowIso()): Promise<void> {
  await db
    .prepare('INSERT INTO activity_log (id, family_id, message, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), familyId, message, createdAt)
    .run();
}

export async function setTimezone(db: D1Database, familyId: string, timezone: string): Promise<void> {
  if (!isTimeZone(timezone) || timezone.length > 64) throw new HttpError(400, '时区无效');
  await db.prepare('UPDATE families SET timezone = ? WHERE id = ?').bind(timezone, familyId).run();
  await writeLog(db, familyId, `家庭时区更新为 ${timezone}`);
}

function changes(result: D1Result): number {
  return Number(result.meta.changes ?? 0);
}

export async function checkIn(db: D1Database, familyId: string, childId: string, taskId: string): Promise<{ already: boolean; points: number }> {
  const family = await familyOf(db, familyId);
  const localDate = localDateISO(family.timezone);
  const task = await db
    .prepare('SELECT id, name, points FROM tasks WHERE id = ? AND family_id = ? AND active = 1')
    .bind(taskId, familyId)
    .first<{ id: string; name: string; points: number }>();
  if (!task) throw new HttpError(404, '任务不存在');
  const existing = await db
    .prepare('SELECT id FROM checkins WHERE task_id = ? AND local_date = ?')
    .bind(task.id, localDate)
    .first<{ id: string }>();
  if (existing) return { already: true, points: task.points };

  const createdAt = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO checkins (id, family_id, task_id, child_id, local_date, points, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), familyId, task.id, childId, localDate, task.points, createdAt),
      db.prepare('UPDATE families SET star_balance = star_balance + ? WHERE id = ?').bind(task.points, familyId),
      db
        .prepare('INSERT INTO activity_log (id, family_id, message, created_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), familyId, `完成任务「${task.name}」，获得 +${task.points} 星`, createdAt),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) return { already: true, points: task.points };
    throw error;
  }
  return { already: false, points: task.points };
}

export async function redeem(db: D1Database, familyId: string, rewardId: string): Promise<{ name: string; cost: number }> {
  const reward = await db
    .prepare('SELECT id, name, cost FROM rewards WHERE id = ? AND family_id = ? AND active = 1')
    .bind(rewardId, familyId)
    .first<RewardRow & { id: string }>();
  if (!reward) throw new HttpError(404, '奖励不存在');
  const taken = await db
    .prepare('UPDATE families SET star_balance = star_balance - ? WHERE id = ? AND star_balance >= ?')
    .bind(reward.cost, familyId, reward.cost)
    .run();
  if (!changes(taken)) throw new HttpError(400, '星星还不够，先去完成任务吧');

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
        .bind(crypto.randomUUID(), familyId, `发起兑换「${reward.name}」，冻结 ${reward.cost} 星，等待家长审核`, createdAt),
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
): Promise<{ name: string; cost: number }> {
  const row = await db
    .prepare('SELECT id, reward_name, cost, status FROM redemptions WHERE id = ? AND family_id = ?')
    .bind(redemptionId, familyId)
    .first<{ id: string; reward_name: string; cost: number; status: string }>();
  if (!row || row.status !== 'pending') throw new HttpError(409, '这条申请已经处理过了');
  const resolvedAt = nowIso();
  const updated = await db
    .prepare(
      `UPDATE redemptions
       SET status = ?, resolved_at = ?, resolved_by_parent_id = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(decision, resolvedAt, parentId, row.id)
    .run();
  if (!changes(updated)) throw new HttpError(409, '这条申请已经处理过了');
  if (decision === 'rejected') {
    await db.prepare('UPDATE families SET star_balance = star_balance + ? WHERE id = ?').bind(row.cost, familyId).run();
    await writeLog(db, familyId, `家长拒绝兑换「${row.reward_name}」，返还 ${row.cost} 星`, resolvedAt);
  } else {
    await writeLog(db, familyId, `家长同意兑换「${row.reward_name}」(-${row.cost} 星)`, resolvedAt);
  }
  return { name: row.reward_name, cost: row.cost };
}

async function nextSort(db: D1Database, table: 'tasks' | 'rewards', familyId: string): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM ${table} WHERE family_id = ?`).bind(familyId).first<{ n: number }>();
  return Number(row?.n ?? 0) + 1;
}

export async function addTask(db: D1Database, familyId: string, name: string, points: number): Promise<void> {
  const createdAt = nowIso();
  await db
    .prepare('INSERT INTO tasks (id, family_id, name, points, active, sort_order, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .bind(crypto.randomUUID(), familyId, name, points, await nextSort(db, 'tasks', familyId), createdAt)
    .run();
  await writeLog(db, familyId, `新增每日任务「${name}」(+${points} 星)`, createdAt);
}

export async function updateTask(db: D1Database, familyId: string, taskId: string, name: string, points: number): Promise<void> {
  const updated = await db
    .prepare('UPDATE tasks SET name = ?, points = ? WHERE id = ? AND family_id = ? AND active = 1')
    .bind(name, points, taskId, familyId)
    .run();
  if (!changes(updated)) throw new HttpError(404, '任务不存在');
  await writeLog(db, familyId, `更新每日任务「${name}」(+${points} 星)`);
}

export async function disableTask(db: D1Database, familyId: string, taskId: string): Promise<string> {
  const task = await db
    .prepare('SELECT name FROM tasks WHERE id = ? AND family_id = ? AND active = 1')
    .bind(taskId, familyId)
    .first<{ name: string }>();
  if (!task) throw new HttpError(404, '任务不存在');
  await db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').bind(taskId).run();
  await writeLog(db, familyId, `停用每日任务「${task.name}」`);
  return task.name;
}

export async function addReward(db: D1Database, familyId: string, name: string, cost: number): Promise<void> {
  const createdAt = nowIso();
  await db
    .prepare('INSERT INTO rewards (id, family_id, name, cost, active, sort_order, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .bind(crypto.randomUUID(), familyId, name, cost, await nextSort(db, 'rewards', familyId), createdAt)
    .run();
  await writeLog(db, familyId, `新增兑换奖励「${name}」(${cost} 星)`, createdAt);
}

export async function updateReward(db: D1Database, familyId: string, rewardId: string, name: string, cost: number): Promise<void> {
  const updated = await db
    .prepare('UPDATE rewards SET name = ?, cost = ? WHERE id = ? AND family_id = ? AND active = 1')
    .bind(name, cost, rewardId, familyId)
    .run();
  if (!changes(updated)) throw new HttpError(404, '奖励不存在');
  await writeLog(db, familyId, `更新兑换奖励「${name}」(${cost} 星)`);
}

export async function disableReward(db: D1Database, familyId: string, rewardId: string): Promise<string> {
  const reward = await db
    .prepare('SELECT name FROM rewards WHERE id = ? AND family_id = ? AND active = 1')
    .bind(rewardId, familyId)
    .first<{ name: string }>();
  if (!reward) throw new HttpError(404, '奖励不存在');
  await db.prepare('UPDATE rewards SET active = 0 WHERE id = ?').bind(rewardId).run();
  await writeLog(db, familyId, `停用兑换奖励「${reward.name}」`);
  return reward.name;
}
