import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { requireSupabase } from '@/services/supabase';
import { openDeviceDb } from './expoDriver';
import { migrateLocalSchema } from './localSchema';
import { Store } from './store';
import { SyncEngine, type SyncStatus } from './sync/engine';
import { SupabaseTransport } from './sync/supabaseTransport';

interface DataContextValue {
  store: Store;
  engine: SyncEngine;
  status: SyncStatus;
  syncNow: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

const SYNC_DEBOUNCE_MS = 1500;
const SYNC_INTERVAL_MS = 60_000;

/**
 * Opens this user's own on-device database (one file per account), keeps it in sync with the server,
 * and makes the store available to every screen.
 */
export function DataProvider({ userId, children, fallback, onAuthExpired }: { userId: string; children: ReactNode; fallback: ReactNode; onAuthExpired: () => void }) {
  const [value, setValue] = useState<DataContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ phase: 'idle', pending: 0, lastSyncedAt: null, lastError: null, conflicts: 0 });
  const expiredRef = useRef(onAuthExpired);
  expiredRef.current = onAuthExpired;

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const db = await openDeviceDb(`ascend-${userId}.db`);
        await migrateLocalSchema(db);
        const store = new Store({ db, userId, newId: () => Crypto.randomUUID() });
        const engine = new SyncEngine(store, new SupabaseTransport(requireSupabase()));
        if (cancelled) return;

        const syncNow = async () => {
          try {
            await engine.sync();
          } catch {
            expiredRef.current();
          }
        };
        let debounce: ReturnType<typeof setTimeout> | null = null;
        const unsubOutbox = store.onOutboxChange(() => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
        });
        const unsubStatus = engine.onStatus(setStatus);
        const interval = setInterval(() => {
          if (AppState.currentState === 'active') void syncNow();
        }, SYNC_INTERVAL_MS);
        const appSub = AppState.addEventListener('change', (s) => {
          if (s === 'active') void syncNow();
        });
        const netSub = Network.addNetworkStateListener((s) => {
          if (s.isInternetReachable) void syncNow();
        });
        cleanup = () => {
          unsubOutbox();
          unsubStatus();
          clearInterval(interval);
          appSub.remove();
          netSub.remove();
          if (debounce) clearTimeout(debounce);
        };
        await engine.refreshCounts();
        setValue({ store, engine, status: engine.getStatus(), syncNow });
        void syncNow();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [userId]);

  if (error) throw new Error(`Could not open your data on this device: ${error}`);
  if (!value) return <>{fallback}</>;
  return <DataContext.Provider value={{ ...value, status }}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const v = useContext(DataContext);
  if (!v) throw new Error('useData must be used inside DataProvider');
  return v;
}

export function useStore(): Store {
  return useData().store;
}

export interface LiveResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `load` against the local store and re-runs it whenever one of `tables` changes (local writes
 * and synced changes alike). Results are never stale: out-of-order responses are discarded.
 */
export function useLive<T>(load: (store: Store) => Promise<T>, deps: readonly unknown[], tables: readonly string[]): LiveResult<T> {
  const store = useStore();
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const request = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(() => {
    const id = ++request.current;
    loadRef
      .current(store)
      .then((data) => {
        if (id === request.current) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (id === request.current) setState((s) => ({ ...s, error: error instanceof Error ? error : new Error(String(error)), loading: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);

  useEffect(() => {
    run();
    return store.subscribe(tables, run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, store, tables.join(',')]);

  return { ...state, reload: run };
}
