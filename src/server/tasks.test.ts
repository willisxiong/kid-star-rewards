import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { text } from '../lib/i18n.ts';
import { localDateISO } from '../lib/time.ts';
import { app } from './app.ts';
import { addTask, awardStarburst, checkIn, kidState, parentState, updateTask } from './data.ts';
import { HttpError, PARENT_SESSION_COOKIE, PARENT_SESSION_SECONDS, sha256 } from './http.ts';
import { createDb, ORIGIN, SECRET } from './testing.ts';

test('migration keeps check-ins and star balances and allows another check-in the same day', () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_schema.sql', '0002_seed_demo.sql', '0003_passkeys.sql']) {
    sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  }
  sqlite
    .prepare(
      `INSERT INTO checkins (id, family_id, task_id, child_id, local_date, points, created_at)
       VALUES ('check_eat_1', 'fam_demo', 'task_eat', 'chi_demo', '2026-11-18', 2, '2026-11-18T01:00:00.000Z')`,
    )
    .run();
  assert.throws(() =>
    sqlite
      .prepare(
        `INSERT INTO checkins (id, family_id, task_id, child_id, local_date, points, created_at)
         VALUES ('check_eat_2', 'fam_demo', 'task_eat', 'chi_demo', '2026-11-18', 2, '2026-11-18T02:00:00.000Z')`,
      )
      .run(),
  );
  sqlite.prepare(`UPDATE families SET star_balance = 42 WHERE id = 'fam_demo'`).run();
  const sql = readFileSync(new URL('../../migrations/0004_daily_checkin_and_starburst.sql', import.meta.url), 'utf8');
  const executable = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(executable, /star_balance/);
  assert.doesNotMatch(executable, /UPDATE\s+families/i);
  sqlite.exec(sql);

  const kept = sqlite.prepare(`SELECT id, points, local_date FROM checkins WHERE id = 'check_eat_1'`).get() as {
    id: string;
    points: number;
    local_date: string;
  };
  assert.equal(kept.id, 'check_eat_1');
  assert.equal(kept.points, 2);
  assert.equal(kept.local_date, '2026-11-18');
  assert.equal(familyBalance(sqlite), 42);
  const eat = sqlite.prepare(`SELECT kind, daily_limit, points FROM tasks WHERE id = 'task_eat'`).get() as {
    kind: string;
    daily_limit: number;
    points: number;
  };
  assert.equal(eat.kind, 'daily');
  assert.equal(eat.daily_limit, 1);
  assert.equal(eat.points, 2);
  const migrated = sqlite.prepare(`SELECT kind, daily_limit FROM tasks`).all() as { kind: string; daily_limit: number }[];
  assert.ok(migrated.length >= 1);
  for (const task of migrated) {
    assert.equal(task.kind, 'daily');
    assert.equal(task.daily_limit, 1);
  }
  sqlite
    .prepare(
      `INSERT INTO checkins (id, family_id, task_id, child_id, local_date, points, created_at)
       VALUES ('check_eat_2', 'fam_demo', 'task_eat', 'chi_demo', '2026-11-18', 2, '2026-11-18T02:00:00.000Z')`,
    )
    .run();
  assert.equal(countCheckins(sqlite, 'task_eat'), 2);
  assert.equal(familyBalance(sqlite), 42);
  const index = sqlite.prepare(`SELECT "unique" AS u FROM pragma_index_list('checkins') WHERE name = 'checkins_task_date'`).get() as {
    u: number;
  };
  assert.equal(index.u, 0);
});

test('existing tasks, including 自己吃饭, stay at one check-in a day', () => {
  const { sqlite } = createDb();
  const rows = sqlite.prepare(`SELECT name, kind, daily_limit, points FROM tasks ORDER BY sort_order`).all() as {
    name: string;
    kind: string;
    daily_limit: number;
    points: number;
  }[];
  assert.deepEqual(
    rows.map((row) => row.name),
    ['自己刷牙', '自己吃饭', '收拾房间', '完成作业'],
  );
  for (const row of rows) {
    assert.equal(row.kind, 'daily');
    assert.equal(row.daily_limit, 1);
  }
  assert.equal(rows[1].points, 2);
  assert.equal(familyBalance(sqlite), 12);
});

