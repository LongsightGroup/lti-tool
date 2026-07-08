# @longsightgroup/lti-tool

## 0.1.4

### Patch Changes

- Fix LTI Deep Linking settings parsing to follow the 1EdTech spec: include `accept_lineitem`, `title`, and `text`; require `accept_presentation_document_targets`; and reject unknown Deep Linking settings keys instead of silently dropping them.
- Add `acceptLineItem`, `title`, and `text` to the exported `LtiDeepLinkingSettings` session/capability contract.
- Fix Deep Linking `ltiResourceLink.lineItem` parsing so `label` is optional, `scoreMaximum` must be positive, and `gradesReleased` is preserved.
- Preserve Deep Linking `window` and `iframe` presentation options for `link` and `ltiResourceLink` content items.

## 0.1.3

### Patch Changes

- Add session-bound LTI Advantage support for AGS line item find-or-create workflows, NRPS page retrieval, and opt-in NRPS pagination following.
- Add structured `invalid_request` service failures for invalid Advantage service inputs.
- Preserve platform-provided LTI pagination links while keeping pagination helpers internal to the package.
- Document the new Advantage roster and line item APIs.

## 0.1.2

### Patch Changes

- Add `onVerificationFailure` to `customLaunchRouteHandler` so applications can map typed launch verification failures to custom HTTP responses while keeping verification result-based.
- Export `renderDefaultLaunchVerificationFailureResponse` from `@longsightgroup/lti-tool/hono` for custom launch handlers that only override selected verification error codes.

## 0.1.1

### Patch Changes

- Add app-facing LTI facade interfaces, session-bound Advantage client interfaces, and the `@longsightgroup/lti-tool/testing` export.
- Add Hono custom launch callbacks for app-owned Resource Link and Deep Linking UI.
- Add typed dynamic-registration result classifications and canonical storage conflict error support.
- Add `createDeepLinkingHtmlResponse` for ready-to-return Deep Linking HTML responses.
- Clarify verify-time nonce claiming semantics and remove unused core nonce TTL configuration.
- Replace the `pino` peer dependency with a library-owned `LtiLogger` contract and `createNoopLogger()`. Hono route factories accept an optional `logger` and default to a noop logger at the route boundary.
