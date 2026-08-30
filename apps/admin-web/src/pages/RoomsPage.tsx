import { useEffect, useState } from 'react';
import React from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Room {
  id: string;
  site_id: string;
  name_fr: string;
  min_age_months: number;
  max_age_months: number;
  max_capacity: number;
  is_active: boolean;
}

export function RoomsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Room[]>([]);
  const [sites, setSites] = useState<Array<{ id: string; name_fr: string }>>([]);
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [capacity, setCapacity] = useState('12');
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<{ items: Room[] }>('/rooms')
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError((e as { messageFr?: string }).messageFr ?? 'Erreur'));
    http
      .get<{ items: Array<{ id: string; name_fr: string }> }>('/sites')
      .then((r) => {
        setSites(r.items);
        if (r.items.length > 0 && !siteId) setSiteId(r.items[0].id);
      })
      .catch(() => undefined);
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await http.post('/rooms', {
        name_fr: name,
        site_id: siteId,
        max_capacity: Number(capacity),
      });
      setName('');
      load();
    } catch (err: unknown) {
      setError((err as { messageFr?: string }).messageFr ?? 'Erreur');
    }
  };

  return (
    <Card title={t('room.title')}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <TextField label={t('room.name')} value={name} onChange={setName} required />
        <label style={{ fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>
          {t('room.site')}
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            style={{ display: 'block', padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.colors.border}`, marginTop: 4 }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_fr}
              </option>
            ))}
          </select>
        </label>
        <TextField label={t('room.capacity')} value={capacity} onChange={setCapacity} type="number" dir="ltr" />
        <Button type="submit">{t('room.create')}</Button>
      </form>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      <Table
        headers={[t('common.name'), t('room.site'), 'Âges (mois)', t('room.capacity'), t('invitation.status')]}
        rows={items.map((r) => [
          r.name_fr,
          sites.find((s) => s.id === r.site_id)?.name_fr ?? r.site_id.slice(0, 8),
          `${r.min_age_months}–${r.max_age_months}`,
          String(r.max_capacity),
          r.is_active ? t('invitation.joined') : '—',
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}