test('a child can check in up to the daily count and cannot undo', async () => {
  const { env, sqlite } = createDb();
  await updateTask(env.DB, 'fam_demo', 'task_eat', '自己吃饭', 2, 'en', 3);
  const today = localDateISO('Asia/Hong_Kong');
  for (let time = 0; time < 3; time += 1) {
    const result = await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', time === 1 ? 'zh-CN' : 'en');
    assert.equal(result.already, false);
    assert.equal(result.points, 2);
  }
  const state = await kidState(env.DB, 'fam_demo', 'chi_demo');
  const eat = state.tasks.find((task) => task.id === 'task_eat');
  assert.ok(eat);
  assert.equal(eat.kind, 'daily');
  assert.equal(eat.count, 3);
  assert.equal(eat.limit, 3);
  assert.equal(eat.done, true);
  assert.equal(familyBalance(sqlite), 18);
  const full = await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en');
  assert.equal(full.already, true);
  assert.equal(familyBalance(sqlite), 18);
  assert.equal(countCheckins(sqlite, 'task_eat', today), 3);
  const logs = sqlite.prepare(`SELECT message FROM activity_log ORDER BY rowid DESC LIMIT 3`).all() as { message: string }[];
  assert.match(logs[0].message, /Checked in/);
  assert.match(logs[1].message, /完成任务/);
  assert.match(logs[2].message, /Checked in/);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE message LIKE '%自己吃饭%'`).get().n, 4);
});

test('lowering the cap blocks later check-ins without taking stars back, and raising it continues', async () => {
  const { env, sqlite } = createDb();
  await updateTask(env.DB, 'fam_demo', 'task_eat', '自己吃饭', 2, 'en', 3);
  for (let time = 0; time < 3; time += 1) {
    assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, false);
  }
  assert.equal(familyBalance(sqlite), 18);
  assert.equal(sumPoints(sqlite, 'task_eat'), 6);
  await updateTask(env.DB, 'fam_demo', 'task_eat', '自己吃饭', 2, 'en', 1);
  assert.equal(familyBalance(sqlite), 18);
  assert.equal(sumPoints(sqlite, 'task_eat'), 6);
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, true);
  assert.equal(countCheckins(sqlite, 'task_eat'), 3);
  const lowered = sqlite.prepare(`SELECT message FROM activity_log ORDER BY rowid DESC LIMIT 1`).get() as { message: string };
  assert.match(lowered.message, /1 a day/);
  await updateTask(env.DB, 'fam_demo', 'task_eat', '自己吃饭', 2, 'zh-CN', 4);
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, false);
  assert.equal(familyBalance(sqlite), 20);
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, true);
  assert.equal(countCheckins(sqlite, 'task_eat'), 4);
  assert.equal(familyBalance(sqlite), 20);
});

test('the daily count follows the family timezone and rolls to the next calendar day', async () => {
  const { env, sqlite } = createDb();
  const now = new Date();
  const pago = localDateISO('Pacific/Pago_Pago', now);
  const kiritimati = localDateISO('Pacific/Kiritimati', now);
  assert.notEqual(pago, kiritimati);
  sqlite.prepare(`UPDATE families SET timezone = 'Pacific/Pago_Pago' WHERE id = 'fam_demo'`).run();
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_brush', 'en')).already, false);
  assert.equal(storedDates(sqlite, 'task_brush')[0], pago);
  sqlite.prepare(`UPDATE families SET timezone = 'Pacific/Kiritimati' WHERE id = 'fam_demo'`).run();
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_brush', 'en')).already, false);
  assert.deepEqual(storedDates(sqlite, 'task_brush').sort(), [pago, kiritimati].sort());
  assert.equal(familyBalance(sqlite), 16);

  sqlite.prepare(`UPDATE families SET timezone = 'Asia/Hong_Kong' WHERE id = 'fam_demo'`).run();
  await updateTask(env.DB, 'fam_demo', 'task_eat', '自己吃饭', 2, 'en', 2);
  const today = localDateISO('Asia/Hong_Kong');
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, false);
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, false);
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, true);
  sqlite.prepare(`UPDATE checkins SET local_date = ? WHERE task_id = 'task_eat'`).run(previousDate(today));
  assert.equal((await checkIn(env.DB, 'fam_demo', 'chi_demo', 'task_eat', 'en')).already, false);
  assert.equal(countCheckins(sqlite, 'task_eat', previousDate(today)), 2);
  assert.equal(countCheckins(sqlite, 'task_eat', today), 1);
  assert.equal(storedDates(sqlite, 'task_eat').at(-1), today);
});

test('a Star Burst is awarded once by a parent, then leaves the child list', async () => {
  const { env, sqlite } = createDb();
  await addTask(env.DB, 'fam_demo', 'Math prize', 50, 'en', { kind: 'starburst' });
  await addTask(env.DB, 'fam_demo', '数学竞赛一等奖', 50, 'zh-CN', { kind: 'starburst' });
  const created = sqlite.prepare(`SELECT id, name, daily_limit FROM tasks WHERE kind = 'starburst' ORDER BY created_at`).all() as {
    id: string;
    name: string;
    daily_limit: number;
  }[];
  assert.equal(created[0].name, 'Math prize');
  assert.equal(created[0].daily_limit, 1);
  const before = await kidState(env.DB, 'fam_demo', 'chi_demo');
  assert.equal(before.tasks.some((task) => task.id === created[0].id && task.kind === 'starburst' && !task.done), true);
  await expectStatus(checkIn(env.DB, 'fam_demo', 'chi_demo', created[0].id, 'en'), 403);
  assert.equal(familyBalance(sqlite), 12);
  assert.equal(countCheckins(sqlite, created[0].id), 0);
  const awarded = await awardStarburst(env.DB, 'fam_demo', 'par_demo_1', created[0].id, 'en');
  assert.deepEqual(awarded, { name: 'Math prize', points: 50 });
  assert.equal(familyBalance(sqlite), 62);
  const hidden = await kidState(env.DB, 'fam_demo', 'chi_demo');
  assert.equal(hidden.tasks.some((task) => task.id === created[0].id), false);
  assert.equal(hidden.tasks.some((task) => task.id === created[1].id), true);
  const catalog = await parentState(env.DB, 'fam_demo', 'willis.parent1@example.com', 'par_demo_1');
  const listed = catalog.tasks.find((task) => task.id === created[0].id);
  assert.equal(listed?.kind, 'starburst');
  assert.equal(listed?.awarded, true);
  await expectStatus(awardStarburst(env.DB, 'fam_demo', 'par_demo_2', created[0].id, 'zh-CN'), 409);
  assert.equal(familyBalance(sqlite), 62);
  assert.equal(countCheckins(sqlite, created[0].id), 0);
  const englishLog = sqlite.prepare(`SELECT message FROM activity_log ORDER BY rowid DESC LIMIT 1`).get() as { message: string };
  assert.match(englishLog.message, /Star Burst “Math prize”/);
  await awardStarburst(env.DB, 'fam_demo', 'par_demo_1', created[1].id, 'zh-CN');
  const chineseLog = sqlite.prepare(`SELECT message FROM activity_log ORDER BY rowid DESC LIMIT 1`).get() as { message: string };
  assert.match(chineseLog.message, /星爆任务「数学竞赛一等奖」/);
  const gone = await kidState(env.DB, 'fam_demo', 'chi_demo');
  assert.equal(gone.tasks.some((task) => task.kind === 'starburst'), false);
  assert.equal(familyBalance(sqlite), 112);
  await expectStatus(awardStarburst(env.DB, 'fam_demo', 'par_demo_1', 'task_eat', 'en'), 400);
});

test('HTTP check-in honors the cap, blocks child award, and does not undo', async () => {
  const { env, sqlite } = createDb();
  const child = await childCookie(env);
  const parent = await parentCookie(sqlite);
  const locked = await app.fetch(post('/api/parent/tasks', { name: 'Eat alone', points: 2, dailyLimit: 3 }, parent), env);
  assert.equal(locked.status, 403);
  await addTask(env.DB, 'fam_demo', 'Math prize', 50, 'en', { kind: 'starburst' });
  const burstId = (sqlite.prepare(`SELECT id FROM tasks WHERE name = 'Math prize'`).get() as { id: string }).id;
  const lockedAward = await app.fetch(post(`/api/parent/tasks/${burstId}/award`, {}, parent), env);
  assert.equal(lockedAward.status, 403);

  grantPasskeyCount(sqlite);
  const invalid = await app.fetch(post('/api/parent/tasks', { name: 'Too many', points: 2, dailyLimit: 10 }, parent), env);
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { message: string }).message, text('en').dailyLimitInvalid);
  const chineseInvalid = await app.fetch(
    post('/api/parent/tasks', { name: '次数不对', points: 2, kind: 'daily', dailyLimit: 0 }, `${parent}; ks_lang=zh-CN`),
    env,
  );
  assert.equal(chineseInvalid.status, 400);
  assert.equal(((await chineseInvalid.json()) as { message: string }).message, text('zh-CN').dailyLimitInvalid);

  const added = await app.fetch(post('/api/parent/tasks', { name: 'Eat alone', points: 2, kind: 'daily', dailyLimit: 3 }, parent), env);
  assert.equal(added.status, 200);
  const taskId = (sqlite.prepare(`SELECT id FROM tasks WHERE name = 'Eat alone'`).get() as { id: string }).id;
  const first = await app.fetch(post('/api/kid/checkin', { taskId }, child), env);
  assert.equal(first.status, 200);
  const second = await app.fetch(post('/api/kid/checkin', { taskId }, child), env);
  const secondBody = (await second.json()) as { already: boolean; state: { balance: number; tasks: { id: string; count: number; limit: number; done: boolean }[] } };
  assert.equal(secondBody.already, false);
  assert.equal(secondBody.state.balance, 16);
  const progress = secondBody.state.tasks.find((task) => task.id === taskId);
  assert.deepEqual(
    progress && { count: progress.count, limit: progress.limit, done: progress.done },
    { count: 2, limit: 3, done: false },
  );

  const undo = await app.fetch(
    new Request(`${ORIGIN}/api/kid/checkin/undo`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: child },
      body: '{}',
    }),
    env,
  );
  assert.equal(undo.status, 404);
  const removed = await app.fetch(
    new Request(`${ORIGIN}/api/kid/checkins/${taskId}`, {
      method: 'DELETE',
      headers: { origin: ORIGIN, cookie: child },
    }),
    env,
  );
  assert.equal(removed.status, 404);
  assert.equal(countCheckins(sqlite, taskId), 2);
  assert.equal(familyBalance(sqlite), 16);

  assert.equal(((await (await app.fetch(post('/api/kid/checkin', { taskId }, child), env)).json()) as { already: boolean }).already, false);
  const full = await app.fetch(post('/api/kid/checkin', { taskId }, `${child}; ks_lang=zh-CN`), env);
  const fullBody = (await full.json()) as { already: boolean; toast: string; state: { balance: number } };
  assert.equal(fullBody.already, true);
  assert.equal(fullBody.toast, text('zh-CN').alreadyChecked);
  assert.equal(fullBody.state.balance, 18);

  const lowered = await app.fetch(postPatch(`/api/parent/tasks/${taskId}`, { name: 'Eat alone', points: 2, dailyLimit: 1 }, parent), env);
  assert.equal(lowered.status, 200);
  assert.equal(familyBalance(sqlite), 18);
  const stillFull = (await (await app.fetch(post('/api/kid/checkin', { taskId }, child), env)).json()) as { already: boolean; state: { balance: number } };
  assert.equal(stillFull.already, true);
  assert.equal(stillFull.state.balance, 18);

  const raised = await app.fetch(postPatch(`/api/parent/tasks/${taskId}`, { name: 'Eat alone', points: 2, dailyLimit: 4 }, parent), env);
  assert.equal(raised.status, 200);
  const continued = (await (await app.fetch(post('/api/kid/checkin', { taskId }, child), env)).json()) as {
    already: boolean;
    state: { balance: number; tasks: { id: string; count: number; limit: number }[] };
  };
  assert.equal(continued.already, false);
  assert.equal(continued.state.balance, 20);
  assert.equal(continued.state.tasks.find((task) => task.id === taskId)?.count, 4);

  const selfAward = await app.fetch(post(`/api/parent/tasks/${burstId}/award`, {}, child), env);
  assert.equal(selfAward.status, 401);
  const blocked = await app.fetch(post('/api/kid/checkin', { taskId: burstId }, child), env);
  assert.equal(blocked.status, 403);
  const blockedBody = (await blocked.json()) as { error: string; message: string };
  assert.equal(blockedBody.error, 'starburst_parent_only');
  assert.equal(blockedBody.message, text('en').starburstParentOnly);
  const blockedZh = await app.fetch(post('/api/kid/checkin', { taskId: burstId }, `${child}; ks_lang=zh-CN`), env);
  assert.equal(((await blockedZh.json()) as { message: string }).message, text('zh-CN').starburstParentOnly);
  const visible = await app.fetch(new Request(`${ORIGIN}/api/kid/state`, { headers: { cookie: child } }), env);
  const visibleBody = (await visible.json()) as { tasks: { id: string; kind: string }[] };
  assert.equal(visibleBody.tasks.some((task) => task.id === burstId && task.kind === 'starburst'), true);

  const award = await app.fetch(post(`/api/parent/tasks/${burstId}/award`, {}, parent), env);
  assert.equal(award.status, 200);
  const awardBody = (await award.json()) as { toast: string; state: { balance: number; tasks: { id: string; awarded: boolean; kind: string }[] } };
  assert.equal(awardBody.toast, text('en').starburstAwarded('Math prize', 50));
  assert.equal(awardBody.state.balance, 70);
  assert.equal(awardBody.state.tasks.find((task) => task.id === burstId)?.awarded, true);
  const after = await kidState(env.DB, 'fam_demo', 'chi_demo');
  assert.equal(after.tasks.some((task) => task.id === burstId), false);
  const again = await app.fetch(post(`/api/parent/tasks/${burstId}/award`, {}, `${parent}; ks_lang=zh-CN`), env);
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { message: string }).message, text('zh-CN').alreadyAwarded);
  assert.equal(familyBalance(sqlite), 70);
  assert.equal(countCheckins(sqlite, burstId), 0);
});

function familyBalance(sqlite: DatabaseSync): number {
  return (sqlite.prepare(`SELECT star_balance AS n FROM families WHERE id = 'fam_demo'`).get() as { n: number }).n;
}

function countCheckins(sqlite: DatabaseSync, taskId: string, localDate?: string): number {
  if (localDate) {
    return (sqlite.prepare(`SELECT COUNT(*) AS n FROM checkins WHERE task_id = ? AND local_date = ?`).get(taskId, localDate) as { n: number }).n;
  }
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM checkins WHERE task_id = ?`).get(taskId) as { n: number }).n;
}

