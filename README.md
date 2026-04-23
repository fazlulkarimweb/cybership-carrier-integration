# Cybership Carrier Integration — UPS

A TypeScript backend module that abstracts shipping-carrier APIs behind a
single, carrier-agnostic contract. UPS is implemented as the first
reference adapter; the design is optimised for adding FedEx, USPS, DHL,
etc. without touching existing code.

---

## Design goals

1. **Abstraction-first.** Callers never see carrier-specific shapes,
   field names, or codes. The `Carrier` interface + shared domain types
   in [`src/core/types.ts`](./src/core/types.ts) are the public contract.
2. **Open for extension, closed for modification.** Adding a new carrier
   means writing a new adapter under `src/carriers/<name>/` and calling
   `registry.register(new MyCarrier(config))`. No existing file has to
   change.
3. **Structured errors.** Every failure mode — validation, auth,
   rate-limit, carrier 4xx/5xx, timeout, malformed response — surfaces
   as a typed subclass of
   [`CarrierError`](./src/core/errors.ts) with a stable `code`,
   `httpStatus`, `retryable` flag, and `details[]`.
4. **Fully tested without a network.** The `HttpClient` interface is the
   single seam; tests stub it and exercise the real validation,
   mapping, auth, and error paths end-to-end.
5. **Secrets via env only.** Config is loaded through a zod-validated
   schema in [`src/config/env.ts`](./src/config/env.ts). No secret ever
   lives in code.

---

## Installation

**Prerequisites**

- Node.js `>= 18.17` (the module uses the built-in `fetch` and
  `AbortController`). Node 20+ is recommended; on Node 18, `vitest` is
  pinned to `^2.1.x` for compatibility.
