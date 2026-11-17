import pg from 'pg';
import { randomUUID } from 'node:crypto';

export type Query = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

export async function connect(): Promise<pg.Client> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set; run tests through supabase/tests/run.mjs');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Creates an auth user as the platform would (the signup trigger provisions profile, prefs, categories). */
export async function createUser(client: pg.Client, meta: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await client.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    `${id}@test.local`,
    JSON.stringify(meta),
  ]);
  return id;
}

/** Runs `fn` in a transaction as the given user through the `authenticated` role, like PostgREST does. */
export async function asUser<T>(client: pg.Client, userId: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    if (userId) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);
    }
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

/** Expects `fn` to fail with the given SQLSTATE (or any error when omitted). */
export async function expectError(promise: Promise<unknown>, code?: string): Promise<pg.DatabaseError> {
  try {
    await promise;
  } catch (err) {
    const e = err as pg.DatabaseError;
    if (code && e.code !== code) throw new Error(`Expected SQLSTATE ${code}, got ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error(`Expected an error${code ? ` with SQLSTATE ${code}` : ''}, but the query succeeded`);
}

export interface PushResult {
  id: string;
  status: 'applied' | 'merged' | 'remapped' | 'gone' | 'rejected';
  row?: Record<string, unknown>;
  new_id?: string;
  code?: string;
  message?: string;
}

export async function push(q: Query, changes: unknown[]): Promise<PushResult[]> {
  const r = await q('select public.sync_push($1::jsonb) as r', [JSON.stringify(changes)]);
  return r.rows[0].r as PushResult[];
}

export { randomUUID };
