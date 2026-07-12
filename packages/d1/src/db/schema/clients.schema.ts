import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import {
  LTI_COLUMNS,
  LTI_INDEXES,
  LTI_TABLES,
  LTI_UNIQUES,
} from '#storage/schema-definitions';

export const clientsTable = sqliteTable(
  LTI_TABLES.clients,
  {
    id: text(LTI_COLUMNS.id).primaryKey(),
    tenantId: text(LTI_COLUMNS.tenantId).notNull(),
    name: text(LTI_COLUMNS.platformName).notNull(),
    iss: text(LTI_COLUMNS.iss).notNull(),
    clientId: text(LTI_COLUMNS.clientId).notNull(),
    authUrl: text(LTI_COLUMNS.authUrl).notNull(),
    tokenUrl: text(LTI_COLUMNS.tokenUrl).notNull(),
    jwksUrl: text(LTI_COLUMNS.jwksUrl).notNull(),
  },
  (table) => [
    index(LTI_INDEXES.clientsIssuerClient).on(table.tenantId, table.clientId, table.iss),
    uniqueIndex(LTI_UNIQUES.clientsIssClientId).on(
      table.tenantId,
      table.iss,
      table.clientId,
    ),
  ],
);
