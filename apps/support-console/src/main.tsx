import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@creche/design-system';
import '@creche/design-system/theme.css';
import '@creche/design-system/base.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root container manquant');
createRoot(container).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
