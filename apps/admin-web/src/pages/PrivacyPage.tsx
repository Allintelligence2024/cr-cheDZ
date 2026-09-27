import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { useAuth } from '../auth/AuthContext';
import { canAnonymizeChild } from '../auth/routeAccess';
import { http } from '../api/client';
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

type Tab = 'registry' | 'dpias' | 'requests' | 'violations' | 'anonymize';

export function PrivacyPage(): React.JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const mayAnonymizeChildren = canAnonymizeChild(user);
  const [tab, setTab] = useState<Tab>('registry');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const showError = (e: unknown): void => { setError((e as { messageFr?: string })?.messageFr ?? t('common.error')); };
  const showMessage = (m: string): void => { setMessage(m); setError(null); };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'registry', label: t('privacy.registry') },
    { id: 'dpias', label: t('privacy.dpias') },
    { id: 'requests', label: t('privacy.requests') },
    { id: 'violations', label: t('privacy.violations') },
    ...(mayAnonymizeChildren ? [{ id: 'anonymize' as const, label: t('privacy.anonymizeTab') }] : []),
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
      {message && <p style={{ color: tokens.colors.success }}>{message}</p>}
      {tab === 'registry' && <RegistryTab onError={showError} />}
      {tab === 'dpias' && <DpiasTab onError={showError} onMessage={showMessage} />}
      {tab === 'requests' && <RequestsTab onError={showError} onMessage={showMessage} />}
      {tab === 'violations' && <ViolationsTab onError={showError} onMessage={showMessage} />}
      {tab === 'anonymize' && mayAnonymizeChildren && <AnonymizeChildTab />}
    </div>
  );
}

interface DepartedChildOption {
  id: string;
  reference_number: string;
  first_name_fr: string;
  last_name_fr: string;
  date_of_birth: string;
  status: string;
}

interface AnonymizeChildResult {
  child_id: string;
  already_anonymized: boolean;
  anonymized_at?: string;
  guardian_ids?: string[];
  user_ids?: string[];
  media_storage_keys?: string[];
  counts?: Record<string, number>;
  media_purge?: { purged: number; failed: Array<{ key: string; error: string }> };
}

