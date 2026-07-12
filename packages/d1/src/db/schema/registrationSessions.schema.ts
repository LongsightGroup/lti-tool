import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { LTI_COLUMNS, LTI_INDEXES, LTI_TABLES } from '#storage/schema-definitions';

export const registrationSessionsTable = sqliteTable(
  LTI_TABLES.registrationSessions,
  {
    id: text(LTI_COLUMNS.id).notNull(),
    tenantId: text(LTI_COLUMNS.tenantId).notNull(),
    data: text(LTI_COLUMNS.payload, { mode: 'json' })
      .$type<LTIDynamicRegistrationSession>()
      .notNull(),
    expiresAt: integer(LTI_COLUMNS.expiresAt).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index(LTI_INDEXES.registrationSessionsExpiresAt).on(table.expiresAt),
  ],
);