- `pnpm`, `npm`, or `yarn`.
- UPS Developer Kit credentials — a client id, client secret, and
  shipper account number. Request them at
  [developer.ups.com](https://developer.ups.com/).

**1. Clone and install dependencies**

```bash
git clone <repo-url> cybership-carrier-integration
cd cybership-carrier-integration
pnpm install
```

The only runtime dependency is [`zod`](https://zod.dev/). Dev
dependencies are `vitest`, `typescript`, and `@types/node`.

**2. Configure environment variables**

```bash
cp .env.example .env
```

Then edit `.env` and fill in at minimum:

```dotenv
UPS_BASE_URL=https://wwwcie.ups.com      # sandbox; use https://onlinetools.ups.com in prod
UPS_CLIENT_ID=your-client-id
UPS_CLIENT_SECRET=your-client-secret
UPS_ACCOUNT_NUMBER=your-shipper-account
```

See the [Configuration](#configuration) section below for every
supported variable.

**3. Verify the install**

```bash
pnpm test
```

All integration tests run fully offline (HTTP is stubbed) and should
pass on a fresh checkout. A green suite confirms the toolchain, zod
schemas, and adapter wiring are correct.

**4. Type-check (optional)**

```bash
pnpm exec tsc --noEmit
```

**5. Use it**

Import from `./src` as shown in [Usage](#usage). This module is
published as plain TypeScript sources consumed by a host application
(Next.js route handler, NestJS service, Fastify plugin, etc.) — there
is no separate build step required when the host compiles TypeScript.

---

## Architecture

```
src/
├── core/
│   ├── types.ts            Domain types (Address, Package, RateRequest, RateQuote, …)
│   ├── schemas.ts          Zod schemas — one per domain type, re-used everywhere
│   ├── errors.ts           CarrierError + subclasses (Validation, Auth, RateLimit, …)
│   ├── http/
│   │   ├── client.ts       HttpClient interface — the stub-seam for tests
│   │   └── fetch-client.ts FetchHttpClient — production impl (AbortController + JSON)
│   ├── auth/
│   │   ├── token-manager.ts                  TokenManager interface
│   │   └── oauth-client-credentials.ts       Generic OAuth2 client_credentials
│   └── carrier/
│       ├── operations.ts   RateOperation / LabelPurchase / Tracking / AddressValidation
│       ├── carrier.ts      Carrier interface (bag-of-capabilities)
│       └── registry.ts     CarrierRegistry
├── carriers/ups/           UPS adapter — isolated from the rest of the codebase
│   ├── config.ts
│   ├── wire-types.ts       UPS wire-format types (internal to this folder only)
│   ├── code-maps.ts        UPS code ↔ domain enum mappings
│   ├── errors.ts           Maps UPS error envelopes to CarrierError subclasses
│   ├── mappers/
│   │   ├── rate-request.mapper.ts   Domain RateRequest → UPS RateRequest
│   │   └── rate-response.mapper.ts  UPS RateResponse → Domain RateQuote[]
│   ├── operations/rate.ts  RateOperation implementation
│   └── index.ts            UpsCarrier class wiring the above together
├── services/
│   └── rating-service.ts   Rate-shop across every registered carrier in parallel
├── config/env.ts           Env-var loader (zod-validated)
└── index.ts                Public entry point
```

### Adding a new carrier

Taking FedEx as an example:

1. Create `src/carriers/fedex/{config,index,wire-types,mappers/…}.ts`.
2. Implement the `RateOperation` on top of the shared `HttpClient` and
   `TokenManager` primitives.
3. Export a `FedexCarrier implements Carrier` class.
4. At wire-up time: `registry.register(new FedexCarrier(config))`.

No changes required in `core/`, `services/`, or the UPS adapter. The
`RatingService` automatically includes FedEx in every rate shop because
it queries the registry dynamically via `listWithCapability("rate")`.

Adding a new **operation** (say, label purchase) follows the same
pattern: add a new interface to `core/carrier/operations.ts`, an
optional field to `Carrier`, and implement it per-carrier.

---

## Usage

```ts
import {
  CarrierRegistry,
  RatingService,
  UpsCarrier,
  loadUpsConfigFromEnv,
} from "./src"

const registry = new CarrierRegistry().register(
  new UpsCarrier(loadUpsConfigFromEnv()),
)

const service = new RatingService(registry)

const { quotes, errors } = await service.rate({
  shipper: {
    name: "Jane Doe",
    company: "ACME Corp",
    street1: "123 Warehouse Way",
    city: "Atlanta",
    stateOrProvince: "GA",
    postalCode: "30303",
    countryCode: "US",
  },
  recipient: {
    name: "John Smith",
    street1: "500 Customer Lane",
    city: "Columbus",
    stateOrProvince: "OH",
    postalCode: "43215",
    countryCode: "US",
    residential: true,
  },
  packages: [
    {
      weight: { value: 5, unit: "lb" },
      dimensions: { length: 10, width: 8, height: 6, unit: "in" },
      packagingType: "BOX",
    },
  ],
})

// quotes: RateQuote[] — already normalised across every carrier
// errors: per-carrier failures, only populated when { allowPartial: true }
```

---

## Auth model

UPS uses OAuth 2.0 `client_credentials`. The
`OAuthClientCredentialsTokenManager` handles:

- **In-memory caching** of the access token until `expires_in` (minus a
  configurable 60 s clock-skew buffer).
- **Request coalescing** — N parallel `getToken()` callers share a
  single inflight network request.
- **Transparent refresh on 401** — if a rate call returns 401 the
  adapter invalidates the cached token and retries the call exactly
  once.
- **Structured failures** — token endpoint 4xx/5xx → `AuthError`;
  missing `access_token` in the body → `MalformedResponseError`.

The same token manager powers any future carrier that also uses
`client_credentials` (FedEx, DHL).

---

## Error model

Every exception thrown by the module is a subclass of `CarrierError`:

| Class                     | `code`                  | When it is thrown                                  |
| ------------------------- | ----------------------- | -------------------------------------------------- |
| `ValidationError`         | `VALIDATION_ERROR`      | Request failed zod validation at the boundary      |
| `AuthError`               | `AUTH_ERROR`            | OAuth failure or carrier 401/403                   |
| `RateLimitError`          | `RATE_LIMITED`          | Carrier 429; carries `retryAfterSeconds`           |
| `TimeoutError`            | `TIMEOUT`               | Request exceeded the configured timeout            |
| `NetworkError`            | `NETWORK_ERROR`         | DNS failure, socket error, etc.                    |
| `MalformedResponseError`  | `MALFORMED_RESPONSE`    | 2xx with non-JSON body, or missing required fields |
| `UnsupportedOperationError` | `UNSUPPORTED_OPERATION` | Capability not implemented on a carrier            |
| `CarrierError` (base)     | `CARRIER_ERROR`         | Everything else (carrier 4xx/5xx)                  |

`retryable: boolean` is set on every instance; API handlers can branch
on it to decide whether to surface a 5xx or a user-facing error.
`toJSON()` returns a safe, structured shape suitable for logs and API
responses.

---

## Configuration

All configuration is environment-variable driven and loaded through a
zod schema in `src/config/env.ts`. See [`.env.example`](./.env.example).

| Variable             | Default                      | Purpose                                           |
| -------------------- | ---------------------------- | ------------------------------------------------- |
| `UPS_BASE_URL`       | `https://wwwcie.ups.com`     | Sandbox; use `https://onlinetools.ups.com` in prod |
| `UPS_CLIENT_ID`      | —                            | OAuth client id                                   |
| `UPS_CLIENT_SECRET`  | —                            | OAuth client secret                               |
| `UPS_ACCOUNT_NUMBER` | —                            | Shipper account (required for negotiated rates)   |
| `UPS_API_VERSION`    | `v2409`                      | UPS versions its endpoints                        |
| `UPS_TIMEOUT_MS`     | `15000`                      | Per-request timeout                               |

A missing or malformed value throws `ConfigurationError` at boot time
rather than letting the problem surface mid-request.

---

## Testing

```bash
pnpm test          # one-shot
pnpm test:watch    # interactive
pnpm test:coverage # with coverage report
```

Tests live in [`tests/integration/`](./tests/integration/) and use
[`vitest`](https://vitest.dev/). They exercise the **full stack**
(validation → request mapping → auth → HTTP → response parsing → error
mapping), stubbing only the HTTP layer via
[`MockHttpClient`](./tests/integration/helpers/mock-http.ts).

Included scenarios:

- `ups-rate.test.ts` — `/Shop` and `/Rate` request shapes, response
  normalisation, multi-package requests, country-code canonicalisation.
- `ups-auth.test.ts` — token caching, concurrent-request coalescing,
  TTL-based refresh, transparent 401 refresh, token endpoint failures.
- `ups-errors.test.ts` — 400, 401, 429 (with Retry-After), 5xx,
  malformed bodies, timeouts, and generic network errors.
- `rating-service.test.ts` — cross-carrier rate-shop, strict vs
  `allowPartial` failure modes, capability filtering, and the
  extensibility acceptance test (a fake FedEx carrier plugged in
  without touching any existing file).

JSON fixtures under
[`tests/integration/fixtures/`](./tests/integration/fixtures/) mirror
real UPS OAuth and Rating API payloads.

---

## Trade-offs & follow-ups

- **Retries / backoff.** The adapter retries exactly once on 401 (auth
  refresh). It does not retry on 5xx or 429 — the `retryable: true`
  flag signals to callers whether a retry is safe, and carrier-layer
  retry policies differ enough that a decorator pattern
  (`RetryingHttpClient`) is the better long-term fit than bolting it
  into the adapter. Wiring one in is a non-breaking change: wrap the
  `FetchHttpClient` at construction time.
- **Observability.** Each UPS request sends a unique `transId` header
  for carrier-side support lookups, and every `CarrierError` surfaces a
  JSON-safe payload suitable for structured logs. Hooking a logger
  (pino/winston) is a one-line injection into `FetchHttpClient`.
- **Schema drift.** UPS versions its API (`v2409`, etc.). The version
  segment is configurable; the wire-type definitions are kept narrow so
  a future bump touches only the UPS adapter.
- **Further carriers.** The "bag of capabilities" on `Carrier` means a
  carrier can implement only the operations it supports; the registry
  lets callers ask for carriers by capability
  (`registry.listWithCapability("rate")`).
