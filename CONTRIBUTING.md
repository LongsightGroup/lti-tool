# Contributing to LTI Tool

Thanks for your interest in contributing! We welcome issues and pull requests!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/lti-tool.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature`

## Development

```bash
# Build all packages
npm run build

# Run tests
npm test

# Run MySQL adapter integration tests
docker compose -f packages/mysql/docker-compose.yml up -d --wait
DATABASE_URL="mysql://lti_user:lti_password@127.0.0.1:3306/lti_test" npm run db:migrate:mysql
DATABASE_URL="mysql://lti_user:lti_password@127.0.0.1:3306/lti_test" npm run test:integration:mysql
docker compose -f packages/mysql/docker-compose.yml down -v

# Run PostgreSQL adapter integration tests
docker compose -f packages/postgresql/docker-compose.yml up -d --wait
DATABASE_URL="postgresql://lti_user:lti_password@127.0.0.1:5432/lti_test" npm run db:migrate:postgresql
DATABASE_URL="postgresql://lti_user:lti_password@127.0.0.1:5432/lti_test" npm run test:integration:postgresql
docker compose -f packages/postgresql/docker-compose.yml down -v

# The Compose files publish 3306 and 5432 on the host.
# Stop any local database using those ports, or update the published port and DATABASE_URL together.

# Generate and verify SQL migrations after Drizzle schema changes
npm run db:generate:d1
npm run db:generate:mysql
npm run db:generate:postgresql
npm run db:check:migrations

# Lint code
npm run lint

# Check formatting
npm run format

# Apply formatting
npm run format:fix
```

## SQL migrations

Drizzle schema files are the source of truth. After changing schema files:

1. Regenerate migrations from the monorepo root: `npm run db:generate:d1`, `npm run db:generate:mysql`, or `npm run db:generate:postgresql`
2. Verify generated SQL: `npm run db:check:migrations`
3. Commit the generated SQL and metadata with your schema change

Do not run `drizzle-kit` from inside `packages/<adapter>/`; the config paths assume the monorepo root as the working directory.

Regenerating the initial `0000_*` migration is a breaking change for existing deployments. Document upgrade steps in the PR when squashed migrations change.

## Pull Requests

1. Make your changes
2. Add tests if needed
3. Ensure all tests pass: `npm test`
4. Create a pull request with a clear description

## Issues

- Use GitHub issues for bugs and feature requests
- Search existing issues before creating new ones
- Provide clear reproduction steps for bugs

## Code Style

We use oxlint for linting and oxfmt for formatting. Run `npm run format` and `npm run lint` before submitting.

## Questions?

Open a [discussion](https://github.com/lti-tool/lti-tool/discussions)
