import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { bigint, index, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';

export const registrationSessionsTable = pgTable(
  'registration_sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    data: jsonb('data').$type<LTIDynamicRegistrationSession>().notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('reg_sessions_expires_at_idx').on(table.expiresAt)],
);
