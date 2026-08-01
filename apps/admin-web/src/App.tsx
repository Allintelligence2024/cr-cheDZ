import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import React from 'react';
import { tokens } from '@creche/design-system';
import { useAuth } from './auth/AuthContext';
import { useI18n } from './i18n';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage';
import { ChildrenPage } from './pages/ChildrenPage';
import { DashboardPage } from './pages/DashboardPage';
import { InvitationsPage } from './pages/InvitationsPage';
import { LoginPage } from './pages/LoginPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { RoomsPage } from './pages/RoomsPage';
import { SitesPage } from './pages/SitesPage';
import { StaffPage } from './pages/StaffPage';

function Layout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { logout, user } = useAuth();
  const { t, locale, setLocale, dir } = useI18n();

  const navItems = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/sites', label: t('nav.sites') },
    { to: '/rooms', label: t('nav.rooms') },
    { to: '/children', label: t('nav.children') },
    { to: '/staff', label: t('nav.staff') },
    { to: '/invitations', label: t('nav.invitations') },
    ...(user?.is_super_admin ? [{ to: '/organizations', label: t('nav.organizations') }] : []),
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: tokens.typography.fontFamily, background: tokens.colors.background }} dir={dir}>
      <aside style={{ width: 240, background: '#0F172A', color: '#fff', padding: tokens.spacing.md }}>
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
      <main style={{ flex: 1, padding: tokens.spacing.lg }}>{children}</main>
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
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/children" element={<ChildrenPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/invitations" element={<InvitationsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
