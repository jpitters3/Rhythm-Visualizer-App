import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/.temp/**',
      'docs/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Catches leftover imports/variables from refactors — the #1 thing
      // no tooling in this repo currently catches.
      'no-unused-vars': ['warn', {
        args: 'none', // unused function params are common/fine here (event handlers, interface consistency)
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // console.warn/error are the codebase's normal error-handling
      // convention (183 existing uses) — only flag stray console.log
      // debug statements.
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
];
