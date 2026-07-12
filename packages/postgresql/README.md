# @longsightgroup/lti-tool/storage/postgresql

<p align="center">Production-ready PostgreSQL storage adapter for LTI 1.3. Includes caching and optimized for AWS Lambda.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@longsightgroup/lti-tool/storage/postgresql"><img alt="npm" src="https://img.shields.io/npm/v/%40lti-tool%2Fpostgresql" /></a>
</p>

## Installation

```bash
npm install @longsightgroup/lti-tool postgres
```

## Quick Start

```typescript
import { PostgresStorage } from '@longsightgroup/lti-tool/storage/postgresql';
import { LTITool } from '@longsightgroup/lti-tool';

const storage = new PostgresStorage({
  connectionUrl: process.env.DATABASE_URL!,
  tenantId: process.env.LTI_TENANT_ID!,
});

const ltiTool = new LTITool({
  storage,
  // ... other config
});
```

## Features

- **Production Ready** - Handles high-scale LTI deployments
- **Built-in Caching** - LRU cache for frequently accessed data
- **Type-safe** - Uses Drizzle ORM for database operations
- **Cascade Deletes** - Database constraints remove deployments with their client
- **Tuned Connection Pool Defaults** - Connection pool defaults based on hosting environment

## Configuration

### Using Migrations

```bash
# Set your DATABASE_URL
export DATABASE_URL="postgresql://user:password@host:port/database"

# Apply the generated migrations
npx drizzle-kit migrate --config packages/postgresql/drizzle.config.ts
```

The Drizzle schema files are the source of truth for contributors. After schema
changes, run `npm run db:generate:postgresql` and commit the generated migration
SQL and metadata. Run `npm run db:check:postgresql` before finishing migration
changes.

### PostgresStorageConfig

- **connectionUrl** (required): PostgreSQL connection URL
  Format: `postgresql://user:password@host:port/database`
- **tenantId** (required): Tenant namespace bound to this storage instance
- **poolOptions** (optional): postgres.js connection options
  - `max`: Max connections (auto: 1 for serverless, 10 for servers)
  - `idleTimeout`: Idle timeout in seconds before connection is closed (default: 20)
- **nonceExpirationSeconds** (optional): Nonce TTL in seconds (default: 600)

- **logger** (optional): Structural logger for debugging

## Database Schema

All SQL adapters use the same physical naming contract from the
`#storage/schema-definitions` internal import.

### Tables

- **lti_clients** — LTI platform clients
- **lti_deployments** — platform deployments (many-to-one with clients)
- **lti_sessions** — LTI launch sessions with expiration
- **lti_nonces** — one-time use nonces
- **lti_registration_sessions** — dynamic registration sessions

### lti_clients

| Physical column | Type         | Description                    |
| --------------- | ------------ | ------------------------------ |
| `id`            | VARCHAR(36)  | Internal UUID for the client   |
| `platform_name` | VARCHAR(255) | Human-readable platform name   |
| `iss`           | VARCHAR(255) | Issuer URL (LMS platform)      |
| `client_id`     | VARCHAR(255) | LMS-provided client identifier |
| `auth_url`      | TEXT         | OAuth2 authorization endpoint  |
| `token_url`     | TEXT         | OAuth2 token endpoint          |
| `jwks_url`      | TEXT         | JWKS endpoint for public keys  |

### lti_deployments

| Physical column          | Type         | Description                        |
| ------------------------ | ------------ | ---------------------------------- |
| `id`                     | VARCHAR(36)  | Internal UUID for the deployment   |
| `deployment_id`          | VARCHAR(255) | LMS-provided deployment identifier |
| `deployment_name`        | VARCHAR(255) | Optional human-readable name       |
| `deployment_description` | TEXT         | Optional description               |
| `client_id`              | VARCHAR(36)  | References `lti_clients.id`        |

### lti_sessions / lti_registration_sessions

| Physical column | Type   | Description                   |
| --------------- | ------ | ----------------------------- |
| `id`            | UUID   | Session UUID                  |
| `payload`       | JSONB  | Serialized session data       |
| `expires_at`    | BIGINT | Expiration epoch milliseconds |

