# Agent guide

Instructions for AI agents and contributors working in this repository.

## Philosophy

This codebase values **one correct way** to do each thing. Prefer a single, explicit API over parallel options. When you touch an area, move it toward that shape — do not add another path beside it.

**Do not add without explicit user request:**

- Deprecated APIs, `@deprecated` markers, or migration shims
- Legacy compatibility layers (“old behavior still works if…”)
- Fallback chains that guess intent when input is wrong
- Dual APIs for the same operation (throw vs result, sync vs async wrapper, alias exports)
- Feature flags or runtime switches between two implementations
- “Just in case” optional parameters that exist only to preserve old callers

If the right design replaces an old path, **replace it** in the same change. Do not leave both.

Ambiguity is a bug. Invalid input should fail clearly at the boundary, not be coerced into something that might work.

## TypeScript

- `strict` is on. Do not weaken compiler options to make code compile.
- ESM with `moduleResolution: "NodeNext"`. Relative imports use explicit `.js` extensions.
- Parse at boundaries; pass validated types inward. Use Zod schemas in `packages/core/src/schemas/`.
- Do not trust boundary data with `as SomeType`. If a cast is unavoidable, keep it local, document with `SAFETY:`, and hide it behind a small function.
- Prefer discriminated unions and string literal error codes over loose strings or booleans.
- Export types callers need. Avoid barrel files that re-export everything unless the package entry already follows that pattern.
- Keep functions small and typed end-to-end. No `any`. No widening return types to hide failures.

## Errors and control flow

Two patterns exist today. **New code should use only the structured one.**

| Concern                                         | Preferred API                                              | Avoid for new code                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Launch verification                             | `verifyLaunchDetailed` → `createSessionFromVerifiedLaunch` | `verifyLaunch` (throws generic `Error`)                                               |
| LTI platform services (AGS, NRPS, registration) | `*Detailed` methods returning `LtiServiceResult<T>`        | Wrappers that throw `LtiServiceError`                                                 |
| Launch registration (application code)          | `upsertLaunchRegistration` or dynamic registration         | `addClient` / `addDeployment` and other storage CRUD — custom admin UIs and adapters only |

Expected failures belong in typed result channels (`{ success: false; error }`) with stable `code` fields. Reserve throws for programmer mistakes and for translating at HTTP/route boundaries.

Do not add a third style (e.g. Result/Either wrappers alongside throws and `LtiServiceResult`).

## Modules and boundaries

```
packages/
  core/          # LTI protocol, LTITool, schemas, services — framework-agnostic
  hono/          # Route handlers and middleware only
  memory/        # LTIStorage implementations
  dynamodb/
  postgresql/
  mysql/
  d1/
```

- **Core** must not import Hono, Drizzle, or cloud SDKs.
- **Storage adapters** implement `LTIStorage` from core. Share behavior via conformance tests (`packages/core/test/helpers/storageConformance.ts`), not copy-paste.
- **Hono routes** are thin: parse request → call `LTITool` → map result to HTTP. No business logic in route files.
- One package on npm (`@longsightgroup/lti-tool`) with subpath exports. Do not reintroduce per-package `package.json` files or duplicate public surfaces.

Dependencies are explicit and narrow. Prefer the package's primary composition helper for common framework wiring, and keep lower-level route or middleware handlers focused on the smallest dependency shape they actually use.

## Parsing and domain types

- HTTP/form/query input: parse with Zod in route handlers or `ltiRequestParsing` utilities.
- JWT payloads: `LTI13JwtPayloadSchema` and related claim schemas.
- Persisted JSON: `parsePersistedLtiSession`, `serializeLtiSession`, and the registration session codecs — do not hand-parse storage blobs.
- Constants for LTI claim names and message types live in `packages/core/src/constants.ts`. Do not scatter magic strings.

## Tests

- Runner: Vitest. Unit tests exclude `*.integration.test.ts`.
- Prove behavior through public interfaces and real seams. Prefer storage conformance suites and integration tests over mocking `LTITool` internals.
- Mocking `jose` or `fetch` at the module boundary is acceptable when testing protocol flows without network I/O.
- Add tests when behavior is non-obvious or easy to regress. Do not add tests that only assert mocks were called.

Commands:

```bash
npm run build
npm test
npm run test:coverage
npm run test:integration:core
npm run lint
npm run format
npm run type-check
```

## Style

- oxlint + oxfmt. Run `npm run format:fix` and `npm run lint:fix` before finishing.
- Match surrounding naming, file layout, and JSDoc level. Do not add banner comments or narrate obvious code.
- Minimize diff scope. One problem, one solution, one way to invoke it.

## When changing public API

1. Pick the single API shape (structured results, explicit inputs, no silent defaults).
2. Update all in-repo callers in the same change.
3. Update README / package README if exports or conventions change.
4. Do not add deprecation periods, re-exports under old names, or compatibility aliases “for existing users.”

## Red flags in review

Reject or refactor changes that:

- Introduce `legacy`, `fallback`, `compat`, `shim`, `deprecated`, or `v2` naming
- Accept multiple input shapes for the same operation
- Catch errors only to retry with a different code path
- Add optional parameters to avoid updating callers
- Duplicate logic across storage adapters instead of extending shared contracts/tests
- Add framework-specific code to `packages/core`

## Reference

- [README.md](README.md) — user-facing overview and quick start
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup and PR expectations
- [packages/core/src/interfaces/ltiStorage.ts](packages/core/src/interfaces/ltiStorage.ts) — storage contract
- [packages/core/src/launchRegistration.ts](packages/core/src/launchRegistration.ts) — `upsertLaunchRegistration` (application registration path)
- [packages/core/src/errors/ltiServiceError.ts](packages/core/src/errors/ltiServiceError.ts) — service result types
