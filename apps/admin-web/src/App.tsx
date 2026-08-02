import { NavLink, Navigate, Route, Routes } from 'react-router';
import React, { lazy, Suspense } from 'react';
import { tokens } from '@creche/design-system';
import { useAuth } from './auth/AuthContext';
import { useI18n } from './i18n';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import { InvitationsPage } from './pages/InvitationsPage';
import { LoginPage } from './pages/LoginPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { RoomsPage } from './pages/RoomsPage';
import { SitesPage } from './pages/SitesPage';
import { StaffPage } from './pages/StaffPage';

// Chargement différé des écrans Phase 9 (bundle < 250 Ko gzip, critère perf).
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AttendancePage = lazy(() => import('./pages/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const JournalPage = lazy(() => import('./pages/JournalPage').then((m) => ({ default: m.JournalPage })));
const MediaPage = lazy(() => import('./pages/MediaPage').then((m) => ({ default: m.MediaPage })));
const MessagingPage = lazy(() => import('./pages/MessagingPage').then((m) => ({ default: m.MessagingPage })));
const ExportsPage = lazy(() => import('./pages/ExportsPage').then((m) => ({ default: m.ExportsPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then((m) => ({ default: m.BillingPage })));
const ChildrenPage = lazy(() => import('./pages/ChildrenPage').then((m) => ({ default: m.ChildrenPage })));
const CompliancePage = lazy(() => import('./pages/CompliancePage').then((m) => ({ default: m.CompliancePage })));
const HealthPage = lazy(() => import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage').then((m) => ({ default: m.OrgSettingsPage })));

function Layout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { logout, user } = useAuth();
  const { t, locale, setLocale, dir } = useI18n();

  const navItems = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/attendance', label: t('nav.attendance') },
    { to: '/journal', label: t('nav.journal') },
    { to: '/media', label: t('nav.media') },
    { to: '/messaging', label: t('nav.messaging') },
    { to: '/exports', label: t('nav.exports') },
    { to: '/privacy', label: t('nav.privacy') },
    { to: '/billing', label: t('nav.billing') },
    { to: '/health', label: t('nav.health') },
    { to: '/compliance', label: t('nav.compliance') },
    { to: '/sites', label: t('nav.sites') },
    { to: '/rooms', label: t('nav.rooms') },
    { to: '/children', label: t('nav.children') },
    { to: '/staff', label: t('nav.staff') },
    { to: '/invitations', label: t('nav.invitations') },
    { to: '/settings', label: t('nav.settings') },
    ...(user?.is_super_admin ? [{ to: '/organizations', label: t('nav.organizations') }] : []),
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: tokens.typography.fontFamily, background: tokens.colors.background }} dir={dir}>
      <aside style={{ width: 240, background: '#0F172A', color: '#fff', padding: tokens.spacing.md, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: 15, margin: '0 0 24px', padding: '8px 4px' }}>🏫 {t('app.title')}</h1>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                color: isActive ? '#fff' : '#94A3B8',
                textDecoration: 'none',
                padding: '10px 12px',
                borderRadius: 8,
                background: isActive ? tokens.colors.primary : 'transparent',
                fontSize: 14,
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => setLocale(locale === 'fr' ? 'ar' : 'fr')}
            style={{ background: 'transparent', border: `1px solid #334155`, color: '#E2E8F0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
          >
            {locale === 'fr' ? 'العربية' : 'Français'}
          </button>
          <button
            onClick={() => void logout()}
            style={{ background: 'transparent', border: 'none', color: '#F87171', textAlign: 'left', padding: '8px 12px', cursor: 'pointer' }}
          >
            ← {t('nav.logout')}
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: tokens.spacing.lg }}>
        <Suspense fallback={<div style={{ padding: 48 }}>{t('common.loading')}</div>}>{children}</Suspense>
      </main>
    </div>
  );
}

export function AppRoutes(): React.JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 48, fontFamily: tokens.typography.fontFamily }}>Chargement…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/messaging" element={<MessagingPage />} />
        <Route path="/exports" element={<ExportsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/children" element={<ChildrenPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/invitations" element={<InvitationsPage />} />
        <Route path="/settings" element={<OrgSettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
