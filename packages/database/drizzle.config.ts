import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/edge/schema.ts',
  out: '../../migrations/edge',
  dialect: 'sqlite',
});
