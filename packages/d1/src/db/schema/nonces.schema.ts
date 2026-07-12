import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { LTI_COLUMNS, LTI_INDEXES, LTI_TABLES } from '#storage/schema-definitions';

export const noncesTable = sqliteTable(
  LTI_TABLES.nonces,
  {
    nonce: text(LTI_COLUMNS.nonce).notNull(),
    tenantId: text(LTI_COLUMNS.tenantId).notNull(),
    expiresAt: integer(LTI_COLUMNS.expiresAt).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.nonce] }),
    index(LTI_INDEXES.noncesExpiresAt).on(table.expiresAt),
  ],
);