### lti_nonces

| Physical column | Type         | Description                         |
| --------------- | ------------ | ----------------------------------- |
| `nonce`         | VARCHAR(255) | One-time use nonce value            |
| `expires_at`    | BIGINT       | Nonce expiration epoch milliseconds |

## Connection Pool Behavior

The adapter automatically detects your deployment environment:

- **Serverless** (Lambda, Cloud Functions, Vercel, Netlify): `max: 1`
- **Traditional Servers** (EC2, containers, VMs): `max: 10`

### How Connection Pooling Works

- Starts with **0 connections**
- Creates connections **on-demand** when queries execute
- Reuses idle connections before creating new ones
- Increases to `max` based on concurrent load
- Closes idle connections after `idleTimeout` seconds (default: 20)

### Manual Override

```typescript
const storage = new PostgresStorage({
  connectionUrl: process.env.DATABASE_URL!,
  tenantId: process.env.LTI_TENANT_ID!,
  poolOptions: {
    max: 20, // Override auto-detection
    idleTimeout: 30, // Keep connections alive longer
  },
});
```

## Deployment Patterns

### Long-Running Servers

```typescript
import { PostgresStorage } from '@longsightgroup/lti-tool/storage/postgresql';

export const storage = new PostgresStorage({
  connectionUrl: process.env.DATABASE_URL!,
  tenantId: process.env.LTI_TENANT_ID!,
});

// Optional: Graceful shutdown
const shutdown = async () => {
  await storage.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

**Connection Limits:**

- Low traffic: `5-10 connections`
- Medium traffic: `10-20 connections`
- High traffic: `20-50 connections`
- Never exceed PostgreSQL `max_connections`

### AWS Lambda / Serverless

```typescript
import { PostgresStorage } from '@longsightgroup/lti-tool/storage/postgresql';

let storage: PostgresStorage | undefined;

export const handler = async (event) => {
  if (!storage) {
    storage = new PostgresStorage({
      connectionUrl: process.env.DATABASE_URL!,
      tenantId: process.env.LTI_TENANT_ID!,
      // Auto-detects Lambda, uses max: 1
    });
  }

  // Use storage...
};
```

**Why `max: 1`?**
Lambda containers handle one request at a time. The connection is reused across warm invocations.

**Do I need `close()`?**
No! Lambda freezes containers efficiently. Calling `close()` destroys reusable connections.

### Edge Runtime Warning

⚠️ **Not supported!**

## Periodic Cleanup

The adapter requires periodic cleanup of expired nonces and sessions.

```typescript
// Example - AWS Lambda with EventBridge (every 30 minutes)
export const handler = async () => {
  const result = await storage.cleanup();
  console.log('Cleanup:', result);
  // { noncesDeleted: 42, sessionsDeleted: 15, registrationSessionsDeleted: 3 }
};
```

## Development & Testing

### Start Local PostgreSQL

```bash
# Using Docker
docker-compose up -d

# Using Podman
podman-compose up -d

# Or Podman directly
podman run -d \
  --name lti-postgres \
  -e POSTGRES_PASSWORD=lti_password \
  -e POSTGRES_DB=lti_test \
  -e POSTGRES_USER=lti_user \
  -p 5432:5432 \
  postgres:16
```

### Run Tests

```bash
DATABASE_URL="postgresql://lti_user:lti_password@127.0.0.1:5432/lti_test" npm run db:migrate:postgresql
DATABASE_URL="postgresql://lti_user:lti_password@127.0.0.1:5432/lti_test" npm run test:integration:postgresql
```

**Important:** Always close the pool after tests:

```typescript
afterAll(async () => {
  await storage.close();
});
```

## Environment Detection

Auto-detects serverless by checking:

- AWS Lambda: `AWS_LAMBDA_FUNCTION_NAME`, `AWS_EXECUTION_ENV`
- Google Cloud: `FUNCTION_NAME`, `K_SERVICE`
- Azure: `FUNCTIONS_WORKER_RUNTIME`
- Vercel: `VERCEL`
- Netlify: `NETLIFY`
