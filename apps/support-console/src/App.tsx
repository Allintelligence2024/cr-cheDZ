import React from 'react';
import { useEffect, useState } from 'react';

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
      setError(e.message ?? 'Connexion refusée');
    }
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 380, margin: '80px auto', padding: 24, border: '1px solid #E2E8F0', borderRadius: 12 }}>
      <h1>🛠 Crèche SaaS — Console support</h1>
      <p style={{ color: '#64748B', fontSize: 13 }}>Accès restreint équipe interne (super_admin).</p>
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" />
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>Mot de passe</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
      <button onClick={() => void submit()} style={buttonStyle}>Se connecter</button>
    </main>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #CBD5E1', boxSizing: 'border-box' };
const buttonStyle: React.CSSProperties = { marginTop: 16, width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: '#0F172A', color: '#fff', fontWeight: 600, cursor: 'pointer' };
const tabStyle = (active: boolean): React.CSSProperties => ({ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, background: active ? '#0F172A' : '#E2E8F0', color: active ? '#fff' : '#0F172A' });

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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>🛠 Console support</h1>
        <button onClick={logout} style={{ ...buttonStyle, width: 'auto', marginTop: 0, background: '#DC2626' }}>Déconnexion</button>
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
    api('GET', '/support/pilot-summary').then((r) => setRows(r as PilotRow[])).catch((e: unknown) => setError(e.message));
  };
  useEffect(load, []);

  const total = (k: keyof PilotRow): number => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const pilots = rows.filter((r) => r.org_slug.startsWith('pilot-'));

  return (
    <section>
      <button onClick={load} style={{ ...buttonStyle, width: 'auto', marginTop: 0, marginBottom: 12 }}>Actualiser</button>
      {error && <p style={{ color: '#DC2626' }}>{error}</p>}
      {pilots.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            ['Pointages aujourd\u2019hui', total('checkins_today')],
            ['Sync ops 24 h', total('sync_ops_24h')],
            ['Événements journal aujourd\u2019hui', total('journal_events_today')],
            ['Enfants actifs', total('children_active')],
            ['Jobs en échec 24 h', total('jobs_failed_24h')],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>{label}</div>
            </div>
          ))}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Organisation</th><th style={thStyle}>Enfants actifs</th><th style={thStyle}>Pointages aujourd\u2019hui</th>
            <th style={thStyle}>Sync 24 h</th><th style={thStyle}>Journal aujourd\u2019hui</th><th style={thStyle}>Factures impayées</th><th style={thStyle}>Jobs échoués 24 h</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.org_slug} style={{ borderBottom: '1px solid #E2E8F0', background: r.org_slug.startsWith('pilot-') ? '#F0FDF4' : undefined }}>
              <td style={tdStyle}>{r.org_slug} {r.org_slug.startsWith('pilot-') && '🎯'}</td>
              <td style={tdStyle}>{r.children_active}</td>
              <td style={tdStyle}>{r.checkins_today}</td>
              <td style={tdStyle}>{r.sync_ops_24h}</td>
              <td style={tdStyle}>{r.journal_events_today}</td>
              <td style={{ ...tdStyle, color: r.invoices_unpaid > 0 ? '#B45309' : '#16A34A' }}>{r.invoices_unpaid}</td>
              <td style={{ ...tdStyle, color: r.jobs_failed_24h > 0 ? '#DC2626' : '#16A34A' }}>{r.jobs_failed_24h}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FlagsTab(): React.JSX.Element {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api('GET', '/support/flags').then((r) => setFlags(r as FlagRow[])).catch((e: unknown) => setError(e.message));
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
      setError(e.message);
    }
  };

  return (
    <section>
      <button onClick={load} style={{ ...buttonStyle, width: 'auto', marginTop: 0, marginBottom: 12 }}>Actualiser</button>
      {error && <p style={{ color: '#DC2626' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Flag</th><th style={thStyle}>Description</th><th style={thStyle}>Organisation</th><th style={thStyle}>État</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={`${f.flag_key}-${f.organization_id ?? 'global'}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
              <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{f.flag_key}</td>
              <td style={tdStyle}>{f.description ?? '—'}</td>
              <td style={tdStyle}>{f.org_slug ?? '🌐 global'}</td>
              <td style={{ ...tdStyle, color: f.is_enabled ? '#16A34A' : '#DC2626', fontWeight: 600 }}>{f.is_enabled ? 'ON' : 'OFF'}</td>
              <td style={tdStyle}>
                <button onClick={() => void toggle(f, !f.is_enabled)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #CBD5E1', cursor: 'pointer', background: '#fff' }}>
                  {f.is_enabled ? 'Désactiver' : 'Activer'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      setError(e.message);
    }
  };

  return (
    <section>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="organisation, enfant, email…" style={{ ...inputStyle, maxWidth: 420 }} />
        <button onClick={() => void search()} style={{ ...buttonStyle, width: 'auto', marginTop: 0 }}>Rechercher</button>
      </div>
      {error && <p style={{ color: '#DC2626' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16, fontSize: 14 }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>Libellé</th><th style={thStyle}>Organisation</th><th style={thStyle}>ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.id}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
              <td style={tdStyle}>{r.kind}</td>
              <td style={tdStyle}>{r.label}</td>
              <td style={tdStyle}>{r.org_slug ?? '—'}</td>
              <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{r.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function JobsTab(): React.JSX.Element {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api('GET', '/support/jobs').then((r) => setJobs(r as JobRow[])).catch((e: unknown) => setError(e.message));
  };
  useEffect(load, []);

  const retry = async (id: string): Promise<void> => {
    setError(null);
    try {
      await api('POST', `/support/jobs/${id}/retry`, {});
      load();
    } catch (e: unknown) {
      setError(e.message);
    }
  };

  const color = (s: string): string => (s === 'done' ? '#16A34A' : s === 'failed' ? '#DC2626' : s === 'processing' ? '#2563EB' : '#B45309');

  return (
    <section>
      <button onClick={load} style={{ ...buttonStyle, width: 'auto', marginTop: 0, marginBottom: 12 }}>Actualiser</button>
      {error && <p style={{ color: '#DC2626' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>Statut</th><th style={thStyle}>Org</th><th style={thStyle}>Essais</th><th style={thStyle}>Erreur</th><th style={thStyle}>Créé le</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
              <td style={tdStyle}>{j.job_type}</td>
              <td style={{ ...tdStyle, color: color(j.status), fontWeight: 600 }}>{j.status}</td>
              <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{j.organization_id?.slice(0, 8) ?? '—'}</td>
              <td style={tdStyle}>{j.attempts}/{j.max_attempts}</td>
              <td style={{ ...tdStyle, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.failure_reason ?? '—'}</td>
              <td style={tdStyle}>{new Date(j.created_at).toLocaleString('fr-FR')}</td>
              <td style={tdStyle}>
                {(j.status === 'failed' || j.status === 'pending') && (
                  <button onClick={() => void retry(j.id)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #CBD5E1', cursor: 'pointer', background: '#fff' }}>Retry</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      setError(e.message);
    }
  };

  return (
    <section style={{ maxWidth: 520 }}>
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>ID utilisateur cible</label>
      <input value={userId} onChange={(e) => setUserId(e.target.value)} style={inputStyle} />
      <label style={{ display: 'block', margin: '12px 0 4px', fontSize: 13 }}>Motif (obligatoire, journalisé en audit)</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
      <button onClick={() => void impersonate()} disabled={!userId || !reason} style={{ ...buttonStyle, width: 'auto' }}>Impersonner</button>
      {error && <p style={{ color: '#DC2626' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13 }}>Jeton d'impersonation (15 min) — l'action est tracée dans audit_logs :</p>
          <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{result}</code>
        </div>
      )}
    </section>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #E2E8F0', color: '#64748B', fontSize: 12 };
const tdStyle: React.CSSProperties = { padding: '8px 10px' };
