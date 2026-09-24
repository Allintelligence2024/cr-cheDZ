/**
 * Design tokens partagés (web) — thème « Sérénité ».
 *
 * Les couleurs ne sont PAS des littéraux : ce sont des références `var(--c-*)`
 * résolues par `theme.css`. Conséquence directe : tout style inline existant
 * (`color: tokens.colors.textMuted`) devient automatiquement sensible au thème
 * clair/sombre, sans toucher aux 23 écrans.
 *
 * ⚠️ Ces valeurs ne sont donc utilisables QUE dans un contexte CSS (style
 * React, feuille de style). Pour un contexte qui exige une couleur calculable
 * — canvas, génération de PDF, balise <meta theme-color> — utiliser
 * `paletteHex` plus bas, qui conserve les valeurs brutes.
 */

const ref = (name: string): string => `var(--${name})`;

export const tokens = {
  colors: {
    /* Accent */
    primary: ref('c-primary'),
    primaryDark: ref('c-primary-hover'),
    primaryActive: ref('c-primary-active'),
    primaryContrast: ref('c-primary-contrast'),
    primarySoft: ref('c-primary-soft'),
    primaryBorder: ref('c-primary-border'),

    /* Surfaces */
    background: ref('c-background'),
    surface: ref('c-surface'),
    surfaceAlt: ref('c-surface-alt'),
    surfaceHover: ref('c-surface-hover'),

    /* Texte */
    text: ref('c-text'),
    textMuted: ref('c-text-muted'),
    textFaint: ref('c-text-faint'),

    /* Traits */
    border: ref('c-border'),
    borderStrong: ref('c-border-strong'),

    /* États */
    success: ref('c-success'),
    successBg: ref('c-success-bg'),
    successBorder: ref('c-success-border'),
    warning: ref('c-warning'),
    warningBg: ref('c-warning-bg'),
    warningBorder: ref('c-warning-border'),
    danger: ref('c-danger'),
    dangerBg: ref('c-danger-bg'),
    dangerBorder: ref('c-danger-border'),
    info: ref('c-info'),
    infoBg: ref('c-info-bg'),
    infoBorder: ref('c-info-border'),
  },
  shadows: {
    sm: ref('c-shadow-sm'),
    md: ref('c-shadow-md'),
    lg: ref('c-shadow-lg'),
    focus: ref('c-shadow-focus'),
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  /* Rayons généreux : signature « Sérénité ». */
  radius: { sm: 10, md: 14, lg: 18, pill: 999 },
  typography: {
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    h1: '24px',
    h2: '18px',
    body: '14px',
    small: '12px',
  },
} as const;

/**
 * Valeurs brutes, hors CSS (thème clair). Nécessaires là où `var()` ne peut
 * pas être résolu : `<meta name="theme-color">`, canvas, export PDF.
 */
export const paletteHex = {
  light: {
    primary: '#0F766E',
    background: '#F4F7F5',
    surface: '#FFFFFF',
    text: '#12211F',
  },
  dark: {
    primary: '#2DD4BF',
    background: '#0B1413',
    surface: '#121D1B',
    text: '#E8F1EE',
  },
} as const;

export type ThemeMode = 'light' | 'dark' | 'system';
