module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: ['dist', 'coverage', '.eslintrc.cjs', 'public'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'error',
    'no-eval': 'error',
    'no-new-func': 'error',
    eqeqeq: ['error', 'always'],
    // Quality gates from the rulebook: complexity <= 10, nesting <= 3, <= 4 params, small files and functions.
    complexity: ['error', 10],
    'max-depth': ['error', 3],
    'max-params': ['error', 4],
    'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    'max-len': [
      'error',
      { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true },
    ],
  },
  overrides: [
    {
      // Tests may be long and table-driven; the structural limits apply to production code.
      files: ['**/*.test.ts', '**/*.test.tsx', 'src/__tests__/**'],
      rules: {
        'max-lines-per-function': 'off',
        'max-lines': 'off',
        'max-len': 'off',
        'max-depth': 'off',
        complexity: 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // Data and sandbox-side source text, not application logic.
      files: [
        'src/runtime/bridgeSource.ts',
        'src/data/templates.ts',
        'src/editor/reactTypes.ts',
        'src/editor/themes.ts',
      ],
      rules: { 'max-lines': 'off', 'max-len': 'off', 'max-lines-per-function': 'off' },
    },
  ],
};
