import React from 'react';
import { useEffect, useState } from 'react';
import { ThemeToggle, tokens } from '@creche/design-system';

/**
 * Console support (Phase 10) — accès restreint super_admin.
 * Recherche globale cross-tenant, monitoring/retry des jobs, impersonation
 * auditée. L'API est proxifiée par Vite (target http://localhost:3000).
 */
const BASE = '/api/v1';
const TOKEN_KEY = 'support_access_token';

interface SearchRow {
  kind: 'organization' | 'child' | 'user';
  id: string;
  label: string;
  org_slug: string | null;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  organization_id: string | null;
  attempts: number;
  max_attempts: number;
  failure_reason: string | null;
  created_at: string;
}

const api = async (method: string, path: string, body?: unknown): Promise<unknown> => {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((data as { message_fr?: string }).message_fr ?? `HTTP ${res.status}`);
  return data;
};

function Login({ onLogin }: { onLogin: (token: string) => void }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      const r = (await api('POST', '/auth/login', { email, password })) as { access_token: string };
      localStorage.setItem(TOKEN_KEY, r.access_token);
      onLogin(r.access_token);
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Connexion refusée');
    }
  };

  return (
    <main
      style={{
        fontFamily: tokens.typography.fontFamily,
        maxWidth: 380,
        // marge latérale sur petits écrans : la carte ne colle plus aux bords
        margin: 'clamp(24px, 10vh, 80px) auto',
        padding: 24,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.md,
        background: tokens.colors.surface,
        boxShadow: tokens.shadows.md,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ThemeToggle />
      </div>
      <h1 style={{ fontSize: tokens.typography.h1 }}>🛠 Crèche SaaS — Console support</h1>
      <p style={{ color: tokens.colors.textMuted, fontSize: 13 }}>Accès restreint équipe interne (super_admin).</p>
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" />
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>Mot de passe</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
      {error && <p style={{ color: tokens.colors.danger, fontSize: 13 }}>{error}</p>}
      <button onClick={() => void submit()} style={buttonStyle}>Se connecter</button>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.colors.borderStrong}`,
  background: tokens.colors.surface,
  color: tokens.colors.text,
  // 16px mini sous iOS : en dessous, Safari zoome au focus.
  fontSize: 'max(16px, 1em)',
  boxSizing: 'border-box',
};
const buttonStyle: React.CSSProperties = {
  marginTop: 16,
  width: '100%',
  padding: '10px 12px',
  borderRadius: tokens.radius.sm,
  border: 'none',
  background: tokens.colors.primary,
  color: tokens.colors.primaryContrast,
  fontWeight: 600,
  // 44px : cible tactile minimale (mêmes règles que l'admin-web).
  minHeight: 44,
  cursor: 'pointer',
};
/** Bouton discret des tableaux (Retry / Activer…). */
const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.colors.borderStrong}`,
  cursor: 'pointer',
  minHeight: 36,
  background: tokens.colors.surface,
  color: tokens.colors.text,
  fontWeight: 600,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  borderRadius: tokens.radius.pill,
  border: `1px solid ${active ? tokens.colors.primary : tokens.colors.border}`,
  cursor: 'pointer',
  fontWeight: 600,
  minHeight: 44,
  background: active ? tokens.colors.primary : tokens.colors.surface,
  color: active ? tokens.colors.primaryContrast : tokens.colors.textMuted,
});

type Tab = 'search' | 'jobs' | 'impersonate' | 'flags' | 'pilot';

interface FlagRow {
  flag_key: string;
  is_enabled: boolean;
  description: string | null;
  organization_id: string | null;
  org_slug: string | null;
}

interface PilotRow {
  org_slug: string;
  org_name: string;
  children_active: number;
  checkins_today: number;
  sync_ops_24h: number;
  journal_events_today: number;
  invoices_unpaid: number;
  jobs_failed_24h: number;
}

