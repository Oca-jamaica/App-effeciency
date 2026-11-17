import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Screen, Text, space } from '@/ui';

/** Shared frame for the sign-in flow: a quiet wordmark, a heading, and the form. */
export function AuthShell({ heading, body, children, footer }: { heading: string; body?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Screen keyboard contentStyle={{ paddingTop: space.huge, gap: space.xxl }}>
      <View style={{ gap: space.xs }}>
        <Text variant="label" tone="accent" style={{ letterSpacing: 3 }}>
          ASCEND
        </Text>
        <Text variant="caption" tone="tertiary">
          Become more. Every day.
        </Text>
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="title" accessibilityRole="header">
          {heading}
        </Text>
        {body ? (
          <Text variant="body" tone="secondary">
            {body}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: space.lg }}>{children}</View>
      {footer ? <View style={{ gap: space.md, alignItems: 'center' }}>{footer}</View> : null}
    </Screen>
  );
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'Use at least 8 characters.';
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'Mix letters and numbers.';
  return null;
}
