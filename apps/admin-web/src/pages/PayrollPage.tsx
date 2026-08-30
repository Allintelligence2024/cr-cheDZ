import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface PayrollRun {
  id: string;
  period_year: number;
  period_month: number;
  status: 'draft' | 'finalized' | 'cancelled';
  total_gross: string;
  total_net: string;
  finalized_at: string | null;
  created_at: string;
}

interface PayrollEntry {
  id: string;
  staff_id: string;
  gross_amount: string;
  deductions_amount: string;
  net_amount: string;
  status: string;
  paid_at: string | null;
  first_name: string;
  last_name: string;
  lines: Array<{ line_type: string; label_fr: string; amount: string }>;
}

interface RunDetail extends PayrollRun {
  entries: PayrollEntry[];
}

export function PayrollPage(): React.JSX.Element {
  const { t } = useI18n();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('1');
  const [busy, setBusy] = useState(false);
  // Lignes (modale d'entrée)
  const [lineTarget, setLineTarget] = useState<PayrollEntry | null>(null);
  const [lineType, setLineType] = useState('bonus');
  const [lineLabel, setLineLabel] = useState('');
  const [lineAmount, setLineAmount] = useState('');

  const load = (): void => {
    http
      .get<PayrollRun[]>('/payroll/runs')
      .then((r) => {
        setRuns(r);
        setError(null);
      })
      .catch((e: unknown) => setError((e as { messageFr?: string }).messageFr ?? ''));
  };
  useEffect(load, []);

  const openRun = async (id: string): Promise<void> => {
    setError(null);
    try {
      const detail = await http.get<RunDetail>(`/payroll/runs/${id}`);
      setSelected(detail);
    } catch (e: unknown) {
      setError((e as { messageFr?: string }).messageFr ?? '');
    }
  };

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const run = await http.post<{ id: string }>('/payroll/generate', {
        period_year: Number(year),
        period_month: Number(month),
      });
      setMessage(t('payroll.generated'));
      load();
      await openRun(run.id);
    } catch (e: unknown) {
      setError((e as { messageFr?: string }).messageFr ?? '');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (): Promise<void> => {
    if (!selected) return;
    setError(null);
    setMessage(null);
    try {
      await http.post(`/payroll/runs/${selected.id}/finalize`, {});
      setMessage(t('payroll.finalized'));
      await openRun(selected.id);
      load();
    } catch (e: unknown) {
      setError((e as { messageFr?: string }).messageFr ?? '');
    }
  };

  const addLine = async (): Promise<void> => {
    if (!lineTarget || !lineLabel || !lineAmount) return;
    setError(null);
    setMessage(null);
    try {
      await http.post(`/payroll/entries/${lineTarget.id}/lines`, {
        lines: [{ line_type: lineType, label_fr: lineLabel, amount: Number(lineAmount) }],
      });
      setMessage(t('payroll.lineAdded'));
      setLineTarget(null);
      setLineLabel('');
      setLineAmount('');
      if (selected) await openRun(selected.id);
    } catch (e: unknown) {
      setError((e as { messageFr?: string }).messageFr ?? '');
    }
  };

  const fmt = (n: string | number): string => `${Number(n).toLocaleString('fr-FR')} DZD`;
  const periodLabel = (r: { period_year: number; period_month: number }): string => `${String(r.period_month).padStart(2, '0')}/${r.period_year}`;
  const lineColor = (type: string): string => (type === 'deduction' ? '#DC2626' : type === 'bonus' ? '#16A34A' : '#334155');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('payroll.title')}>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}
        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 110 }}>
            <TextField label={t('bill.periodYear')} type="number" value={year} onChange={setYear} />
          </div>
          <div style={{ minWidth: 90 }}>
            <TextField label={t('bill.periodMonth')} type="number" value={month} onChange={setMonth} />
          </div>
          <Button onClick={() => void generate()} disabled={busy || !year || !month}>
            {busy ? t('common.loading') : t('payroll.generate')}
          </Button>
        </div>

        <div style={{ marginTop: tokens.spacing.lg }}>
          <Table
            headers={[t('payroll.period'), t('common.status'), t('payroll.gross'), t('payroll.net'), t('common.actions')]}
            rows={runs.map((r) => [
              periodLabel(r),
              <span key="s" style={{ textTransform: 'uppercase', fontWeight: 600 }}>{r.status}</span>,
              fmt(r.total_gross),
              fmt(r.total_net),
              <Button key="o" variant="ghost" onClick={() => void openRun(r.id)}>{t('payroll.detail')}</Button>,
            ])}
          />
          {runs.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
        </div>
      </Card>

      {selected && (
        <Card title={`${t('payroll.period')} ${periodLabel(selected)} — ${t('payroll.entries')}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.spacing.md }}>
            <p style={{ margin: 0, color: tokens.colors.textMuted }}>
              {t('payroll.gross')} : <strong>{fmt(selected.total_gross)}</strong> · {t('payroll.net')} : <strong>{fmt(selected.total_net)}</strong>
            </p>
            {selected.status === 'draft' && (
              <Button onClick={() => void finalize()}>{t('payroll.finalize')}</Button>
            )}
          </div>
          <Table
            headers={['Nom', t('payroll.gross'), t('payroll.deductions'), t('payroll.net'), t('common.actions')]}
            rows={selected.entries.map((e) => [
              `${e.first_name} ${e.last_name}`,
              fmt(e.gross_amount),
              <span key="d" style={{ color: Number(e.deductions_amount) > 0 ? '#DC2626' : '#16A34A' }}>{fmt(e.deductions_amount)}</span>,
              <strong key="n">{fmt(e.net_amount)}</strong>,
              selected.status === 'draft'
                ? <Button key="l" variant="ghost" onClick={() => { setLineTarget(e); setLineType('bonus'); }}>{t('payroll.addLine')}</Button>
                : '—',
            ])}
          />
        </Card>
      )}

      {lineTarget && selected?.status === 'draft' && (
        <Card title={`${t('payroll.addLine')} — ${lineTarget.first_name} ${lineTarget.last_name}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <select
              value={lineType}
              onChange={(e) => setLineType(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.colors.border}` }}
            >
              <option value="bonus">{t('payroll.bonus')}</option>
              <option value="allowance">{t('payroll.allowance')}</option>
              <option value="deduction">{t('payroll.deduction')}</option>
            </select>
            <div style={{ minWidth: 200 }}>
              <TextField label={t('payroll.label')} value={lineLabel} onChange={setLineLabel} />
            </div>
            <div style={{ minWidth: 140 }}>
              <TextField label={t('common.amount') + ' (DZD)'} type="number" value={lineAmount} onChange={setLineAmount} />
            </div>
            <Button onClick={() => void addLine()} disabled={!lineLabel || !lineAmount}>{t('payroll.saveLine')}</Button>
            <Button variant="ghost" onClick={() => setLineTarget(null)}>{t('common.cancel')}</Button>
          </div>
          {lineTarget.lines.map((l) => (
            <p key={l.label_fr + l.amount} style={{ margin: '8px 0 0', fontSize: 13, color: lineColor(l.line_type) }}>
              {l.line_type} — {l.label_fr} : {fmt(l.amount)}
            </p>
          ))}
        </Card>
      )}
    </div>
  );
}
