// FB-B-10 — Lint operativo: flat config mínima y pragmática (eslint 9 + typescript-eslint 8,
// presets "recommended" sin reglas type-checked para mantener el lint rápido).
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Los DTOs Nest usan `propiedad!:` y los accesos a Prisma devuelven tipos amplios;
      // el non-null assertion es un patrón deliberado y puntual en este backend.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Variables/args intencionalmente sin uso se marcan con prefijo _.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
