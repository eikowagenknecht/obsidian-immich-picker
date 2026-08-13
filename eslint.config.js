import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

export default [
  {
    // '.claude/**' covers worktrees checked out inside the repo, which carry
    // their own built main.js. Plain 'main.js' only matches at the root.
    ignores: ['node_modules/**', '.claude/**', '**/main.js', 'eslint.config.js', '*.mjs']
  },
  ...tseslint.configs.recommendedTypeChecked,
  // Spread at top level: from 0.2 on this is a full flat config, not a bare
  // rules object. Folding it into `rules` instead silently drops every rule
  // it adds — which is how an obsidianmd finding reached review while `npm
  // run lint` reported a clean tree.
  ...obsidianmd.configs.recommended,
  {
    // moment is Obsidian's own date library, reached through window.moment and
    // provided by the app. It is a devDependency here purely for its types, so
    // there is no bundled copy to swap out.
    files: ['package.json'],
    rules: {
      'depend/ban-dependencies': 'off'
    }
  },
  {
    files: ['**/*.ts'],
    plugins: {
      obsidianmd
    },
    languageOptions: {
      parserOptions: {
        projectService: true
      },
      globals: {
        console: 'readonly',
        createDiv: 'readonly',
        createEl: 'readonly',
        createSpan: 'readonly',
        createFragment: 'readonly',
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
      'obsidianmd/ui/sentence-case': ['error', {
        brands: ['Immich', 'Markdown'],
        ignoreRegex: [
          '^asset\\.read$',
          '^asset\\.view$',
          '^album\\.read$',
          '^local_thumbnail_link -',
          '^immich_thumbnail_url -',
          '^immich_url -',
          '^immich_asset_id -',
          '^original_filename -',
          '^taken_date -',
          '^description -',
          '^display_width -',
          // A URL shown as a code sample, not prose to be capitalised.
          '^https://immich\\.example\\.com'
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
