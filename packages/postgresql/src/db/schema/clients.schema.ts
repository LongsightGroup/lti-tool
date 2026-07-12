import { index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import {
  LTI_CLIENT_ID_LENGTH,
  LTI_COLUMNS,
  LTI_ID_LENGTH,
  LTI_INDEXES,
  LTI_ISS_LENGTH,
  LTI_NAME_LENGTH,
  LTI_TABLES,
  LTI_UNIQUES,
} from '#storage/schema-definitions';

export const clientsTable = pgTable(
  LTI_TABLES.clients,
  {
    id: varchar(LTI_COLUMNS.id, { length: LTI_ID_LENGTH }).primaryKey(),
    tenantId: varchar(LTI_COLUMNS.tenantId, { length: LTI_ID_LENGTH }).notNull(),
    name: varchar(LTI_COLUMNS.platformName, { length: LTI_NAME_LENGTH }).notNull(),
    iss: varchar(LTI_COLUMNS.iss, { length: LTI_ISS_LENGTH }).notNull(),
    clientId: varchar(LTI_COLUMNS.clientId, { length: LTI_CLIENT_ID_LENGTH }).notNull(),
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
