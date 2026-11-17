import { SYNCED_TABLES } from '@ascend/domain';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Store } from '@/data/store';
import { requireSupabase } from '@/services/supabase';

/**
 * Exports everything this account has stored, as one JSON file the user can save or send anywhere.
 * Built from the on-device copy, so it works offline; unsynced changes are included.
 */
export async function exportAllData(store: Store): Promise<void> {
  const tables: Record<string, unknown[]> = {};
  for (const t of SYNCED_TABLES) tables[t.name] = await store.list(t.name as never, { includeDeleted: false });
  const payload = {
    format: 'ascend-export',
    version: 1,
    exported_at: new Date().toISOString(),
    user_id: store.userId,
    tables,
  };
  const file = new File(Paths.cache, `ascend-export-${new Date().toISOString().slice(0, 10)}.json`);
  await file.write(JSON.stringify(payload, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export your ASCEND data', UTI: 'public.json' });
}

/**
 * Permanently deletes the account on the server (after re-checking the password), then signs out.
 * The server function removes all stored files and the auth user; every table cascades.
 */
export async function deleteAccount(email: string, password: string): Promise<void> {
  const client = requireSupabase();
  const { error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error('That password is not correct.');
  const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw new Error(`Your account could not be deleted: ${error.message}`);
  await client.auth.signOut();
}
