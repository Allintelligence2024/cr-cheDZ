import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface ExportRow {
  id: string;
  report_type: string;
  period_label: string;
  status: 'pending' | 'done' | 'failed';
  file_size_bytes: number | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

const STATUS_COLOR: Record<ExportRow['status'], string> = { pending: '#B45309', done: '#16A34A', failed: '#DC2626' };

export function ExportsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<ExportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reportType, setReportType] = useState<'attendance' | 'invoices'>('attendance');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [rangeStart, setRangeStart] = useState(new Date().toISOString().slice(0, 10));
  const [rangeEnd, setRangeEnd] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    http
      .get<ExportRow[]>('/exports')
      .then((r) => {
        setItems(r);
        setError(null);
      })
      .catch((e: any) => setError(e.messageFr ?? ''));
  };
  useEffect(load, []);

  const request = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const periodValue = reportType === 'invoices' ? period : `${rangeStart}..${rangeEnd}`;
      await http.post('/exports', { report_type: reportType, period: periodValue });
      setMessage(t('exports.requested'));
      load();
    } catch (e: any) {
      setError(e.messageFr ?? '');
    } finally {
      setBusy(false);
    }
  };

  const download = async (id: string): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/exports/${id}/download`, {
        headers: { authorization: `Bearer ${localStorage.getItem('creche_access_token') ?? ''}` },
        redirect: 'follow',
      });
      if (res.status === 409) {
        setError(t('exports.notReady'));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${id.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('common.error'));
    }
  };

  const size = (b: number | null): string => (b == null ? '—' : b > 1024 ? `${(b / 1024).toFixed(1)} Ko` : `${b} o`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('exports.title')}>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}
        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: tokens.typography.small, color: tokens.colors.textMuted, marginBottom: 4 }}>
              {t('exports.type')}
            </label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'attendance' | 'invoices')}
              style={{ padding: '10px 12px', borderRadius: tokens.radius.sm, border: `1px solid ${tokens.colors.border}`, fontSize: tokens.typography.body }}
            >
              <option value="attendance">{t('exports.attendance')}</option>
              <option value="invoices">{t('exports.invoices')}</option>
            </select>
          </div>
          {reportType === 'invoices' ? (
            <div style={{ minWidth: 160 }}>
              <TextField label={t('exports.period') + ' (YYYY-MM)'} value={period} onChange={setPeriod} dir="ltr" />
            </div>
          ) : (
            <>
              <div style={{ minWidth: 170 }}>
                <TextField label={t('exports.from')} type="date" value={rangeStart} onChange={setRangeStart} />
              </div>
              <div style={{ minWidth: 170 }}>
                <TextField label={t('exports.to')} type="date" value={rangeEnd} onChange={setRangeEnd} />
              </div>
            </>
          )}
          <Button onClick={() => void request()} disabled={busy}>{busy ? t('common.loading') : t('exports.request')}</Button>
        </div>

        <div style={{ marginTop: tokens.spacing.lg }}>
          <Table
            headers={[t('exports.type'), t('exports.period'), t('common.status'), t('exports.size'), t('common.date'), '']}
            rows={items.map((e) => [
              e.report_type === 'attendance' ? t('exports.attendance') : t('exports.invoices'),
              e.period_label,
              <span key="s" style={{ color: STATUS_COLOR[e.status] ?? '#000', fontWeight: 600, textTransform: 'uppercase' }}>{e.status}</span>,
              size(e.file_size_bytes),
              new Date(e.created_at).toLocaleString('fr-FR'),
              e.status === 'done'
                ? <Button key="d" variant="ghost" onClick={() => void download(e.id)}>{t('exports.download')}</Button>
                : e.status === 'failed'
                  ? <span key="f" style={{ fontSize: 12, color: tokens.colors.danger }}>{e.failure_reason ?? '—'}</span>
                  : '—',
            ])}
          />
          {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
        </div>
      </Card>
    </div>
  );
}
