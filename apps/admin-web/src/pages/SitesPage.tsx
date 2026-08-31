import { useEffect, useState } from 'react';
import React from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Site {
  id: string;
  name_fr: string;
  wilaya: string | null;
  authorized_capacity: number | null;
  is_active: boolean;
}

export function SitesPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Site[]>([]);
  const [name, setName] = useState('');
  const [wilaya, setWilaya] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<{ items: Site[] }>('/sites')
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError((e as { messageFr?: string }).messageFr ?? 'Erreur'));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await http.post('/sites', { name_fr: name, wilaya: wilaya || undefined });
      setName('');
      setWilaya('');
      load();
    } catch (err: unknown) {
      setError((err as { messageFr?: string }).messageFr ?? 'Erreur');
    }
  };

  return (
    <Card title={t('site.title')}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <TextField label={t('site.name')} value={name} onChange={setName} required />
        <TextField label={t('org.wilaya')} value={wilaya} onChange={setWilaya} dir="ltr" />
        <Button type="submit">{t('site.create')}</Button>
      </form>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      <Table
        headers={[t('common.name'), t('org.wilaya'), t('room.capacity'), t('invitation.status')]}
        rows={items.map((s) => [
          s.name_fr,
          s.wilaya ?? '—',
          s.authorized_capacity != null ? String(s.authorized_capacity) : '—',
          s.is_active ? t('invitation.joined') : '—',
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}
