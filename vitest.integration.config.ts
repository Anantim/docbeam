import { defineConfig } from 'vitest/config';
import { aliases } from './vitest.aliases.js';

// Integration tests need the Docker Compose stack running: docker compose up -d --wait
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
