import { router } from 'expo-router';
import { useState } from 'react';
import { AuthShell, isEmail } from '@/features/settings/AuthShell';
import { friendlyAuthError, useAuth } from '@/services/auth';
import { Button, TextField, Text } from '@/ui';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      const msg = friendlyAuthError(e);
      if (msg.startsWith('Please verify')) router.push({ pathname: '/(auth)/verify', params: { email } });
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      heading="Welcome back"
      footer={
        <>
          <Button label="Forgot password?" variant="ghost" onPress={() => router.push({ pathname: '/(auth)/forgot', params: { email } })} />
          <Button label="Create an account" variant="secondary" fullWidth onPress={() => router.push('/(auth)/sign-up')} />
        </>
      }
    >
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label="Sign in" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
