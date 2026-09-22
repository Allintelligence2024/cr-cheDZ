import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import React, { lazy, Suspense } from 'react';
import { ThemeToggle, tokens } from '@creche/design-system';
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
  const location = useLocation();

  // Le tiroir mobile se referme à chaque navigation (sinon il masque l'écran
  // d'arrivée) et à la touche Échap.
  React.useEffect(() => setNavOpen(false), [location.pathname]);

  React.useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
    <div className={`layout ${navOpen ? 'sidebar-open' : ''}`} style={{ fontFamily: tokens.typography.fontFamily }} dir={dir}>
      <aside className={`layout-sidebar ${navOpen ? 'open' : ''}`}>
        <h1>
          <span className="brand-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
            </svg>
          </span>
          <span className="app-name">{t('app.title')}</span>
        </h1>

        <ThemeToggle compact />

        <button
          className="layout-burger"
          onClick={() => setNavOpen(!navOpen)}
          aria-label="Menu"
          aria-expanded={navOpen}
        >
          {navOpen ? '✕' : '☰'}
        </button>

        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={closeNav}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={() => setLocale(locale === 'fr' ? 'ar' : 'fr')}>
            {locale === 'fr' ? 'العربية' : 'Français'}
          </button>
          <button className="danger" onClick={() => void logout()}>
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Voile : referme le tiroir au clic en dehors (mobile uniquement). */}
      <div className="layout-scrim" onClick={closeNav} aria-hidden="true" />

      <main className="layout-main">
        <Suspense fallback={<div style={{ padding: 48, color: tokens.colors.textMuted }}>{t('common.loading')}</div>}>
          {children}
        </Suspense>
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
