import { defineConfig } from 'drizzle-kit';

// `npx drizzle-kit generate` writes SQL migrations from src/schema.ts into migrations/.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
