import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        // convención ya usada en el código: nombre con "_" al inicio =
        // parámetro/callback intencionalmente ignorado (ej. callbacks de
        // terceros con firma fija, o el binding de un catch que no se usa).
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // catch (_) {} vacío es intencional en un par de puntos (ignorar un
      // error de limpieza que no afecta el flujo) — no un olvido.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // api/ (funciones serverless de Vercel) y scripts/ (migraciones que se
    // corren con `node`) son código Node.js, no de navegador — usan
    // globals como `process` y `Buffer` que no existen en el browser.
    files: ['api/**/*.{js,jsx}', 'scripts/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
