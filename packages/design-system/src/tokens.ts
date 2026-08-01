/** Design tokens partagés (web). */
export const tokens = {
  colors: {
    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
    surface: '#FFFFFF',
    background: '#F8FAFC',
    border: '#E2E8F0',
    text: '#0F172A',
    textMuted: '#64748B',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: { sm: 6, md: 10, lg: 16 },
  typography: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    h1: '24px',
    h2: '18px',
    body: '14px',
    small: '12px',
  },
} as const;
