/**
 * Jest — tests unitaires du worker (ts-jest, ESM-friendly).
 *
 * Le worker n'avait AUCUNE porte de tests unitaires avant le lot 6.1
 * (audit 2026-09-24) : la sonde de vivacité et son marqueur sont désormais
 * prouvés par des tests exécutés en CI (`npm run test:unit` à la racine).
 * Pas de couverture ici : le cliquet de couverture reste porté par l'API,
 * dont le périmètre de mesure n'est pas modifié par ce lot.
 */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, target: 'es2022' } }],
  },
};
