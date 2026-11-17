import type { Session } from '@supabase/supabase-js';
import * as Localization from 'expo-localization';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

export interface AuthApi {
  session: Session | null;
  initializing: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string | null): Promise<{ needsVerification: boolean }>;
  verifySignUp(email: string, code: string): Promise<void>;
  resendSignUp(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Verifies the emailed recovery code (signing the user in) and sets the new password. */
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

/** Maps Supabase's error messages to plain language the user can act on. */
export function friendlyAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That email and password don’t match. Check them and try again.';
  if (m.includes('email not confirmed')) return 'Please verify your email first. We sent you a code when you signed up.';
  if (m.includes('user already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('token has expired') || m.includes('otp') || m.includes('invalid token')) return 'That code is invalid or has expired. Request a new one.';
  if (m.includes('password should be') || m.includes('weak password')) return 'Choose a stronger password: at least 8 characters, mixing letters and numbers.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('network') || m.includes('fetch')) return 'You appear to be offline. Check your connection and try again.';
  return message;
}

function requireClient() {
  if (!supabase) throw new Error('ASCEND is not connected to a server yet.');
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => active && setInitializing(false));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      session,
      initializing,
      async signIn(email, password) {
        const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      async signUp(email, password, displayName) {
        const timezone = Localization.getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { data, error } = await requireClient().auth.signUp({
          email: email.trim(),
          password,
          options: { data: { timezone, display_name: displayName?.trim() || null } },
        });
        if (error) throw error;
        return { needsVerification: !data.session };
      },
      async verifySignUp(email, code) {
        const { error } = await requireClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' });
        if (error) throw error;
      },
      async resendSignUp(email) {
        const { error } = await requireClient().auth.resend({ type: 'signup', email: email.trim() });
        if (error) throw error;
      },
      async requestPasswordReset(email) {
        const { error } = await requireClient().auth.resetPasswordForEmail(email.trim());
        if (error) throw error;
      },
      async resetPassword(email, code, newPassword) {
        const client = requireClient();
        const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
        if (error) throw error;
        const { error: updateError } = await client.auth.updateUser({ password: newPassword });
        if (updateError) throw updateError;
      },
      async updatePassword(newPassword) {
        const { error } = await requireClient().auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
      async signOut() {
        await requireClient().auth.signOut();
      },
    }),
    [session, initializing],
  );
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth must be used inside AuthProvider');
  return a;
}