export function App(): React.JSX.Element {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [tab, setTab] = useState<Tab>('search');

  if (!token) return <Login onLogin={setToken} />;

  const logout = (): void => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  };

  return (
    <main style={{ fontFamily: tokens.typography.fontFamily, padding: 'clamp(16px, 4vw, 24px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: tokens.spacing.md, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: tokens.typography.h1 }}>🛠 Console support</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.sm }}>
          <ThemeToggle />
          <button onClick={logout} style={{ ...buttonStyle, width: 'auto', marginTop: 0, background: tokens.colors.danger }}>Déconnexion</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '20px 0', flexWrap: 'wrap' }}>
        <button style={tabStyle(tab === 'search')} onClick={() => setTab('search')}>Recherche globale</button>
        <button style={tabStyle(tab === 'jobs')} onClick={() => setTab('jobs')}>Jobs</button>
        <button style={tabStyle(tab === 'impersonate')} onClick={() => setTab('impersonate')}>Impersonation</button>
        <button style={tabStyle(tab === 'flags')} onClick={() => setTab('flags')}>Feature flags</button>
        <button style={tabStyle(tab === 'pilot')} onClick={() => setTab('pilot')}>Suivi pilote</button>
      </div>
      {tab === 'search' && <SearchTab />}
      {tab === 'jobs' && <JobsTab />}
      {tab === 'impersonate' && <ImpersonateTab />}
      {tab === 'flags' && <FlagsTab />}
      {tab === 'pilot' && <PilotTab />}
    </main>
  );
}

