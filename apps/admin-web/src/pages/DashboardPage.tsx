import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface RoomSummary {
  room_id: string;
  room_name: string;
  site_name: string;
  total_children: number;
  present: number;
  departed: number;
  absent: number;
  expected: number;
}

interface DashboardSummary {
  date: string;
  rooms: RoomSummary[];
  alerts: {
    children_not_checked_in: Array<Record<string, unknown>>;
    documents_expiring: Array<Record<string, unknown>>;
    unpaid_invoices: Array<Record<string, unknown>>;
    recent_incidents: Array<Record<string, unknown>>;
  };
}

const statStyle = (color: string): React.CSSProperties => ({
  fontSize: 22,
  fontWeight: 700,
  color,
});

export function DashboardPage(): React.JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<DashboardSummary>('/dashboard/summary')
      .then(setData)
      .catch((e) => setError(e.messageFr));
  };
  useEffect(load, []);

  const fmt = (n: unknown): string => String(n ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={`${t('dash.today')} — ${data?.date ?? ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.spacing.md }}>
          <Button variant="ghost" onClick={load}>{t('common.refresh')}</Button>
        </div>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {data && data.rooms.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('dash.noRooms')}</p>}
        <div className="grid-responsive">
          {data?.rooms.map((room) => (
            <div key={room.room_id} style={{ border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.md, padding: tokens.spacing.md }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {room.room_name}
                <span style={{ color: tokens.colors.textMuted, fontWeight: 400, fontSize: 12 }}> · {room.site_name}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <span>{t('dash.present')} <span style={statStyle('#16A34A')}>{fmt(room.present)}</span></span>
                <span>{t('dash.expected')} <span style={statStyle('#F59E0B')}>{fmt(room.expected)}</span></span>
                <span>{t('dash.departed')} <span style={statStyle('#3B82F6')}>{fmt(room.departed)}</span></span>
                <span>{t('dash.absent')} <span style={statStyle('#EF4444')}>{fmt(room.absent)}</span></span>
              </div>
              <div style={{ borderTop: `1px solid ${tokens.colors.border}`, marginTop: 8, paddingTop: 8, color: tokens.colors.textMuted, fontSize: 13 }}>
                {t('common.total')} : {fmt(room.total_children)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t('dash.alerts')}>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('dash.notChecked')} ({data.alerts.children_not_checked_in.length})</h3>
              {data.alerts.children_not_checked_in.length === 0 && <p style={{ color: tokens.colors.textMuted, margin: 0 }}>{t('dash.noAlerts')}</p>}
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {data.alerts.children_not_checked_in.map((c) => (
                  <li key={String(c.id)}>{String(c.first_name_fr)} {String(c.last_name_fr)} — {String(c.room_name)}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('dash.documents')} ({data.alerts.documents_expiring.length})</h3>
              {data.alerts.documents_expiring.length === 0 && <p style={{ color: tokens.colors.textMuted, margin: 0 }}>{t('dash.noAlerts')}</p>}
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {data.alerts.documents_expiring.map((d) => (
                  <li key={String(d.id)}>{String(d.first_name)} {String(d.last_name)} — {String(d.document_type)} ({t('dash.expires')} {String(d.expiry_date).slice(0, 10)})</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('dash.invoices')} ({data.alerts.unpaid_invoices.length})</h3>
              {data.alerts.unpaid_invoices.length === 0 && <p style={{ color: tokens.colors.textMuted, margin: 0 }}>{t('dash.noAlerts')}</p>}
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {data.alerts.unpaid_invoices.map((i) => (
                  <li key={String(i.id)}>
                    {String(i.invoice_number)} — {String(i.first_name_fr)} {String(i.last_name_fr)} — {String(i.balance)} DZD ({t('dash.due')} {String(i.due_date).slice(0, 10)})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('dash.incidents')} ({data.alerts.recent_incidents.length})</h3>
              {data.alerts.recent_incidents.length === 0 && <p style={{ color: tokens.colors.textMuted, margin: 0 }}>{t('dash.noAlerts')}</p>}
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {data.alerts.recent_incidents.map((i) => (
                  <li key={String(i.id)}>
                    {String(i.first_name_fr)} {String(i.last_name_fr)} — {String(i.incident_severity)} — {String(i.incident_description)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
