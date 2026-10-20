import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'one-var': ['error', 'never'],
      'max-statements-per-line': ['error', { max: 1 }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message: 'Use the Button supplied by Harness.',
        },
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message: 'Use the Menu or SegmentedControl supplied by Harness.',
        },
        {
          selector: 'JSXOpeningElement[name.name="textarea"]',
          message: 'Use a Harness input component.',
        },
        {
          selector:
            'JSXOpeningElement[name.name="input"]:not(:has(JSXAttribute[name.name="hidden"]))',
          message: 'Use Harness fields for visible input. Only the hidden file picker is allowed.',
        },
      ],
    },
  },
);
