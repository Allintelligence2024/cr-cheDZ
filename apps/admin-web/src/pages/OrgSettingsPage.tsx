import React from 'react';
import { useEffect, useState } from 'react';
import { Card, Table, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

interface Contract {
  id: string;
  child_id: string;
  monthly_base_amount: string;
  discount_percent: string;
  start_date: string;
  is_active: boolean;
}

/**
 * Paramètres de l'organisation (directrice).
 * L'exigence du décret 19-253 « affichage des prestations et tarifs » est
 * servie ici : les tarifs mensuels (contrats actifs) sont affichés.
 */
export function OrgSettingsPage(): React.JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const membership = user?.memberships?.[0];

  useEffect(() => {
    http
      .get<Contract[]>('/billing/contracts')
      .then(setContracts)
      .catch((e) => setError(e.messageFr));
  }, []);

  const active = contracts.filter((c) => c.is_active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('settings.title')}>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        <Table
          headers={[t('settings.name'), t('settings.slug'), t('settings.wilaya'), t('settings.establishment')]}
          rows={[[
            membership?.organization_name ?? t('settings.none'),
            membership?.organization_id ? membership.organization_id.slice(0, 8) : t('settings.none'),
            t('settings.none'),
            t('settings.none'),
          ]]}
        />
      </Card>

      <Card title={t('settings.tariffs')}>
        {active.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
        <Table
          headers={[t('common.child'), t('bill.monthlyBase'), 'Remise', t('bill.startDate')]}
          rows={active.map((c) => [
            c.child_id.slice(0, 8),
            `${Number(c.monthly_base_amount).toLocaleString('fr-FR')} DZD`,
            `${c.discount_percent ?? 0} %`,
            c.start_date,
          ])}
        />
        <p style={{ color: tokens.colors.textMuted, fontSize: 12, marginTop: tokens.spacing.md }}>
          {t('settings.settings')} : — (décret exécutif 19-253 — affichage obligatoire des prestations et tarifs)
        </p>
      </Card>
    </div>
  );
}
