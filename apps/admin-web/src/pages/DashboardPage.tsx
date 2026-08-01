import { Card, tokens } from '@creche/design-system';
import React from 'react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

export function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();
  const { t } = useI18n();
  const membership = user?.memberships?.[0];

  return (
    <Card title={`${t('dashboard.welcome')} ${user?.first_name ?? ''} ${user?.last_name ?? ''}`}>
      <p>
        {t('dashboard.role')} : <strong>{membership?.role_name ?? (user?.is_super_admin ? 'Super Admin' : '—')}</strong>
      </p>
      <p>
        {t('dashboard.org')} : <strong>{membership?.organization_name ?? '—'}</strong>
      </p>
      <p style={{ color: tokens.colors.textMuted }}>{t('dashboard.hint')}</p>
    </Card>
  );
}