/** Anonymisation irreversible, visible uniquement aux directeurs/super-admins. */
function AnonymizeChildTab(): React.JSX.Element {
  const { t, locale } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [candidates, setCandidates] = useState<DepartedChildOption[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<DepartedChildOption | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AnonymizeChildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchDeparted = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const query = searchTerm.trim();
    if (!query) {
      setError(t('privacy.anonymizeSearchRequired'));
      return;
    }

    setSearching(true);
    setError(null);
    setCandidates([]);
    setHasSearched(false);
    setSearchTruncated(false);
    setSelected(null);
    setReason('');
    setConfirmed(false);
    setResult(null);
    try {
      const params = new URLSearchParams({ status: 'departed', search: query, limit: '100' });
      const response = await http.get<{ items: DepartedChildOption[]; total: number }>(`/children?${params.toString()}`);
      const items = response.items ?? [];
      setSearchTruncated(response.total > items.length);
      // Le marqueur exact vient de anonymize_child : les pseudonymes ne sont
      // jamais reproposés comme de nouveaux dossiers à traiter.
      setCandidates(items.filter((child) =>
        child.status === 'departed' && !/^Anonyme-[0-9a-f]{8}$/i.test(child.first_name_fr),
      ));
      setHasSearched(true);
    } catch (e: unknown) {
      setCandidates([]);
      setHasSearched(false);
      setSearchTruncated(false);
      setError((e as { messageFr?: string })?.messageFr ?? t('common.error'));
    } finally {
      setSearching(false);
    }
  };

  const chooseChild = (child: DepartedChildOption): void => {
    setSelected(child);
    setReason('');
    setConfirmed(false);
    setResult(null);
    setError(null);
  };

  const anonymize = async (): Promise<void> => {
    const trimmedReason = reason.trim();
    if (!selected || trimmedReason.length < 5 || !confirmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await http.post<AnonymizeChildResult>(
        `/privacy/children/${encodeURIComponent(selected.id)}/anonymize`,
        { reason: trimmedReason },
      );
      setResult(response);
      setCandidates((items) => items.filter((child) => child.id !== selected.id));
      setSelected(null);
      setReason('');
      setConfirmed(false);
    } catch (e: unknown) {
      setError((e as { messageFr?: string })?.messageFr ?? t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const dateLocale = locale === 'fr' ? 'fr-FR' : 'ar-DZ';
  const keys = result?.media_storage_keys ?? [];
  const failedKeys = new Set((result?.media_purge?.failed ?? []).map((item) => item.key));
  const canSubmit = Boolean(selected && reason.trim().length >= 5 && confirmed && !submitting);

  return (
    <Card title={t('privacy.anonymizeTitle')}>
      <p style={{ color: tokens.colors.textMuted }}>{t('privacy.anonymizeIntro')}</p>
      <form onSubmit={(event) => void searchDeparted(event)} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <TextField
            label={t('privacy.anonymizeSearchLabel')}
            value={searchTerm}
            onChange={(value) => {
              setSearchTerm(value.slice(0, 100));
              setCandidates([]);
              setHasSearched(false);
              setSearchTruncated(false);
              setSelected(null);
              setResult(null);
              setError(null);
            }}
            placeholder={t('privacy.anonymizeSearchPlaceholder')}
            required
            disabled={searching || submitting}
            dir="auto"
            hint={`${searchTerm.length}/100`}
          />
        </div>
        <Button type="submit" disabled={!searchTerm.trim() || searching || submitting}>
          {searching ? t('common.loading') : t('privacy.anonymizeSearchButton')}
        </Button>
      </form>

      {error && <p role="alert" style={{ color: tokens.colors.danger }}>{error}</p>}
      {hasSearched && searchTruncated && (
        <p role="note" style={{ color: tokens.colors.warning }}>{t('privacy.anonymizeRefine')}</p>
      )}

      {hasSearched && candidates.length > 0 && (
        <div aria-busy={searching} style={{ marginTop: tokens.spacing.md }}>
          <Table
            headers={[t('common.name'), t('children.ref'), t('children.birth'), t('common.actions')]}
            rows={candidates.map((child) => [
              `${child.first_name_fr} ${child.last_name_fr}`,
              child.reference_number,
              new Date(child.date_of_birth).toLocaleDateString(dateLocale),
              <Button key={child.id} variant="ghost" disabled={submitting} onClick={() => chooseChild(child)}>
                {t('privacy.anonymizeSelect')}
              </Button>,
            ])}
          />
        </div>
      )}
      {hasSearched && candidates.length === 0 && !searchTruncated && (
        <p style={{ color: tokens.colors.textMuted }}>{t('privacy.anonymizeNoResults')}</p>
      )}

      {selected && (
        <section style={{ marginTop: tokens.spacing.lg, border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.md, padding: tokens.spacing.lg }}>
          <h3 style={{ marginTop: 0 }}>{t('privacy.anonymizeSelected')}</h3>
          <p>
            <strong>{selected.first_name_fr} {selected.last_name_fr}</strong>
            {' — '}{t('children.ref')}: {selected.reference_number}
            {' — '}{t('children.birth')}: {new Date(selected.date_of_birth).toLocaleDateString(dateLocale)}
          </p>
          <p role="note" style={{ color: tokens.colors.danger, fontWeight: 600 }}>{t('privacy.anonymizeWarning')}</p>
          <div style={{ maxWidth: 560 }}>
            <TextField
              label={t('privacy.anonymizeReason')}
              value={reason}
              onChange={(value) => {
                setReason(value.slice(0, 500));
                setConfirmed(false);
              }}
              required
              disabled={submitting}
              hint={t('privacy.anonymizeReasonHint')}
            />
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: `${tokens.spacing.sm} 0 ${tokens.spacing.md}`, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={submitting}
              onChange={(event) => setConfirmed(event.target.checked)}
              style={{ marginTop: 4 }}
            />
            <span>{t('privacy.anonymizeConfirm')}</span>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="danger" disabled={!canSubmit} onClick={() => void anonymize()}>
              {submitting ? t('common.loading') : t('privacy.anonymizeSubmit')}
            </Button>
            <Button variant="ghost" disabled={submitting} onClick={() => setSelected(null)}>
              {t('privacy.anonymizeCancel')}
            </Button>
          </div>
        </section>
      )}

      {result && (
        <section aria-live="polite" style={{ marginTop: tokens.spacing.lg, border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.md, padding: tokens.spacing.lg }}>
          <h3 style={{ marginTop: 0 }}>{t('privacy.anonymizeResult')}</h3>
          <p style={{ color: result.already_anonymized ? tokens.colors.textMuted : tokens.colors.success, fontWeight: 600 }}>
            {result.already_anonymized ? t('privacy.anonymizeAlready') : t('privacy.anonymizeSuccess')}
          </p>
          {!result.already_anonymized && (
            <>
              <ul>
                <li>{t('privacy.anonymizeGuardians')}: {result.counts?.guardians ?? result.guardian_ids?.length ?? 0}</li>
                <li>{t('privacy.anonymizeAccounts')}: {result.counts?.users ?? result.user_ids?.length ?? 0}</li>
                <li>{t('privacy.anonymizeMedia')}: {result.counts?.media_assets ?? 0}</li>
                <li>{t('privacy.anonymizePurged')}: {result.media_purge?.purged ?? 0}</li>
                <li>{t('privacy.anonymizeFailed')}: {result.media_purge?.failed.length ?? 0}</li>
              </ul>
              <h4>{t('privacy.anonymizeKeys')}</h4>
              {keys.length === 0 ? (
                <p style={{ color: tokens.colors.textMuted }}>{t('privacy.anonymizeNoKeys')}</p>
              ) : (
                <ul>
                  {keys.map((key, index) => (
                    <li key={`${key}-${index}`}>
                      <code dir="ltr" style={{ overflowWrap: 'anywhere' }}>{key}</code>
                      {' — '}{failedKeys.has(key) ? t('privacy.anonymizeKeyFailed') : t('privacy.anonymizeKeyPurged')}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </Card>
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

  const sevColor = (s: string): string => (s === 'high' || s === 'critical' ? tokens.colors.danger : s === 'moderate' ? tokens.colors.warning : tokens.colors.success);

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
