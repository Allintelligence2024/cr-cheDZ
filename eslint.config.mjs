// ESLint flat config minimal (audit, étape 4.3) — remplace le script `lint`
// mensonger d'avant (eslint . sans config ni dépendance) par une config
// RÉELLE : base JS recommended + typescript-eslint recommended, focus sur les
// règles utiles au projet. no-explicit-any est en WARN (backend historique) :
// chaque warn est un candidat de nettoyage, jamais un faux vert.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.mjs', // scripts de validation et suites .api.test.mjs : code d'outillage Node pur
      'apps/parent-mobile/**',
      'apps/staff-mobile/**',
      'apps/admin-web/e2e/**',
      'tests/load/**', // scripts k6 (globales __ENV/__VU) — hors périmètre audit (PAS FAIRE)
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Audit 4.3 : any explicite en WARN partout (74 sites historiques à
      // éteindre progressivement — jamais de faux vert, jamais de blocage).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
);
