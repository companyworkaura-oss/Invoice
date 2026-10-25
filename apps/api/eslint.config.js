// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // argsIgnorePattern covers unused function params; varsIgnorePattern
      // is the matching rule for a destructured binding deliberately kept
      // (and conventionally underscore-prefixed) only to omit it from the
      // rest of the destructure — e.g. membership.service.ts's
      // `switchCompany` picking every field *except* status/deactivatedAt
      // off a DB row via `const { status: _status, ...membership } = row`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Augmenting Express's Request type requires the `declare global { namespace Express {} }` form.
    files: ['src/middleware/auth.ts', 'src/middleware/logging.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },
);
