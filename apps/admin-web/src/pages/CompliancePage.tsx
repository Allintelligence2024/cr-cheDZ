import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, tokens } from '@creche/design-system';
import { ApiError, http } from '../api/client';
import { useI18n } from '../i18n';

interface CheckResult {
  code: string;
  severity: string;
  message_fr: string;
  message_ar: string;
  result: 'pass' | 'fail' | 'warning';
  details?: Record<string, unknown>;
}

interface PersistedCheck {
  id: string;
  code: string;
  severity: string;
  result: string;
  message_fr: string;
  details: Record<string, unknown> | null;
  checked_at: string;
  acknowledged_at: string | null;
}

const RESULT_COLOR: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', warning: '#B45309' };

export function CompliancePage(): React.JSX.Element {
  const { t } = useI18n();
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [history, setHistory] = useState<PersistedCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHistory = (): void => {
    http
      .get<PersistedCheck[]>('/compliance/checks')
      .then(setHistory)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.messageFr : ''));
  };
  useEffect(loadHistory, []);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await http.get<{ checked_at: string; results: CheckResult[] }>('/compliance/summary');
      setResults(r.results);
      loadHistory();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr : '');
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (id: string): Promise<void> => {
    setError(null);
    try {
      await http.post(`/compliance/checks/${id}/acknowledge`, {});
      loadHistory();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr : '');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('compliance.title')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: tokens.spacing.md }}>
          <Button onClick={() => void run()} disabled={busy}>{busy ? t('common.loading') : t('compliance.run')}</Button>
        </div>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {results && (
          <Table
            headers={[t('compliance.rule'), t('common.status'), t('compliance.details')]}
            rows={results.map((r) => [
              <span key="c">{r.code} — {r.message_fr}</span>,
              <span key="s" style={{ color: RESULT_COLOR[r.result] ?? '#000', fontWeight: 700, textTransform: 'uppercase' }}>{r.result}</span>,
              <code key="d" style={{ fontSize: 12 }}>{JSON.stringify(r.details ?? {})}</code>,
            ])}
          />
        )}
        {results === null && !busy && <p style={{ color: tokens.colors.textMuted }}>{t('compliance.hint')}</p>}
      </Card>

      <Card title={t('compliance.history')}>
        {history.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
        <Table
          headers={[t('compliance.rule'), t('common.status'), t('common.date'), t('compliance.acknowledged')]}
          rows={history.slice(0, 30).map((c) => [
            `${c.code} — ${c.message_fr}`,
            <span key="s" style={{ color: RESULT_COLOR[c.result] ?? '#000', fontWeight: 700, textTransform: 'uppercase' }}>{c.result}</span>,
            new Date(c.checked_at).toLocaleString('fr-FR'),
            c.acknowledged_at
              ? new Date(c.acknowledged_at).toLocaleString('fr-FR')
              : <Button key="b" variant="ghost" onClick={() => void acknowledge(c.id)}>{t('compliance.acknowledge')}</Button>,
          ])}
        />
      </Card>
    </div>
  );
}
