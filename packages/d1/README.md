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
});

const ltiTool = new LTITool({
  storage,
  // ... other config
});
```

## Schema

This adapter creates prefixed tables:

- `lti_tool_clients`
- `lti_tool_deployments`
- `lti_tool_sessions`
- `lti_tool_nonces`
- `lti_tool_registration_sessions`

The prefix keeps LTI storage separate from application tables in a shared D1
database.
