import type { LTIDynamicRegistrationSession } from '@longsightgroup/lti-tool';
import { bigint, index, jsonb, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';

import {
  LTI_COLUMNS,
  LTI_ID_LENGTH,
  LTI_INDEXES,
  LTI_TABLES,
} from '#storage/schema-definitions';

export const registrationSessionsTable = pgTable(
  LTI_TABLES.registrationSessions,
  {
    id: varchar(LTI_COLUMNS.id, { length: LTI_ID_LENGTH }).notNull(),
    tenantId: varchar(LTI_COLUMNS.tenantId, { length: LTI_ID_LENGTH }).notNull(),
    data: jsonb(LTI_COLUMNS.payload).$type<LTIDynamicRegistrationSession>().notNull(),
    expiresAt: bigint(LTI_COLUMNS.expiresAt, { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index(LTI_INDEXES.registrationSessionsExpiresAt).on(table.expiresAt),
  ],
);
