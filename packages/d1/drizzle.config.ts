import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './packages/d1/drizzle',
  schema: './packages/d1/src/db/schema/index.ts',
  dialect: 'sqlite',
});
