import { defineConfig } from 'vitest/config';

/**
 * Configuración de la suite de tests del activo. Vitest resuelve los imports con
 * extensión `.js` hacia sus fuentes `.ts`, de modo que las pruebas usan la misma
 * sintaxis ESM que el código de producción.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
