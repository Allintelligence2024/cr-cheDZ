import { useEffect, useState } from 'react';
import React from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Org {
  id: string;
  slug: string;
  name_fr: string;
  wilaya: string;
  establishment_type: string;
  max_children: number;
  is_active: boolean;
}

export function OrganizationsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Org[]>([]);
  const [slug, setSlug] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [wilaya, setWilaya] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<{ items: Org[] }>('/organizations')
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(e.messageFr));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await http.post('/organizations', { slug, name_fr: nameFr, wilaya });
      setSlug('');
      setNameFr('');
      setWilaya('');
      load();
    } catch (err: unknown) {
      setError(err.messageFr);
    }
  };

  return (
    <Card title={t('org.title')}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <TextField label={t('org.slug')} value={slug} onChange={setSlug} required dir="ltr" />
        <TextField label={t('org.name_fr')} value={nameFr} onChange={setNameFr} required />
        <TextField label={t('org.wilaya')} value={wilaya} onChange={setWilaya} required dir="ltr" />
        <Button type="submit">{t('org.create')}</Button>
      </form>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      <Table
        headers={[t('org.slug'), t('org.name_fr'), t('org.wilaya'), 'Type', t('room.capacity')]}
        rows={items.map((o) => [
          o.slug,
          o.name_fr,
          o.wilaya,
          o.establishment_type,
          String(o.max_children),
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('org.none')}</p>}
    </Card>
  );
}
