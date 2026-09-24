import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { paletteHex, type ThemeMode } from './tokens';

/**
 * Gestion du thème clair / sombre / système.
 *
 * - `mode`     : le choix de l'utilisateur ('light' | 'dark' | 'system').
 * - `resolved` : ce qui est réellement affiché ('light' | 'dark'), après
 *                résolution de la préférence système.
 *
 * Le choix est persisté dans localStorage sous `creche_theme` — la même clé
 * que celle lue par le script anti-flash injecté dans index.html.
 */

const STORAGE_KEY = 'creche_theme';

interface ThemeValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
  /** Bascule directe clair ⇄ sombre (sort du mode 'system'). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => undefined,
  toggle: () => undefined,
});

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

const readStored = (): ThemeMode => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage indisponible (mode privé strict) : on reste en 'system'. */
  }
  return 'system';
};

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(readStored);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  /* Suivre la préférence système tant que l'utilisateur est en mode 'system'. */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  /* Appliquer sur <html> + synchroniser la barre d'adresse mobile. */
  useEffect(() => {
    const root = document.documentElement;

    /* Couper les transitions le temps de la bascule : sinon toute la page
       « fond » pendant 150 ms, ce qui donne une impression de lenteur. */
    root.classList.add('theme-switching');
    root.dataset.theme = resolved;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', paletteHex[resolved].background);

    const id = window.setTimeout(() => root.classList.remove('theme-switching'), 200);
    return () => window.clearTimeout(id);
  }, [resolved]);

  const setMode = useCallback((m: ThemeMode): void => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* Persistance best-effort. */
    }
  }, []);

  const toggle = useCallback((): void => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const value = useMemo<ThemeValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/**
 * Script anti-flash (FOUC).
 *
 * À injecter en `<head>`, AVANT tout rendu : il pose `data-theme` sur <html>
 * dès le parsing, donc la première peinture est déjà à la bonne couleur.
 * Sans lui, un utilisateur en thème sombre voit un flash blanc au chargement.
 */
export const themeBootScript = `(function(){try{
var m=localStorage.getItem('${STORAGE_KEY}')||'system';
var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme=d?'dark':'light';
}catch(e){}})();`;

/** Bouton de bascule clair/sombre, accessible et autonome. */
export function ThemeToggle({
  label,
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}): React.JSX.Element {
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  const text = label ?? (dark ? 'Mode clair' : 'Mode sombre');

  return (
    <button
      type="button"
      onClick={toggle}
      className="ds-theme-toggle"
      aria-label={text}
      title={text}
      aria-pressed={dark}
    >
      {dark ? (
        /* Soleil — cliquer repasse en clair */
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </svg>
      ) : (
        /* Lune — cliquer passe en sombre */
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8z" />
        </svg>
      )}
      {!compact && <span>{text}</span>}
    </button>
  );
}
