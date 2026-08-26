import { useState } from 'react';
import React from 'react';
import { Button, Card, TextField, tokens } from '@creche/design-system';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, setTokens } from '../api/client';
import { http } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

export function AcceptInvitationPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { t } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!token) {
      setError('Lien d\'invitation invalide');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await http.post<{ access_token: string; refresh_token: string }>(
        '/auth/accept-invitation',
        { invitation_token: token, first_name: firstName, last_name: lastName, password },
      );
      setTokens(res.access_token, res.refresh_token);
      await login('', '').catch(() => undefined); // force reload du profil
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.messageFr : '');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tokens.colors.background }}>
      <Card title="Acceptation d'invitation" style={{ width: 360 }}>
        <form onSubmit={submit}>
          <TextField label="Prénom" value={firstName} onChange={setFirstName} required />
          <TextField label="Nom" value={lastName} onChange={setLastName} required />
          <TextField label={t('login.password')} value={password} onChange={setPassword} type="password" required dir="ltr" />
          {error && <p style={{ color: tokens.colors.danger, fontSize: tokens.typography.small }}>{error}</p>}
          <Button type="submit" disabled={busy} style={{ width: '100%' }}>Activer mon compte</Button>
        </form>
      </Card>
    </div>
  );
}
