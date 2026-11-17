import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthSyncError, TransientSyncError, type Cursor, type PullResponse, type PushChange, type PushResult, type SyncTransport } from './engine.ts';

function classify(error: { message: string; code?: string; status?: number }): Error {
  const code = error.code ?? '';
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303' || error.status === 401) {
    return new AuthSyncError('Your session has expired. Please sign in again.');
  }
  // No Postgres SQLSTATE means the request never reached the database (offline, timeout, gateway).
  if (!/^[0-9A-Z]{5}$/.test(code) || code.startsWith('08') || code.startsWith('57') || code.startsWith('53')) {
    return new TransientSyncError(error.message || 'Network unavailable');
  }
  return new Error(`${code}: ${error.message}`);
}

export class SupabaseTransport implements SyncTransport {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async push(changes: PushChange[]): Promise<PushResult[]> {
    try {
      const { data, error } = await this.client.rpc('sync_push', { changes });
      if (error) throw classify(error);
      return data as PushResult[];
    } catch (err) {
      if (err instanceof AuthSyncError || err instanceof TransientSyncError) throw err;
      throw new TransientSyncError(err instanceof Error ? err.message : String(err));
    }
  }

  async pull(cursors: Record<string, Cursor>, maxRows: number): Promise<PullResponse> {
    try {
      const { data, error } = await this.client.rpc('sync_pull', { cursors, max_rows: maxRows });
      if (error) throw classify(error);
      return data as PullResponse;
    } catch (err) {
      if (err instanceof AuthSyncError || err instanceof TransientSyncError) throw err;
      throw new TransientSyncError(err instanceof Error ? err.message : String(err));
    }
  }
}
