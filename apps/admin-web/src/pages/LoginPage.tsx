import { useState } from 'react';
import React from 'react';
import { Button, Card, TextField, tokens } from '@creche/design-system';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

export function LoginPage(): React.JSX.Element {
  const { login } = useAuth();
  const { t, dir } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email || !password) {
      setError(t('login.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch {
      setError(t('login.error'));
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: tokens.colors.background,
      }}
    >
      <Card title={t('login.title')} style={{ width: 360 }}>
        <form onSubmit={submit} dir={dir}>
          <TextField label={t('login.email')} value={email} onChange={setEmail} type="email" required dir="ltr" />
          <TextField label={t('login.password')} value={password} onChange={setPassword} type="password" required dir="ltr" />
          {error && (
            <p style={{ color: tokens.colors.danger, fontSize: tokens.typography.small }}>{error}</p>
          )}
          <Button type="submit" disabled={busy} style={{ width: '100%' }}>
            {t('login.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
