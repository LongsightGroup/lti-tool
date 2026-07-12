import type { LTISession } from '@longsightgroup/lti-tool';
import { bigint, index, jsonb, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';

import {
  LTI_COLUMNS,
  LTI_ID_LENGTH,
  LTI_INDEXES,
  LTI_TABLES,
} from '#storage/schema-definitions';

export const sessionsTable = pgTable(
  LTI_TABLES.sessions,
  {
    id: varchar(LTI_COLUMNS.id, { length: LTI_ID_LENGTH }).notNull(),
    tenantId: varchar(LTI_COLUMNS.tenantId, { length: LTI_ID_LENGTH }).notNull(),
    data: jsonb(LTI_COLUMNS.payload).$type<Omit<LTISession, 'id'>>().notNull(),
    expiresAt: bigint(LTI_COLUMNS.expiresAt, { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    index(LTI_INDEXES.sessionsExpiresAt).on(table.expiresAt),
  ],
);
