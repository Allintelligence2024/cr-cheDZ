import { NavLink, Navigate, Route, Routes } from 'react-router';
import React, { lazy, Suspense } from 'react';
import { tokens } from '@creche/design-system';
import { useAuth } from './auth/AuthContext';
import { canAccess, homeFor } from './auth/routeAccess';
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
const PayrollPage = lazy(() => import('./pages/PayrollPage').then((m) => ({ default: m.PayrollPage })));
const VideoPage = lazy(() => import('./pages/VideoPage').then((m) => ({ default: m.VideoPage })));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then((m) => ({ default: m.MarketplacePage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then((m) => ({ default: m.BillingPage })));
const ChildrenPage = lazy(() => import('./pages/ChildrenPage').then((m) => ({ default: m.ChildrenPage })));
const CompliancePage = lazy(() => import('./pages/CompliancePage').then((m) => ({ default: m.CompliancePage })));
const HealthPage = lazy(() => import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage').then((m) => ({ default: m.OrgSettingsPage })));

function Layout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { logout, user } = useAuth();
  const { t, locale, setLocale, dir } = useI18n();
  const [navOpen, setNavOpen] = React.useState(false);

  const navItems = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/attendance', label: t('nav.attendance') },
    { to: '/journal', label: t('nav.journal') },
    { to: '/media', label: t('nav.media') },
    { to: '/messaging', label: t('nav.messaging') },
    { to: '/exports', label: t('nav.exports') },
    { to: '/privacy', label: t('nav.privacy') },
    { to: '/payroll', label: t('nav.payroll') },
    { to: '/video', label: t('nav.video') },
    { to: '/marketplace', label: t('nav.marketplace') },
    { to: '/billing', label: t('nav.billing') },
    { to: '/health', label: t('nav.health') },
    { to: '/compliance', label: t('nav.compliance') },
    { to: '/sites', label: t('nav.sites') },
    { to: '/rooms', label: t('nav.rooms') },
    { to: '/children', label: t('nav.children') },
    { to: '/staff', label: t('nav.staff') },
    { to: '/invitations', label: t('nav.invitations') },
    { to: '/settings', label: t('nav.settings') },
    { to: '/organizations', label: t('nav.organizations') },
    // F3 : le menu ne propose que les écrans visibles pour le rôle courant
    // (miroir des @Roles serveur — l'autorisation reste côté API).
  ].filter((item) => canAccess(user, item.to));

  const closeNav = (): void => setNavOpen(false);

  return (
    <div className={`layout ${navOpen ? 'sidebar-open' : ''}`} style={{ fontFamily: tokens.typography.fontFamily, background: tokens.colors.background }} dir={dir}>
      <aside className={`layout-sidebar ${navOpen ? 'open' : ''}`}>
        <h1 style={{ fontSize: 15, padding: '8px 4px' }}>🏫 {t('app.title')}</h1>
        <button className="layout-burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">
          {navOpen ? '✕' : '☰'}
        </button>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={closeNav}
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
        <div className="sidebar-footer" style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
      <main className="layout-main">
        <Suspense fallback={<div style={{ padding: 48 }}>{t('common.loading')}</div>}>{children}</Suspense>
      </main>
    </div>
  );
}

/** F3 : écran refusé pour le rôle → renvoi vers le premier écran accessible. */
function RequireRole({ path, children }: { path: string; children: React.ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  if (!canAccess(user, path)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
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
        <Route path="/" element={<RequireRole path="/"><DashboardPage /></RequireRole>} />
        <Route path="/attendance" element={<RequireRole path="/attendance"><AttendancePage /></RequireRole>} />
        <Route path="/journal" element={<RequireRole path="/journal"><JournalPage /></RequireRole>} />
        <Route path="/media" element={<RequireRole path="/media"><MediaPage /></RequireRole>} />
        <Route path="/messaging" element={<RequireRole path="/messaging"><MessagingPage /></RequireRole>} />
        <Route path="/exports" element={<RequireRole path="/exports"><ExportsPage /></RequireRole>} />
        <Route path="/privacy" element={<RequireRole path="/privacy"><PrivacyPage /></RequireRole>} />
        <Route path="/payroll" element={<RequireRole path="/payroll"><PayrollPage /></RequireRole>} />
        <Route path="/video" element={<RequireRole path="/video"><VideoPage /></RequireRole>} />
        <Route path="/marketplace" element={<RequireRole path="/marketplace"><MarketplacePage /></RequireRole>} />
        <Route path="/billing" element={<RequireRole path="/billing"><BillingPage /></RequireRole>} />
        <Route path="/health" element={<RequireRole path="/health"><HealthPage /></RequireRole>} />
        <Route path="/compliance" element={<RequireRole path="/compliance"><CompliancePage /></RequireRole>} />
        <Route path="/organizations" element={<RequireRole path="/organizations"><OrganizationsPage /></RequireRole>} />
        <Route path="/sites" element={<RequireRole path="/sites"><SitesPage /></RequireRole>} />
        <Route path="/rooms" element={<RequireRole path="/rooms"><RoomsPage /></RequireRole>} />
        <Route path="/children" element={<RequireRole path="/children"><ChildrenPage /></RequireRole>} />
        <Route path="/staff" element={<RequireRole path="/staff"><StaffPage /></RequireRole>} />
        <Route path="/invitations" element={<RequireRole path="/invitations"><InvitationsPage /></RequireRole>} />
        <Route path="/settings" element={<RequireRole path="/settings"><OrgSettingsPage /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
