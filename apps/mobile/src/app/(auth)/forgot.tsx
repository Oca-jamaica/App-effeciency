import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AuthShell, isEmail } from '@/features/settings/AuthShell';
import { friendlyAuthError, useAuth } from '@/services/auth';
import { Button, Text, TextField } from '@/ui';

export default function Forgot() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      router.replace({ pathname: '/(auth)/reset', params: { email } });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell heading="Reset your password" body="We’ll email you a code to set a new password." footer={<Button label="Back" variant="ghost" onPress={() => router.back()} />}>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      {error ? (
        <Text variant="callout" tone="danger">
          {error}
        </Text>
      ) : null}
      <Button label="Send code" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
