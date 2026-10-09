import { useState } from 'react';
import React from 'react';
import { Button, Card, TextField, tokens } from '@creche/design-system';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

/**
 * Comptes de démonstration de l'aperçu multi-rôles — affichés UNIQUEMENT
 * quand VITE_PREVIEW_DEMO=1 (positionné par `npm run preview:web`).
 * Miroir de `ACCOUNTS` dans scripts/dev-preview-api.mjs ; n'apparaît
 * jamais en production (variable absente au build).
 */
const DEMO_ACCOUNTS: ReadonlyArray<{ email: string; role: string }> = [
  { email: 'superadmin@demo.creche.dz', role: 'super_admin' },
  { email: 'nadia.benali@demo.creche.dz', role: 'director' },
  { email: 'amina.haddad@demo.creche.dz', role: 'educator' },
  { email: 'karim.boudiaf@demo.creche.dz', role: 'accountant' },
  { email: 'sara.meziane@demo.creche.dz', role: 'receptionist' },
];

const PREVIEW_DEMO = import.meta.env.VITE_PREVIEW_DEMO === '1';

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

        {PREVIEW_DEMO && (
          <div
            data-testid="preview-demo-accounts"
            style={{
              marginTop: tokens.spacing.md,
              paddingTop: tokens.spacing.md,
              borderTop: `1px solid ${tokens.colors.border}`,
            }}
          >
            <p
              style={{
                margin: `0 0 ${tokens.spacing.xs}px`,
                fontSize: tokens.typography.small,
                color: tokens.colors.textMuted,
              }}
            >
              {t('login.demoTitle')} — {t('login.demoHint')}
            </p>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.spacing.xs,
              }}
            >
              {DEMO_ACCOUNTS.map((acc) => (
                <li key={acc.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(acc.email);
                      setPassword('demo');
                      setError(null);
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: tokens.spacing.sm,
                      padding: `${tokens.spacing.xs}px ${tokens.spacing.sm}px`,
                      borderRadius: tokens.radius.sm,
                      border: `1px solid ${tokens.colors.border}`,
                      background: tokens.colors.surfaceAlt,
                      color: tokens.colors.text,
                      font: 'inherit',
                      fontSize: tokens.typography.small,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span dir="ltr">{acc.email}</span>
                    <span style={{ color: tokens.colors.primary, fontWeight: 600 }}>{acc.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
