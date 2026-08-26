import { useEffect, useState } from 'react';
import React from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { ApiError, http } from '../api/client';
import { useI18n } from '../i18n';

interface Member {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_slug: string;
  role_name: string;
  joined_at: string | null;
}

const ROLES = [
  ['director', 'Directrice'],
  ['educator', 'Éducatrice'],
  ['accountant', 'Comptable'],
  ['receptionist', 'Réception'],
  ['parent_primary', 'Parent Principal'],
  ['parent_secondary', 'Parent Secondaire'],
];

export function InvitationsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('educator');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<{ items: Member[] }>('/invitations')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.messageFr));
  };
  useEffect(load, []);

  const invite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLink(null);
    try {
      const res = await http.post<{ invitation_token: string; status: string }>('/invitations', {
        email,
        role_slug: role,
      });
      if (res.status === 'invited') {
        // Dev uniquement : en production, le lien part par email.
        const url = `${window.location.origin}/accept-invitation?token=${res.invitation_token}`;
        setLink(url);
      }
      setEmail('');
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.messageFr : '');
    }
  };

  return (
    <Card title={t('invitation.title')}>
      <form onSubmit={invite} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <TextField label={t('invitation.email')} value={email} onChange={setEmail} type="email" required dir="ltr" />
        <label style={{ fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>
          {t('invitation.role')}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ display: 'block', padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.colors.border}`, marginTop: 4 }}
          >
            {ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">{t('invitation.create')}</Button>
      </form>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {link && (
        <p style={{ fontSize: tokens.typography.small, wordBreak: 'break-all', background: '#F1F5F9', padding: 8, borderRadius: 6 }}>
          🔗 {link}
        </p>
      )}
      <Table
        headers={['Nom', t('invitation.email'), t('invitation.role'), t('invitation.status')]}
        rows={items.map((m) => [
          `${m.first_name} ${m.last_name}`.trim(),
          m.email,
          m.role_name,
          m.joined_at ? t('invitation.joined') : t('invitation.invited'),
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}
