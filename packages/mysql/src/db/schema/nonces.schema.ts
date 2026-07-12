import { bigint, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

import {
  LTI_COLUMNS,
  LTI_ID_LENGTH,
  LTI_NONCE_LENGTH,
  LTI_TABLES,
} from '#storage/schema-definitions';

export const noncesTable = mysqlTable(
  LTI_TABLES.nonces,
  {
    nonce: varchar(LTI_COLUMNS.nonce, { length: LTI_NONCE_LENGTH }).notNull(),
    tenantId: varchar(LTI_COLUMNS.tenantId, { length: LTI_ID_LENGTH }).notNull(),
    expiresAt: bigint(LTI_COLUMNS.expiresAt, { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.nonce] })],
);
