import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './App';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n';

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
