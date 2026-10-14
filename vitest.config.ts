import { defineConfig } from 'vitest/config';
import { aliases } from './vitest.aliases.js';

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'services/*/src/**/*.test.ts', 'workers/*/src/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}', 'tests/scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
