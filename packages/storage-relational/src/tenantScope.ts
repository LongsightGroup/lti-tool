import { and, eq, type AnyColumn, type SQL } from 'drizzle-orm';

export type TenantScopedTable = {
  readonly tenantId: AnyColumn;
};

export type TenantScope = {
  readonly tenantId: string;
  condition(table: TenantScopedTable): SQL;
  withTenant(table: TenantScopedTable, condition: SQL): SQL;
  insertValues(
    table: TenantScopedTable,
    values: Record<string, unknown>,
  ): Record<string, unknown>;
};

export function createTenantScope(tenantId: string): TenantScope {
  return {
    tenantId,
    condition(table: TenantScopedTable): SQL {
      return eq(table.tenantId, tenantId);
    },
    withTenant(table: TenantScopedTable, condition: SQL): SQL {
      return and(eq(table.tenantId, tenantId), condition)!;
    },
    insertValues(table: TenantScopedTable, values: Record<string, unknown>) {
      return { ...values, tenantId };
    },
  };
}
