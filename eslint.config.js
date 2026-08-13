import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['node_modules/**', 'main.js', 'eslint.config.js', '*.mjs']
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      obsidianmd
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        console: 'readonly',
        createDiv: 'readonly',
        createEl: 'readonly',
        createSpan: 'readonly',
        activeDocument: 'readonly',
        activeWindow: 'readonly',
        window: 'readonly',
        document: 'readonly',
        Image: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        btoa: 'readonly'
      }
    },
    rules: {
      ...obsidianmd.configs.recommended,
      'obsidianmd/ui/sentence-case': ['error', {
        brands: ['Immich', 'Markdown'],
        ignoreRegex: [
          '^asset\\.read$',
          '^asset\\.view$',
          '^album\\.read$',
          '^local_thumbnail_link -',
          '^immich_url -',
          '^immich_asset_id -',
          '^original_filename -',
          '^taken_date -',
          '^description -'
        ]
      }],
      'no-new': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-prototype-builtins': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      quotes: ['error', 'single'],
      semi: ['error', 'never'],
      'arrow-parens': ['error', 'as-needed']
    }
  }
]
