import { generateKeyBetween } from 'fractional-indexing';
import type { Store } from './store.ts';
import type { SyncedTableName } from '@ascend/domain';

/** Rank key that sorts after every live row matching `where` (append to the end of a list). */
export async function rankAtEnd(store: Pick<Store, 'query'>, table: SyncedTableName, where = '1=1', params: (string | number | null)[] = []): Promise<string> {
  const rows = await store.query<{ rank: string }>(
    `SELECT rank FROM "${table}" WHERE deleted_at IS NULL AND (${where}) ORDER BY rank COLLATE BINARY DESC LIMIT 1`,
    params,
  );
  return generateKeyBetween(rows[0]?.rank ?? null, null);
}

/** Rank between two neighbours after a drag-and-drop move (either neighbour may be null). */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before, after);
}
