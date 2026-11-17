import { router } from 'expo-router';
import { useState } from 'react';
import { AuthShell, isEmail, passwordProblem } from '@/features/settings/AuthShell';
import { friendlyAuthError, useAuth } from '@/services/auth';
import { Button, Text, TextField } from '@/ui';

export default function SignUp() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!isEmail(email)) e.email = 'Enter a valid email address.';
    const pw = passwordProblem(password);
    if (pw) e.password = pw;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { needsVerification } = await signUp(email, password, name || null);
      if (needsVerification) router.replace({ pathname: '/(auth)/verify', params: { email } });
    } catch (err) {
      setErrors({ form: friendlyAuthError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      heading="Create your account"
      body="Only your email is required. Your data is private to you and syncs across your devices."
      footer={<Button label="I already have an account" variant="ghost" onPress={() => router.back()} />}
    >
      <TextField label="Name (optional)" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={80} />
      <TextField label="Email" value={email} onChangeText={setEmail} error={errors.email} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField label="Password" value={password} onChangeText={setPassword} error={errors.password} hint="At least 8 characters, with letters and numbers." secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      {errors.form ? (
        <Text variant="callout" tone="danger">
          {errors.form}
        </Text>
      ) : null}
      <Button label="Create account" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
