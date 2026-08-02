import React from 'react';
import { useEffect, useState } from 'react';
import { Card, tokens } from '@creche/design-system';
import { useI18n } from '../i18n';

interface Listing {
  slug: string;
  name_fr: string;
  public_name: string | null;
  public_description: string | null;
  wilaya: string;
  commune: string | null;
  address_line1: string | null;
  public_phone: string | null;
  public_email: string | null;
  establishment_type: string;
}

/** Annuaire public des crèches (flag marketplace, opt-in des organisations). */
export function MarketplacePage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Listing[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/marketplace')
      .then((r) => r.json())
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch(() => setError(t('common.error')));
  }, [t]);

  const typeLabel = (type: string): string => {
    switch (type) {
      case 'creche': return t('marketplace.creche');
      case 'multi_accueil': return t('marketplace.multi');
      case 'jardin': return t('marketplace.jardin');
      default: return type;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('marketplace.title')}>
        <p style={{ color: tokens.colors.textMuted, marginTop: 0 }}>{t('marketplace.hint')}</p>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
        <div className="grid-responsive">
          {items.map((c) => (
            <div key={c.slug} style={{ border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.md, padding: tokens.spacing.md }}>
              <h3 style={{ margin: '0 0 6px' }}>{c.public_name ?? c.name_fr}</h3>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: tokens.colors.textMuted }}>
                {typeLabel(c.establishment_type)} · Wilaya {c.wilaya}{c.commune ? `, ${c.commune}` : ''}
              </p>
              {c.public_description && <p style={{ fontSize: 13, margin: '0 0 8px' }}>{c.public_description}</p>}
              <p style={{ margin: 0, fontSize: 12, color: tokens.colors.textMuted }}>
                {c.address_line1 ?? ''}
                {c.public_phone ? ` · ${c.public_phone}` : ''}
                {c.public_email ? ` · ${c.public_email}` : ''}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
