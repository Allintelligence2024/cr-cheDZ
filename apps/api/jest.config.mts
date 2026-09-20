/** Jest — tests unitaires API (ts-jest, ESM-friendly). */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, target: 'es2022' } }],
  },
  // B1 : les specs importent @creche/prod-config, dont le `main` pointe vers
  // dist/ (construit seulement par le build API). Mapper vers la source TS
  // rend les tests unitaires indépendants d'un build préalable.
  moduleNameMapper: {
    '^@creche/prod-config$': '<rootDir>/../../packages/prod-config/src/index.ts',
  },

  // P1-4 (piliers manquants) : couverture MESURÉE et HONNÊTE.
  // `collectCoverageFrom` couvre tout src/ (pas seulement les fichiers
  // importés par les specs) : le chiffre global est bas (~5 %) parce que la
  // vérification de ce dépôt repose d'abord sur les suites d'intégration
  // (Gate D : 61 suites sur PostgreSQL réel, e2e Playwright) — ce n'est pas
  // un chiffre à « embellir » en changeant le périmètre.
  // Les seuils sont des CLIQUETS : global = plancher anti-érosion ; par
  // fichier = unités de sécurité/argent déjà couvertes, qui ne doivent pas
  // régresser (on relève le seuil quand on ajoute des tests, jamais l'inverse).
  // Sémantique Jest : les fichiers listés individuellement sont RETIRÉS du
  // calcul « global » — le plancher global porte donc sur le RESTE du code
  // (~1,4 % de lignes au moment de l'écriture : chiffre honnête, cf. résumé
  // text-summary qui, lui, inclut tout).
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/dto/**',
  ],
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: { lines: 1, statements: 1, branches: 0.2, functions: 1 },
    './src/shared/database/tenant-context.service.ts': { lines: 95, branches: 90 },
    './src/shared/auth/principal-epoch.ts': { lines: 95, branches: 90 },
    './src/shared/auth/totp-crypto.ts': { lines: 95, branches: 80 },
    './src/shared/email/email.service.ts': { lines: 80, branches: 60 },
    './src/modules/billing/payment-provider.service.ts': { lines: 90, branches: 60 },
    './src/modules/billing/receipt.ts': { lines: 100, branches: 100 },
  },
};
