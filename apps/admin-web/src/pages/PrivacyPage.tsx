import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http, ApiError } from '../api/client';
import { useI18n } from '../i18n';

interface RegistryRow {
  id: string;
  processing_name: string;
  purpose_fr: string;
  legal_basis: string;
  data_categories: string[];
  data_subjects: string[];
  retention_days: number;
  is_active: boolean;
}

interface DpiaRow {
  id: string;
  processing_registry_id: string;
  processing_name: string;
  status: string;
  approved_at: string | null;
  review_date: string | null;
  created_at: string;
}

interface RequestRow {
  id: string;
  requester_id: string;
  requester_email: string;
  request_type: string;
  subject_id: string | null;
  status: string;
  notes: string | null;
  deadline: string;
  resolved_at: string | null;
  created_at: string;
}

interface ViolationRow {
  id: string;
  description: string;
  data_categories: string[];
  affected_subjects: number;
  severity: string;
  status: string;
  notification_deadline: string;
  anpdp_notified_at: string | null;
  notification_status: string;
  created_at: string;
}

type Tab = 'registry' | 'dpias' | 'requests' | 'violations';

export function PrivacyPage(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('registry');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const showError = (e: unknown): void => { setError(e instanceof ApiError ? e.messageFr : t('common.error')); };
  const showMessage = (m: string): void => { setMessage(m); setError(null); };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'registry', label: t('privacy.registry') },
    { id: 'dpias', label: t('privacy.dpias') },
    { id: 'requests', label: t('privacy.requests') },
    { id: 'violations', label: t('privacy.violations') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((tabDef) => (
          <Button key={tabDef.id} variant={tab === tabDef.id ? 'primary' : 'ghost'} onClick={() => setTab(tabDef.id)}>
            {tabDef.label}
          </Button>
        ))}
      </div>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {message && <p style={{ color: '#16A34A' }}>{message}</p>}
      {tab === 'registry' && <RegistryTab onError={showError} />}
      {tab === 'dpias' && <DpiasTab onError={showError} onMessage={showMessage} />}
      {tab === 'requests' && <RequestsTab onError={showError} onMessage={showMessage} />}
      {tab === 'violations' && <ViolationsTab onError={showError} onMessage={showMessage} />}
    </div>
  );
}

// ── Registre des traitements ─────────────────────────────────────────────────

