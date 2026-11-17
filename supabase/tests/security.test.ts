import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { asUser, connect, createUser, expectError, push, randomUUID } from './support/db.ts';
import { fixtureChanges } from './support/fixtures.ts';

let client: pg.Client;
let alice: string;
let bob: string;
let aliceIds: Record<string, string>;

before(async () => {
  client = await connect();
  alice = await createUser(client);
  bob = await createUser(client);
  const { changes, ids } = fixtureChanges();
  aliceIds = ids;
  const results = await asUser(client, alice, (q) => push(q, changes));
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.deepEqual(rejected, [], 'fixture rows are valid');
});

after(async () => {
  await client.end();
});

test('guard: every public table has RLS, owner policies, and no anon access', async () => {
  const tables = await client.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`,
  );
  assert.ok(tables.rows.length >= 17, 'tables exist');
  for (const t of tables.rows) {
    assert.equal(t.relrowsecurity, true, `${t.relname} has RLS enabled`);
    const policies = await client.query(
      `select cmd from pg_policies where schemaname = 'public' and tablename = $1`,
      [t.relname],
    );
    const cmds = policies.rows.map((p) => p.cmd).sort();
    assert.deepEqual(cmds, ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], `${t.relname} has owner policies`);
    const anon = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = $1 and grantee = 'anon'`,
      [t.relname],
    );
    assert.equal(anon.rows.length, 0, `${t.relname}: anon has no privileges`);
  }
});

test('guard: anon cannot execute any public function', async () => {
  const fns = await client.query<{ proname: string; can: boolean }>(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as can
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
  );
  for (const f of fns.rows) assert.equal(f.can, false, `anon cannot execute ${f.proname}`);
  await expectError(asUser(client, null, (q) => q(`select public.sync_pull('{}'::jsonb)`)), '42501');
});

test('isolation: another user sees, changes and deletes nothing, on every table', async () => {
  for (const [table, id] of Object.entries(aliceIds)) {
    const seen = await asUser(client, bob, (q) =>
      q(`select count(*)::int as n from public.${table} where id = $1 or user_id = $2`, [id, alice]),
    );
    assert.equal(seen.rows[0].n, 0, `${table}: bob sees none of alice's rows`);
    const upd = await asUser(client, bob, (q) => q(`update public.${table} set deleted_at = now() where id = $1`, [id]));
    assert.equal(upd.rowCount, 0, `${table}: bob cannot update`);
    const del = await asUser(client, bob, (q) => q(`delete from public.${table} where id = $1`, [id]));
    assert.equal(del.rowCount, 0, `${table}: bob cannot delete`);
    const mine = await asUser(client, alice, (q) => q(`select deleted_at from public.${table} where id = $1`, [id]));
    assert.equal(mine.rows[0]?.deleted_at, null, `${table}: alice's row untouched`);
  }
  // Bob also sees none of Alice's automatically created profile, preferences or categories.
  for (const table of ['profiles', 'user_preferences', 'categories']) {
    const r = await asUser(client, bob, (q) => q(`select count(*)::int as n from public.${table} where user_id = $1`, [alice]));
    assert.equal(r.rows[0].n, 0, `${table}: hidden`);
  }
});

test('isolation through sync: pulls return only your rows; pushing over a foreign id is rejected', async () => {
  const pulled = await asUser(client, bob, (q) => q(`select public.sync_pull('{}'::jsonb) as r`));
  for (const [table, page] of Object.entries(pulled.rows[0].r.tables as Record<string, { rows: { user_id: string }[] }>)) {
    for (const row of page.rows) assert.equal(row.user_id, bob, `${table}: only bob's rows`);
  }
  const results = await asUser(client, bob, (q) =>
    push(q, [{ table: 'goals', id: aliceIds.goals, op: 'upsert', patch: { title: 'Hijacked', rank: 'a0' } }]),
  );
  assert.equal(results[0]!.status, 'rejected');
  const title = await asUser(client, alice, (q) => q('select title from public.goals where id = $1', [aliceIds.goals]));
  assert.equal(title.rows[0].title, 'Improve Economics results');
});

test('ownership foreign keys: you cannot link to another user’s rows, even with a valid id', async () => {
  const results = await asUser(client, bob, (q) =>
    push(q, [
      { table: 'tasks', id: randomUUID(), op: 'upsert', patch: { title: 'Sneaky', rank: 'a0', goal_id: aliceIds.goals } },
      { table: 'habit_logs', id: randomUUID(), op: 'upsert', patch: { habit_id: aliceIds.habits, log_date: '2026-11-17' } },
      { table: 'goals', id: randomUUID(), op: 'upsert', patch: { title: 'Mine', rank: 'a0', category_id: aliceIds.categories } },
    ]),
  );
  for (const r of results) {
    assert.equal(r.status, 'rejected');
    assert.equal(r.code, '23503', 'foreign key violation');
  }
});

test('spoofing and identity changes are refused', async () => {
  await expectError(
    asUser(client, bob, (q) => q(`insert into public.goals (user_id, title, rank) values ($1, 'x', 'a0')`, [alice])),
    '42501',
  );
  await expectError(
    asUser(client, alice, (q) => q(`update public.goals set user_id = $1 where id = $2`, [bob, aliceIds.goals])),
  );
  // Pushing a user_id is ignored: the row is created for the caller.
  const id = randomUUID();
  const r = await asUser(client, bob, (q) => push(q, [{ table: 'goals', id, op: 'upsert', patch: { title: 'Bob goal', rank: 'a0', user_id: alice } }]));
  assert.equal(r[0]!.status, 'applied');
  assert.equal(r[0]!.row!.user_id, bob);
});

test('deleting a parent unlinks children and keeps their ownership', async () => {
  const goal = randomUUID();
  const task = randomUUID();
  await asUser(client, alice, (q) =>
    push(q, [
      { table: 'goals', id: goal, op: 'upsert', patch: { title: 'Temporary', rank: 'a5' } },
      { table: 'tasks', id: task, op: 'upsert', patch: { title: 'Linked', rank: 'a5', goal_id: goal } },
    ]),
  );
  await asUser(client, alice, (q) => q('delete from public.goals where id = $1', [goal]));
  const r = await asUser(client, alice, (q) => q('select user_id, goal_id from public.tasks where id = $1', [task]));
  assert.equal(r.rows[0].user_id, alice);
  assert.equal(r.rows[0].goal_id, null);
});
