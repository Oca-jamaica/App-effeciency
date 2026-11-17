import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AuthShell, passwordProblem } from '@/features/settings/AuthShell';
import { friendlyAuthError, useAuth } from '@/services/auth';
import { Button, Text, TextField } from '@/ui';

export default function Reset() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const { resetPassword } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!/^\d{6,8}$/.test(code.trim())) e.code = 'Enter the code from the email.';
    const pw = passwordProblem(password);
    if (pw) e.password = pw;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await resetPassword(email, code, password);
    } catch (err) {
      setErrors({ form: friendlyAuthError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell heading="Choose a new password" body={`Enter the code we sent to ${email}.`} footer={<Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/(auth)')} />}>
      <TextField label="Code" value={code} onChangeText={setCode} error={errors.code} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} />
      <TextField label="New password" value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      {errors.form ? (
        <Text variant="callout" tone="danger">
          {errors.form}
        </Text>
      ) : null}
      <Button label="Save and sign in" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
