import { index, mysqlTable, text, unique, varchar } from 'drizzle-orm/mysql-core';

import {
  LTI_COLUMNS,
  LTI_DEPLOYMENT_ID_LENGTH,
  LTI_ID_LENGTH,
  LTI_INDEXES,
  LTI_NAME_LENGTH,
  LTI_TABLES,
  LTI_UNIQUES,
} from '#storage/schema-definitions';

import { clientsTable } from './clients.schema.js';

export const deploymentsTable = mysqlTable(
  LTI_TABLES.deployments,
  {
    id: varchar(LTI_COLUMNS.id, { length: LTI_ID_LENGTH }).primaryKey(),
    tenantId: varchar(LTI_COLUMNS.tenantId, { length: LTI_ID_LENGTH }).notNull(),
    deploymentId: varchar(LTI_COLUMNS.deploymentId, {
      length: LTI_DEPLOYMENT_ID_LENGTH,
    }).notNull(),
    name: varchar(LTI_COLUMNS.deploymentName, { length: LTI_NAME_LENGTH }),
    description: text(LTI_COLUMNS.deploymentDescription),
    clientId: varchar(LTI_COLUMNS.clientId, { length: LTI_ID_LENGTH })
      .notNull()
      .references(() => clientsTable.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index(LTI_INDEXES.deploymentsDeploymentId).on(table.tenantId, table.deploymentId),
    unique(LTI_UNIQUES.deploymentsClientDeployment).on(
      table.clientId,
      table.deploymentId,
    ),
  ],
);