function PilotTab(): React.JSX.Element {
  const [rows, setRows] = useState<PilotRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api('GET', '/support/pilot-summary').then((r) => setRows(r as PilotRow[])).catch((e: unknown) => setError((e as { message?: string }).message ?? 'Error'));
  };
  useEffect(load, []);

  const total = (k: keyof PilotRow): number => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const pilots = rows.filter((r) => r.org_slug.startsWith('pilot-'));

  return (
    <section>
      <button onClick={load} style={{ ...buttonStyle, width: 'auto', marginTop: 0, marginBottom: 12 }}>Actualiser</button>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {pilots.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            ['Pointages aujourd\u2019hui', total('checkins_today')],
            ['Sync ops 24 h', total('sync_ops_24h')],
            ['Événements journal aujourd\u2019hui', total('journal_events_today')],
            ['Enfants actifs', total('children_active')],
            ['Jobs en échec 24 h', total('jobs_failed_24h')],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.sm, padding: '10px 16px', textAlign: 'center', background: tokens.colors.surface }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>{label}</div>
            </div>
          ))}
        </div>
      )}
      {/* Tables larges : défilement horizontal plutôt que débordement hors écran. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>Organisation</th><th style={thStyle}>Enfants actifs</th><th style={thStyle}>Pointages aujourd\u2019hui</th>
              <th style={thStyle}>Sync 24 h</th><th style={thStyle}>Journal aujourd\u2019hui</th><th style={thStyle}>Factures impayées</th><th style={thStyle}>Jobs échoués 24 h</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.org_slug} style={{ borderBottom: `1px solid ${tokens.colors.border}`, background: r.org_slug.startsWith('pilot-') ? tokens.colors.primarySoft : undefined }}>
                <td style={tdStyle}>{r.org_slug} {r.org_slug.startsWith('pilot-') && '🎯'}</td>
                <td style={tdStyle}>{r.children_active}</td>
                <td style={tdStyle}>{r.checkins_today}</td>
                <td style={tdStyle}>{r.sync_ops_24h}</td>
                <td style={tdStyle}>{r.journal_events_today}</td>
                <td style={{ ...tdStyle, color: r.invoices_unpaid > 0 ? tokens.colors.warning : tokens.colors.success }}>{r.invoices_unpaid}</td>
                <td style={{ ...tdStyle, color: r.jobs_failed_24h > 0 ? tokens.colors.danger : tokens.colors.success }}>{r.jobs_failed_24h}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FlagsTab(): React.JSX.Element {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api('GET', '/support/flags').then((r) => setFlags(r as FlagRow[])).catch((e: unknown) => setError((e as { message?: string }).message ?? 'Error'));
  };
  useEffect(load, []);

  const toggle = async (flag: FlagRow, isEnabled: boolean): Promise<void> => {
    setError(null);
    try {
      await api('POST', `/support/flags/${encodeURIComponent(flag.flag_key)}`, {
        organization_id: flag.organization_id ?? undefined,
        is_enabled: isEnabled,
      });
      load();
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Error');
    }
  };

  return (
    <section>
      <button onClick={load} style={{ ...buttonStyle, width: 'auto', marginTop: 0, marginBottom: 12 }}>Actualiser</button>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {/* Tables larges : défilement horizontal plutôt que débordement hors écran. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>Flag</th><th style={thStyle}>Description</th><th style={thStyle}>Organisation</th><th style={thStyle}>État</th><th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={`${f.flag_key}-${f.organization_id ?? 'global'}`} style={{ borderBottom: `1px solid ${tokens.colors.border}` }}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{f.flag_key}</td>
                <td style={tdStyle}>{f.description ?? '—'}</td>
                <td style={tdStyle}>{f.org_slug ?? '🌐 global'}</td>
                <td style={{ ...tdStyle, color: f.is_enabled ? tokens.colors.success : tokens.colors.danger, fontWeight: 600 }}>{f.is_enabled ? 'ON' : 'OFF'}</td>
                <td style={tdStyle}>
                  <button onClick={() => void toggle(f, !f.is_enabled)} style={secondaryButtonStyle}>
                    {f.is_enabled ? 'Désactiver' : 'Activer'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SearchTab(): React.JSX.Element {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = async (): Promise<void> => {
    setError(null);
    try {
      setRows((await api('GET', `/support/search?q=${encodeURIComponent(q)}`)) as SearchRow[]);
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Error');
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', gap: tokens.spacing.sm, flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="organisation, enfant, email…" style={{ ...inputStyle, maxWidth: 420 }} />
        <button onClick={() => void search()} style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}>Rechercher</button>
      </div>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {/* Tables larges : défilement horizontal plutôt que débordement hors écran. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', marginTop: 16, fontSize: 14 }}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th><th style={thStyle}>Libellé</th><th style={thStyle}>Organisation</th><th style={thStyle}>ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} style={{ borderBottom: `1px solid ${tokens.colors.border}` }}>
                <td style={tdStyle}>{r.kind}</td>
                <td style={tdStyle}>{r.label}</td>
                <td style={tdStyle}>{r.org_slug ?? '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{r.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobsTab(): React.JSX.Element {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api('GET', '/support/jobs').then((r) => setJobs(r as JobRow[])).catch((e: unknown) => setError((e as { message?: string }).message ?? 'Error'));
  };
  useEffect(load, []);

  const retry = async (id: string): Promise<void> => {
    setError(null);
    try {
      await api('POST', `/support/jobs/${id}/retry`, {});
      load();
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Error');
    }
  };

  const color = (s: string): string => (s === 'done' ? tokens.colors.success : s === 'failed' ? tokens.colors.danger : s === 'processing' ? tokens.colors.info : tokens.colors.warning);

  return (
    <section>
      <button onClick={load} style={{ ...buttonStyle, width: 'auto', marginTop: 0, marginBottom: 12 }}>Actualiser</button>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {/* Tables larges : défilement horizontal plutôt que débordement hors écran. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th><th style={thStyle}>Statut</th><th style={thStyle}>Org</th><th style={thStyle}>Essais</th><th style={thStyle}>Erreur</th><th style={thStyle}>Créé le</th><th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} style={{ borderBottom: `1px solid ${tokens.colors.border}` }}>
                <td style={tdStyle}>{j.job_type}</td>
                <td style={{ ...tdStyle, color: color(j.status), fontWeight: 600 }}>{j.status}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{j.organization_id?.slice(0, 8) ?? '—'}</td>
                <td style={tdStyle}>{j.attempts}/{j.max_attempts}</td>
                <td style={{ ...tdStyle, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.failure_reason ?? '—'}</td>
                <td style={tdStyle}>{new Date(j.created_at).toLocaleString('fr-FR')}</td>
                <td style={tdStyle}>
                  {(j.status === 'failed' || j.status === 'pending') && (
                    <button onClick={() => void retry(j.id)} style={secondaryButtonStyle}>Retry</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImpersonateTab(): React.JSX.Element {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const impersonate = async (): Promise<void> => {
    setError(null);
    setResult(null);
    try {
      const r = (await api('POST', '/support/impersonate', { user_id: userId, reason })) as { access_token: string };
      setResult(r.access_token);
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Error');
    }
  };

  return (
    <section style={{ maxWidth: 520 }}>
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>ID utilisateur cible</label>
      <input value={userId} onChange={(e) => setUserId(e.target.value)} style={inputStyle} />
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>Motif (obligatoire, journalisé en audit)</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
      <button onClick={() => void impersonate()} disabled={!userId || !reason} style={{ ...buttonStyle, width: 'auto' }}>Impersonner</button>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 16, background: tokens.colors.surfaceAlt, border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.sm, padding: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13 }}>Jeton d'impersonation (15 min) — l'action est tracée dans audit_logs :</p>
          <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{result}</code>
        </div>
      )}
    </section>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: `2px solid ${tokens.colors.border}`,
  color: tokens.colors.textMuted,
  fontSize: tokens.typography.small,
  whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = { padding: '8px 10px' };
