import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1Prepared, D1Result } from './d1.ts';

export const SECRET = 'test-session-secret-value';
export const ORIGIN = 'https://kid.example';
export const RP_ID = 'kid.example';

export function createDb(extra: Partial<Env> = {}): { env: Env; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001_schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0002_seed_demo.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0003_passkeys.sql', import.meta.url), 'utf8'));
  const env = {
    DB: new SqliteD1(sqlite),
    SESSION_SECRET: SECRET,
    WEBAUTHN_RP_ID: RP_ID,
    WEBAUTHN_ORIGIN: ORIGIN,
    APP_ORIGIN: ORIGIN,
    ...extra,
  } as Env;
  return { env, sqlite };
}

export class SqliteD1 implements D1Database {
  sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(query: string): D1Prepared {
    const statement = this.sqlite.prepare(query);
    let params: unknown[] = [];
    const prepared: D1Prepared = {
      bind(...values: unknown[]) {
        params = values;
        return prepared;
      },
      async first<T>() {
        const row = statement.get(...(params as Array<string | number | null>)) as T | undefined;
        return row ?? null;
      },
      async all<T>() {
        return { results: statement.all(...(params as Array<string | number | null>)) as T[] };
      },
      async run() {
        const result = statement.run(...(params as Array<string | number | null>));
        return { meta: { changes: Number(result.changes ?? 0) } };
      },
    };
    return prepared;
  }

  async batch(statements: D1Prepared[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}
