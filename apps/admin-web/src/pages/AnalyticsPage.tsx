import React, { useEffect, useState } from 'react';
import { Card, Button, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface OverviewKpis {
  children_active: number;
  capacity_total: number;
  occupancy_rate: number;
  attendance_today: { present: number; expected: number; departed: number; absent: number; total: number };
  billing_month: { invoiced: number; paid: number; balance: number; count: number; overdue: number; sent: number; partially_paid: number; paid_count: number };
  aged_balance: { d0_30: number; d31_60: number; d61_90: number; d90: number; total: number };
  staff: { total: number; active: number };
  incidents_7d: { total: number; critical: number };
}

interface OverviewResponse {
  date: string;
  kpis: OverviewKpis;
}

interface TrendPoint {
  period: string;
  present?: number;
  absent?: number;
  expected?: number;
  departed?: number;
  invoiced?: number;
  paid?: number;
  balance?: number;
  revenue?: number;
  count?: number;
}

interface OccupancyResponse {
  sites: Array<{ id: string; name_fr: string; capacity: number; enrolled: number }>;
  rooms: Array<{ id: string; name_fr: string; site_name: string; max_capacity: number; enrolled: number }>;
}

function KpiCard({ icon, label, value, sub, color, trend }: { icon: string; label: string; value: string | number; sub?: string; color: string; trend?: string }) {
  return (
    <div style={{ border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.lg, padding: 16, background: `linear-gradient(135deg, ${color}08, ${color}15)`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -10, right: -10, fontSize: 48, opacity: 0.08 }}>{icon}</div>
      <div style={{ fontSize: 11, color: tokens.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, margin: '6px 0', color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: tokens.colors.textMuted }}>{sub}</div>}
      {trend && <div style={{ fontSize: 11, marginTop: 6, color: trend.startsWith('+') ? tokens.colors.success : tokens.colors.danger, fontWeight: 600 }}>{trend}</div>}
    </div>
  );
}

