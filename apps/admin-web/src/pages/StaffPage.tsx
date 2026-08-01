import { useEffect, useState } from 'react';
import React from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Staff {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  qualification: string;
  contract_type: string;
  hire_date: string;
  is_active: boolean;
  active_assignments: number;
}

export function StaffPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Staff[]>([]);
  const [userId, setUserId] = useState('');
  const [qualification, setQualification] = useState('educator_qualified');
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<{ items: Staff[] }>('/staff')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.messageFr));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await http.post('/staff', { user_id: userId, qualification, hire_date: hireDate });
      setUserId('');
      load();
    } catch (err: any) {
      setError(err.messageFr);
    }
  };

  const qualifications = [
    ['educator_qualified', 'Éducatrice qualifiée'],
    ['director', 'Directrice'],
    ['nurse', 'Infirmière'],
    ['admin', 'Administratif'],
    ['other', 'Autre'],
  ];

  return (
    <Card title={t('staff.title')}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <TextField label={t('staff.user')} value={userId} onChange={setUserId} required dir="ltr" />
        <label style={{ fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>
          {t('staff.qualification')}
          <select
            value={qualification}
            onChange={(e) => setQualification(e.target.value)}
            style={{ display: 'block', padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.colors.border}`, marginTop: 4 }}
          >
            {qualifications.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <TextField label={t('staff.hireDate')} value={hireDate} onChange={setHireDate} type="date" dir="ltr" />
        <Button type="submit">{t('staff.create')}</Button>
      </form>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      <Table
        headers={['Nom', 'Email', t('staff.qualification'), 'Contrat', t('staff.hireDate'), 'Affect.' ]}
        rows={items.map((s) => [
          `${s.first_name} ${s.last_name}`,
          s.email,
          s.qualification,
          s.contract_type,
          s.hire_date,
          String(s.active_assignments),
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}
