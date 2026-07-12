# @longsightgroup/lti-tool/storage/d1

Cloudflare D1 storage adapter for `@longsightgroup/lti-tool`.

## Installation

```bash
npm install @longsightgroup/lti-tool drizzle-orm
```

## Usage

Apply the Drizzle migrations in `drizzle/` to your D1 database, then pass the
binding to `D1Storage`.

The Drizzle schema files are the source of truth for contributors. After schema
changes, run `npm run db:generate:d1` and commit the generated migration SQL and
metadata. Run `npm run db:check:d1` before finishing migration changes.

```typescript
import { LTITool } from '@longsightgroup/lti-tool';
import { D1Storage } from '@longsightgroup/lti-tool/storage/d1';

const storage = new D1Storage({
  database: env.DB,
  tenantId: env.LTI_TENANT_ID,
});

const ltiTool = new LTITool({
  storage,
  // ... other config
});
```

## Schema

All SQL adapters share the same physical naming contract defined by the
`#storage/schema-definitions` internal import:

- Tables: `lti_clients`, `lti_deployments`, `lti_sessions`, `lti_nonces`, `lti_registration_sessions`
- Columns: snake_case physical names (`platform_name`, `client_id`, `payload`, …)
- Reserved-word-safe identifiers validated in CI

The `lti_` prefix keeps LTI storage separate from application tables in a shared D1
database.
