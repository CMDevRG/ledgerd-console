import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'src/api/schema.d.ts'] },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Money must never be a floating point number: see src/money (to be added).
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Never parse money as a float; use BigInt.' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    ...jsxA11y.flatConfigs.strict,
  },

  {
    files: ['**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },

  // The console server runs on Node, not in a browser.
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // This test needs markup that is deliberately inaccessible, to prove the check can fail.
  {
    files: ['src/test/axe.test.tsx'],
    rules: { 'jsx-a11y/alt-text': 'off', 'jsx-a11y/label-has-associated-control': 'off' },
  },

  // Plain JavaScript files (this one) are not part of the TypeScript project.
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
  },
);