function sumPoints(sqlite: DatabaseSync, taskId: string): number {
  return (sqlite.prepare(`SELECT COALESCE(SUM(points), 0) AS n FROM checkins WHERE task_id = ?`).get(taskId) as { n: number }).n;
}

function storedDates(sqlite: DatabaseSync, taskId: string): string[] {
  return (sqlite.prepare(`SELECT local_date FROM checkins WHERE task_id = ? ORDER BY created_at, id`).all(taskId) as { local_date: string }[]).map(
    (row) => row.local_date,
  );
}

function previousDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, status);
    return;
  }
  assert.fail(`expected HTTP ${status}`);
}

async function childCookie(env: Env): Promise<string> {
  const response = await app.fetch(
    new Request(`${ORIGIN}/api/auth/child`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ familyCode: 'STAR-4821' }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().find((item) => item.startsWith('ks_child_session='));
  assert.ok(cookie);
  return cookie.split(';')[0];
}

async function parentCookie(sqlite: DatabaseSync): Promise<string> {
  const token = `parent-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + PARENT_SESSION_SECONDS * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, family_id, parent_id, expires_at, created_at)
       VALUES (?, ?, 'parent', 'fam_demo', 'par_demo_1', ?, ?)`,
    )
    .run(crypto.randomUUID(), await sha256(`${SECRET}:${token}`), expires, now);
  return `${PARENT_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function grantPasskeyCount(sqlite: DatabaseSync): void {
  sqlite
    .prepare(
      `INSERT INTO parent_passkeys (id, parent_id, credential_id, public_key, sign_count, created_at)
       VALUES ('pk_count_only', 'par_demo_1', 'not-a-real-credential', 'not-a-real-key', 0, ?)`,
    )
    .run(new Date().toISOString());
}

function post(path: string, body: unknown, cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
}

function postPatch(path: string, body: unknown, cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
}
