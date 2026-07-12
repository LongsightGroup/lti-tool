import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import {
  LTI_COLUMNS,
  LTI_INDEXES,
  LTI_TABLES,
  LTI_UNIQUES,
} from '#storage/schema-definitions';

import { clientsTable } from './clients.schema.js';

export const deploymentsTable = sqliteTable(
  LTI_TABLES.deployments,
  {
    id: text(LTI_COLUMNS.id).primaryKey(),
    tenantId: text(LTI_COLUMNS.tenantId).notNull(),
    clientId: text(LTI_COLUMNS.clientId)
      .notNull()
      .references(() => clientsTable.id, { onDelete: 'cascade' }),
    deploymentId: text(LTI_COLUMNS.deploymentId).notNull(),
    name: text(LTI_COLUMNS.deploymentName),
    description: text(LTI_COLUMNS.deploymentDescription),
  },
  (table) => [
    index(LTI_INDEXES.deploymentsDeploymentId).on(table.tenantId, table.deploymentId),
    uniqueIndex(LTI_UNIQUES.deploymentsClientDeployment).on(
      table.clientId,
      table.deploymentId,
    ),
  ],
);