function RegistryTab({ onError }: { onError: (e: unknown) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [rows, setRows] = useState<RegistryRow[]>([]);

  useEffect(() => {
    http.get<RegistryRow[]>('/privacy/registry').then(setRows).catch(onError);
  }, []);

  return (
    <Card title={t('privacy.registry')}>
      <Table
        headers={[t('privacy.processing'), t('privacy.purpose'), t('privacy.basis'), t('privacy.categories'), t('privacy.retention')]}
        rows={rows.map((r) => [
          r.processing_name,
          r.purpose_fr,
          r.legal_basis,
          (r.data_categories ?? []).join(', '),
          `${r.retention_days} j`,
        ])}
      />
      {rows.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}

// ── DPIA ─────────────────────────────────────────────────────────────────────

function DpiasTab({ onError, onMessage }: { onError: (e: unknown) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [rows, setRows] = useState<DpiaRow[]>([]);
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [procId, setProcId] = useState('');

  const load = (): void => {
    http.get<DpiaRow[]>('/privacy/dpias').then(setRows).catch(onError);
  };
  useEffect(load, []);
  useEffect(() => {
    http.get<RegistryRow[]>('/privacy/registry').then(setRegistry).catch(onError);
  }, []);

  const create = async (): Promise<void> => {
    try {
      await http.post('/privacy/dpias', { processing_registry_id: procId, risk_assessment: { risk_level: 'medium' } });
      onMessage(t('privacy.dpiaCreated'));
      setProcId('');
      load();
    } catch (e: unknown) { onError(e); }
  };

  const approve = async (id: string): Promise<void> => {
    try {
      await http.post(`/privacy/dpias/${id}/approve`, {});
      onMessage(t('privacy.dpiaApproved'));
      load();
    } catch (e: unknown) { onError(e); }
  };

  return (
    <Card title={t('privacy.dpias')}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: tokens.spacing.md }}>
        <select
          value={procId}
          onChange={(e) => setProcId(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: tokens.radius.sm, border: `1px solid ${tokens.colors.border}`, minWidth: 260 }}
        >
          <option value="">{t('privacy.selectProcessing')}</option>
          {registry.map((r) => (
            <option key={r.id} value={r.id}>{r.processing_name}</option>
          ))}
        </select>
        <Button onClick={() => void create()} disabled={!procId}>{t('privacy.createDpia')}</Button>
      </div>
      <Table
        headers={[t('privacy.processing'), t('common.status'), t('privacy.approved'), t('privacy.review'), t('common.actions')]}
        rows={rows.map((d) => [
          d.processing_name,
          <span key="s" style={{ textTransform: 'uppercase', fontWeight: 600 }}>{d.status}</span>,
          d.approved_at ? new Date(d.approved_at).toLocaleDateString('fr-FR') : '—',
          d.review_date ?? '—',
          d.status !== 'approved'
            ? <Button key="a" variant="ghost" onClick={() => void approve(d.id)}>{t('privacy.approve')}</Button>
            : '—',
        ])}
      />
      {rows.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}

// ── Demandes de droits ───────────────────────────────────────────────────────

function RequestsTab({ onError, onMessage }: { onError: (e: unknown) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [type, setType] = useState('access');
  const [subjectId, setSubjectId] = useState('');
  const [notes, setNotes] = useState('');

  const load = (): void => {
    http.get<RequestRow[]>('/privacy/requests').then(setRows).catch(onError);
  };
  useEffect(load, []);

  const create = async (): Promise<void> => {
    try {
      await http.post('/privacy/requests', { request_type: type, subject_id: subjectId || undefined, notes: notes || undefined });
      onMessage(t('privacy.requestCreated'));
      setSubjectId('');
      setNotes('');
      load();
    } catch (e: unknown) { onError(e); }
  };

  const doExport = async (id: string): Promise<void> => {
    try {
      const r = await http.post<{ payload?: Record<string, unknown> }>(`/privacy/requests/${id}/export`, {});
      onMessage(`${t('privacy.exportDone')} — ${Object.keys(r.payload ?? {}).length} sections`);
    } catch (e: unknown) { onError(e); }
  };

  const resolve = async (id: string): Promise<void> => {
    try {
      await http.post(`/privacy/requests/${id}/resolve`, {});
      onMessage(t('privacy.resolved'));
      load();
    } catch (e: unknown) { onError(e); }
  };

  return (
    <Card title={t('privacy.requests')}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: tokens.spacing.md }}>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: '10px 12px', borderRadius: tokens.radius.sm, border: `1px solid ${tokens.colors.border}` }}>
          <option value="access">{t('privacy.access')}</option>
          <option value="rectification">{t('privacy.rectification')}</option>
          <option value="opposition">{t('privacy.opposition')}</option>
        </select>
        <div style={{ minWidth: 240 }}>
          <TextField label={t('common.child') + ' (UUID, optionnel)'} value={subjectId} onChange={setSubjectId} dir="ltr" />
        </div>
        <div style={{ minWidth: 200 }}>
          <TextField label={t('privacy.notes')} value={notes} onChange={setNotes} />
        </div>
        <Button onClick={() => void create()}>{t('privacy.createRequest')}</Button>
      </div>
      <Table
        headers={[t('privacy.type'), t('privacy.requester'), t('common.status'), t('privacy.deadline'), t('common.actions')]}
        rows={rows.map((r) => [
          r.request_type,
          r.requester_email,
          <span key="s" style={{ textTransform: 'uppercase', fontWeight: 600 }}>{r.status}</span>,
          new Date(r.deadline).toLocaleDateString('fr-FR'),
          <div key="a" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => void doExport(r.id)}>{t('privacy.export')}</Button>
            {r.status === 'pending' && <Button variant="ghost" onClick={() => void resolve(r.id)}>{t('privacy.resolve')}</Button>}
          </div>,
        ])}
      />
      {rows.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}

// ── Violations ───────────────────────────────────────────────────────────────

function ViolationsTab({ onError, onMessage }: { onError: (e: unknown) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [rows, setRows] = useState<ViolationRow[]>([]);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [affected, setAffected] = useState('1');

  const load = (): void => {
    http.get<ViolationRow[]>('/privacy/violations').then(setRows).catch(onError);
  };
  useEffect(load, []);

  const create = async (): Promise<void> => {
    try {
      await http.post('/privacy/violations', {
        description,
        severity,
        affected_subjects: Number(affected) || 0,
        data_categories: [],
      });
      onMessage(t('privacy.violationCreated'));
      setDescription('');
      load();
    } catch (e: unknown) { onError(e); }
  };

  const notify = async (id: string): Promise<void> => {
    try {
      await http.post(`/privacy/violations/${id}/anpdp-notify`, {});
      onMessage(t('privacy.notified'));
      load();
    } catch (e: unknown) { onError(e); }
  };

  const sevColor = (s: string): string => (s === 'high' || s === 'critical' ? '#DC2626' : s === 'moderate' ? '#B45309' : '#16A34A');

  return (
    <Card title={t('privacy.violations')}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: tokens.spacing.md }}>
        <div style={{ minWidth: 300 }}>
          <TextField label={t('privacy.violationDesc')} value={description} onChange={setDescription} />
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ padding: '10px 12px', borderRadius: tokens.radius.sm, border: `1px solid ${tokens.colors.border}` }}>
          <option value="low">low</option>
          <option value="moderate">moderate</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
        <div style={{ minWidth: 120 }}>
          <TextField label={t('privacy.affected')} type="number" value={affected} onChange={setAffected} />
        </div>
        <Button onClick={() => void create()} disabled={!description.trim()}>{t('privacy.createViolation')}</Button>
      </div>
      <Table
        headers={[t('privacy.violationDesc'), t('privacy.severity'), t('privacy.affected'), t('privacy.deadlineAnpdp'), t('privacy.notifStatus'), t('common.actions')]}
        rows={rows.map((v) => [
          v.description.slice(0, 60),
          <span key="s" style={{ color: sevColor(v.severity), fontWeight: 600, textTransform: 'uppercase' }}>{v.severity}</span>,
          v.affected_subjects,
          new Date(v.notification_deadline).toLocaleDateString('fr-FR'),
          v.anpdp_notified_at ? `${t('privacy.notified')} (${new Date(v.anpdp_notified_at).toLocaleDateString('fr-FR')})` : v.notification_status,
          !v.anpdp_notified_at
            ? <Button key="n" variant="ghost" onClick={() => void notify(v.id)}>{t('privacy.notifyAnpdp')}</Button>
            : '—',
        ])}
      />
      {rows.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}
