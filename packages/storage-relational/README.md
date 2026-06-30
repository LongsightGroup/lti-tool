# Storage Relational

Internal shared implementation for Drizzle-backed relational storage adapters.

This package is not published as a standalone npm package. It is consumed through the root `#storage/relational-storage` import map by:

- `packages/d1`
- `packages/mysql`
- `packages/postgresql`

`RelationalStorage` owns the storage behavior common to those adapters. Adapter packages provide only database construction and dialect-specific hooks for D1 mutation execution and SQL dialect behavior.

Shared modules in this package:

- `relationalStorage.ts` — shared `LTIStorage` implementation
- `deploymentRow.ts` / `storageRows.ts` — row mapping helpers
- `mysqlDialect.ts` / `postgresDialect.ts` — SQL adapter dialect hooks

Regression coverage:

- Unit tests: `packages/storage-relational/test/*.test.ts`
- Adapter integration suites:
  - `npm run test:integration:d1`
  - `npm run test:integration:mysql`
  - `npm run test:integration:postgresql`

The MySQL and PostgreSQL suites require live databases. The D1 suite runs locally through Miniflare.

Drizzle schema files live in each adapter package. After schema changes, regenerate migrations from the monorepo root with `npm run db:generate:*`.
