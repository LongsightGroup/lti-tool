# Storage Relational

Internal shared implementation for Drizzle-backed relational storage adapters.

This package is not published as a standalone npm package. It is consumed through the root `#storage/relational-storage` import map by:

- `packages/d1`
- `packages/mysql`
- `packages/postgresql`

`RelationalStorage` owns the storage behavior common to those adapters. Adapter packages provide only database construction and dialect-specific hooks for inserts, transactions, cleanup result counts, nonce conflicts, and D1 mutation execution.

Regression coverage intentionally lives in the adapter suites:

- `npm run test:integration:d1`
- `npm run test:integration:mysql`
- `npm run test:integration:postgresql`

The MySQL and PostgreSQL suites require live databases. The D1 suite runs locally through Miniflare.
