import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import * as Sentry from '@sentry/react';
import './styles.css';
import { AppRoutes } from './App';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n';

// Sentry (Phase 11) : activé uniquement si VITE_SENTRY_DSN est défini au build.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN as string,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container manquant');
createRoot(container).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
);
