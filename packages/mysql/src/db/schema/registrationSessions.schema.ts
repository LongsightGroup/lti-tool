import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { bigint, index, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';

export const registrationSessionsTable = mysqlTable(
  'registrationSessions',
  {
    id: varchar({ length: 36 }).primaryKey(),
    data: json().$type<LTIDynamicRegistrationSession>().notNull(),
    expiresAt: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [index('reg_sessions_expires_at_idx').on(table.expiresAt)],
);
