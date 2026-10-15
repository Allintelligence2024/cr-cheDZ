import { createContext, useContext, useEffect, useState } from 'react';
import React from 'react';
import { dirOf, messages, type Locale } from '@creche/i18n';

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /**
   * Traduit `key` et interpole les jetons `{nom}` présents dans la chaîne.
   * Sans paramètre, le comportement est identique à l'ancien `t(key)` ;
   * une clé inconnue renvoie la clé elle-même (aucune chaîne vide).
   */
  t: (key: string, params?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

/** Remplace les jetons `{nom}` par la valeur fournie ; un jeton sans valeur reste affiché. */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
  );
}

const I18nContext = createContext<I18nValue>({
  locale: 'fr',
  setLocale: () => undefined,
  t: (k) => k,
  dir: 'ltr',
});

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem('creche_locale') as Locale) || 'fr';
  });

  const setLocale = (l: Locale): void => {
    localStorage.setItem('creche_locale', l);
    setLocaleState(l);
  };

  const dir = dirOf(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const value: I18nValue = {
    locale,
    setLocale,
    t: (key: string, params?: Record<string, string | number>) =>
      interpolate(messages[locale][key] ?? key, params),
    dir,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
