/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  /** '1' = affiche l'invite des comptes démo sur l'écran de connexion (aperçu). */
  readonly VITE_PREVIEW_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
