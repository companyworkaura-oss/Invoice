// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Augmenting Express's Request type requires the `declare global { namespace Express {} }` form.
    files: ['src/middleware/auth.ts', 'src/middleware/logging.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },
);
