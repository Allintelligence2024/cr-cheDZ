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
};
