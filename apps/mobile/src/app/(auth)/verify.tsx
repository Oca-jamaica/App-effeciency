import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AuthShell } from '@/features/settings/AuthShell';
import { friendlyAuthError, useAuth } from '@/services/auth';
import { Button, Text, TextField, useToast } from '@/ui';

export default function Verify() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const { verifySignUp, resendSignUp } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\d{6,8}$/.test(code.trim())) return setError('Enter the code from the email.');
    setBusy(true);
    setError(null);
    try {
      await verifySignUp(email, code);
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      heading="Check your email"
      body={`We sent a code to ${email}. Enter it to finish creating your account.`}
      footer={
        <>
          <Button
            label="Send a new code"
            variant="ghost"
            onPress={async () => {
              try {
                await resendSignUp(email);
                toast.show('A new code is on its way');
              } catch (e) {
                toast.show(friendlyAuthError(e), { kind: 'error' });
              }
            }}
          />
          <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/(auth)')} />
        </>
      }
    >
      <TextField label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8} />
      {error ? (
        <Text variant="callout" tone="danger">
          {error}
        </Text>
      ) : null}
      <Button label="Verify" onPress={submit} loading={busy} fullWidth />
    </AuthShell>
  );
}
