/** ESLint flat config partagé (JS/TS) */
export default [
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', '*.g.dart', '*.g.mjs'],
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
    },
  },
];
