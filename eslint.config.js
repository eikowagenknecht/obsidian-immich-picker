import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'main.js', 'eslint.config.js', '*.mjs']
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
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
)