function BarChart({ data, valueKey, color }: { data: TrendPoint[]; valueKey: keyof TrendPoint; color: string }) {
  if (data.length === 0) return <p style={{ color: tokens.colors.textMuted }}>Aucune donnée</p>;
  const max = Math.max(...data.map((d) => Number(d[valueKey] ?? 0)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, padding: '0 4px' }}>
      {data.map((d, i) => {
        const v = Number(d[valueKey] ?? 0);
        const h = (v / max) * 100;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div title={`${d.period}: ${v}`} style={{ width: '100%', height: `${h}%`, minHeight: 4, background: `linear-gradient(to top, ${color}, ${color}aa)`, borderRadius: 6, transition: 'height 0.4s ease' }} />
            <span style={{ fontSize: 9, color: tokens.colors.textFaint, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{String(d.period).slice(5, 10)}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ data, keys, colors }: { data: TrendPoint[]; keys: (keyof TrendPoint)[]; colors: string[] }) {
  if (data.length === 0) return <p style={{ color: tokens.colors.textMuted }}>Aucune donnée</p>;
  const max = Math.max(...data.flatMap((d) => keys.map((k) => Number(d[k] ?? 0))), 1);
  const width = 600;
  const height = 140;
  const padding = 20;

  const points = (key: keyof TrendPoint) =>
    data
      .map((d, i) => {
        const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
        const y = height - padding - (Number(d[key] ?? 0) / max) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} style={{ minWidth: '100%' }}>
        {/* grid */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={padding} y1={padding + (i * (height - padding * 2)) / 4} x2={width - padding} y2={padding + (i * (height - padding * 2)) / 4} stroke={tokens.colors.border} strokeWidth={0.5} strokeDasharray="3 3" />
        ))}
        {keys.map((k, idx) => (
          <polyline key={String(k)} fill="none" stroke={colors[idx]} strokeWidth={2.5} points={points(k)} strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {keys.map((k, idx) => (
          <span key={String(k)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ width: 10, height: 10, background: colors[idx], borderRadius: 2, display: 'inline-block' }} /> {String(k)}
          </span>
        ))}
      </div>
    </div>
  );
}

function OccupancyBar({ label, enrolled, capacity }: { label: string; enrolled: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min((enrolled / capacity) * 100, 100) : 0;
  const color = pct > 90 ? tokens.colors.danger : pct > 75 ? tokens.colors.warning : tokens.colors.success;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: tokens.colors.textMuted }}>{enrolled}/{capacity} ({Math.round(pct)}%)</span>
      </div>
      <div style={{ height: 8, background: tokens.colors.border, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: 8, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function PieAged({ aged }: { aged: OverviewKpis['aged_balance'] }) {
  const total = aged.total || 1;
  const segments = [
    { label: '0-30j', value: aged.d0_30, color: tokens.colors.success },
    { label: '31-60j', value: aged.d31_60, color: '#f59e0b' },
    { label: '61-90j', value: aged.d61_90, color: '#f97316' },
    { label: '90j+', value: aged.d90, color: tokens.colors.danger },
  ];
  let acc = 0;
  const gradient = segments
    .map((s) => {
      const start = (acc / total) * 360;
      acc += s.value;
      const end = (acc / total) * 360;
      return `${s.color} ${start}deg ${end}deg`;
    })
    .join(', ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 100, height: 100, borderRadius: '50%', background: `conic-gradient(${gradient})`, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: 'inline-block' }} /> {s.label}: {Math.round(s.value)} DZD ({Math.round((s.value / total) * 100)}%)
          </span>
        ))}
        <span style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>Total impayé: {Math.round(aged.total)} DZD</span>
      </div>
    </div>
  );
}

export function AnalyticsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [attendance, setAttendance] = useState<TrendPoint[]>([]);
  const [billing, setBilling] = useState<TrendPoint[]>([]);
  const [revenue, setRevenue] = useState<TrendPoint[]>([]);
  const [occupancy, setOccupancy] = useState<OccupancyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      http.get<OverviewResponse>('/analytics/overview'),
      http.get<{ data: TrendPoint[] }>('/analytics/attendance?groupBy=day').then((r) => r.data ?? []),
      http.get<{ data: TrendPoint[] }>('/analytics/billing').then((r) => r.data ?? []),
      http.get<{ data: TrendPoint[] }>('/analytics/revenue').then((r) => r.data ?? []),
      http.get<OccupancyResponse>('/analytics/occupancy'),
    ])
      .then(([ov, att, bill, rev, occ]) => {
        setOverview(ov);
        setAttendance(att as TrendPoint[]);
        setBilling(bill as TrendPoint[]);
        setRevenue(rev as TrendPoint[]);
        setOccupancy(occ);
      })
      .catch((e) => setError(e.messageFr || e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <div style={{ padding: 48, color: tokens.colors.textMuted }}>{t('common.loading')}</div>;
  if (error) return <div style={{ padding: 24 }}><p style={{ color: tokens.colors.danger }}>{error}</p><Button onClick={load}>Réessayer</Button></div>;
  if (!overview) return <div style={{ padding: 24 }}>Aucune donnée</div>;

  const k = overview.kpis;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📊 Analytics Direction — {overview.date}</h2>
          <p style={{ margin: '4px 0 0', color: tokens.colors.textMuted, fontSize: 13 }}>Cockpit premium directrice — réservé rôles director / accountant / super_admin</p>
        </div>
        <Button variant="ghost" onClick={load}>↻ Actualiser</Button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiCard icon="👶" label="Enfants actifs" value={k.children_active} sub={`${k.capacity_total} places totales`} color={tokens.colors.primary} trend={`${k.occupancy_rate}% occupation`} />
        <KpiCard icon="📍" label="Présents aujourd'hui" value={k.attendance_today.present} sub={`${k.attendance_today.expected} attendus, ${k.attendance_today.absent} absents`} color={tokens.colors.success} />
        <KpiCard icon="💰" label="CA mois" value={`${Math.round(k.billing_month.invoiced)} DZD`} sub={`${k.billing_month.count} factures, ${k.billing_month.paid_count} payées`} color="#0f766e" />
        <KpiCard icon="⚠️" label="Impayés" value={`${Math.round(k.aged_balance.total)} DZD`} sub={`${k.billing_month.overdue} en retard`} color={tokens.colors.danger} />
        <KpiCard icon="👥" label="Staff actif" value={k.staff.active} sub={`${k.staff.total} total`} color="#6366f1" />
        <KpiCard icon="🚨" label="Incidents 7j" value={k.incidents_7d.total} sub={`${k.incidents_7d.critical} critiques`} color={k.incidents_7d.critical > 0 ? tokens.colors.danger : tokens.colors.textMuted} />
      </div>

      {/* Attendance + Billing */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="grid-responsive">
        <Card title="📈 Présences — 30 derniers jours">
          <BarChart data={attendance} valueKey="present" color={tokens.colors.success} />
          <div style={{ marginTop: 12, fontSize: 11, color: tokens.colors.textMuted }}>Barres = présents par jour. Source : attendance_sessions</div>
        </Card>
        <Card title="💳 Facturation — par mois">
          <LineChart data={billing} keys={['invoiced', 'paid', 'balance']} colors={[tokens.colors.primary, tokens.colors.success, tokens.colors.danger]} />
          <div style={{ marginTop: 12, fontSize: 11, color: tokens.colors.textMuted }}>Invoiced vs Paid vs Balance — tendance mensuelle</div>
        </Card>
      </div>

      {/* Revenue + Aged */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="grid-responsive">
        <Card title="💵 Revenus encaissés — 90 jours">
          <BarChart data={revenue} valueKey="revenue" color="#0f766e" />
          <div style={{ marginTop: 12, fontSize: 11, color: tokens.colors.textMuted }}>Basé sur payment_allocations (ou invoices paid si table absente)</div>
        </Card>
        <Card title="⏳ Balance âgée">
          <PieAged aged={k.aged_balance} />
        </Card>
      </div>

      {/* Occupancy */}
      <Card title="🏢 Occupation — Sites & Salles (décret 19-253)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }} className="grid-responsive">
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Par site</h4>
            {occupancy?.sites.map((s) => (
              <OccupancyBar key={s.id} label={s.name_fr} enrolled={s.enrolled} capacity={s.capacity} />
            ))}
            {(!occupancy || occupancy.sites.length === 0) && <p style={{ color: tokens.colors.textMuted }}>Aucun site</p>}
          </div>
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Par salle</h4>
            {occupancy?.rooms.slice(0, 8).map((r) => (
              <OccupancyBar key={r.id} label={`${r.name_fr} · ${r.site_name}`} enrolled={r.enrolled} capacity={r.max_capacity} />
            ))}
            {occupancy && occupancy.rooms.length > 8 && <p style={{ fontSize: 11, color: tokens.colors.textMuted }}>+ {occupancy.rooms.length - 8} autres salles</p>}
          </div>
        </div>
        <div style={{ marginTop: 16, padding: 12, background: tokens.colors.background, borderRadius: 8, fontSize: 11, color: tokens.colors.textMuted }}>
          Capacité max : 150 enfants par établissement (décret 19-253). Taux {k.occupancy_rate}% — {k.occupancy_rate > 90 ? '⚠️ Proche limite' : '✅ OK'}.
          151e enfant refusé automatiquement si capacité atteinte.
        </div>
      </Card>

      {/* Footer */}
      <Card title="🔐 Accès & sécurité">
        <p style={{ fontSize: 12, color: tokens.colors.textMuted, margin: 0 }}>
          Cet écran est réservé aux rôles <code>director</code>, <code>accountant</code>, <code>super_admin</code> (RLS + @Roles). 
          Les éducatrices voient le dashboard opérationnel, pas l'analytics financière. 
          Données en temps réel fuseau Alger, RLS tenant forcée, audit via data_access_logs.
          <br />Prochaines étapes : courbe présences mois glissant, export Excel analytics, alertes push ratio breach / impayé critique.
        </p>
      </Card>
    </div>
  );
}
