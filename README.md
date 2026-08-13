# Backend Connectors

[![CI](https://github.com/SteeveO/backend-connectors/actions/workflows/ci.yml/badge.svg)](https://github.com/SteeveO/backend-connectors/actions/workflows/ci.yml)

A bank connector that authenticates against a bank API (mocked locally), aggregates a user's accounts and transactions (with pagination and deduplication), and exposes the result through a single REST endpoint documented on Swagger.

## Quick start

Three commands:

```bash
git clone git@github.com:SteeveO/backend-connectors.git && cd backend-connectors
cp .env.example .env
docker-compose up
```

| Service | URL |
| --- | --- |
| API (aggregated endpoint) | http://localhost:3001/aggregated-accounts |
| Swagger documentation | http://localhost:3001/api/docs |
| Mock bank server | http://localhost:3000 |

## Possible improvements

- **Per-request authentication**: `login()` redoes the `POST /login` → `POST /token` cycle on every call to `AggregateAccountsUseCase.execute()`. An access token cache with expiry tracking (and transparent refresh) would avoid this systematic round trip.
- **Observability**: per-account error isolation (see below) logs to `console.error` for lack of a structured logger; a real logger (with levels, per-request correlation) would be injected through a dedicated port instead of using a global dependency in the domain.
- **Rate limiting / retry**: no retry or backoff on outbound calls; in production, a transient outage on the provider's side would currently fail or empty out an entire request instead of being retried.
- **Load testing the pagination path**: the mock exposes accounts/transactions over a deliberately large number of pages (see below); the adapter's behavior at real production volume (thousands of accounts) is only validated by reading the code, not by a load test.

## Architecture

The project follows a hexagonal architecture (ports & adapters):

```
src/
├── domain/
│   ├── entities/       # Pure business types: Account, Transaction, AggregatedAccount
│   ├── ports/           # BankPort: the interface the domain needs
│   ├── use-cases/       # AggregateAccountsUseCase: orchestration, no direct I/O
│   └── exceptions/      # BankAuthenticationException, BankUnavailableException
├── infrastructure/
│   └── adapters/        # Implements BankPort over HTTP
└── app/
    ├── app.controller.ts   # GET /aggregated-accounts
    ├── app.module.ts       # DI wiring of the adapter -> BankPort
    ├── dto/                 # Swagger DTOs
    └── filters/             # AllExceptionsFilter: errors -> structured responses
```

The domain doesn't know it's talking to an HTTP server: it only depends on the `BankPort` interface. The HTTP adapter (`src/infrastructure/adapters/`) is the only layer that knows the bank API's details (URLs, pagination, response format); its internal types never leak past that file. `AppModule` is the only place domain and infrastructure meet, through NestJS dependency injection (`BankPort` is a `Symbol` token, since TypeScript interfaces no longer exist at runtime).

### Why a hexagonal architecture here

The core functional need (aggregating accounts and transactions from a bank API) would fit in a simple script. A hexagonal architecture is deliberately overkill for that need alone, but it demonstrates a strict domain/infrastructure separation here: the use case and entities are tested without any HTTP call (port mocks), the adapter is tested without depending on a real server (mocked axios), and the only test that actually speaks HTTP is the controller's integration test — which also simulates the bank API rather than calling it (see below).

### Pagination

List endpoints (accounts, transactions) are paginated via `link.next` (a relative URL, or `null` at the end of pagination). The adapter loops while `link.next` isn't `null`, never assuming a single page is enough. The provided mock deliberately pushes this pagination far (up to 22 account pages), which made it possible to verify this behavior under real conditions rather than only against mocks.

### Deduplication

The mock server sometimes repeats the same transactions across pages (observed in practice on the provided data). The adapter deduplicates transactions by `id` (via a `Map`, which preserves insertion order) before returning the result to the domain — deduplication is an infrastructure detail; the domain always receives a clean list.

### Per-account error isolation

`AggregateAccountsUseCase.execute()` fetches every account's transactions in parallel via `Promise.allSettled` (not `Promise.all`): if one account fails (inconsistent data on the provider's side, a transient network error...), it's returned with an empty transaction list instead of failing the whole aggregation. This choice was validated in practice: the mock data (`server/myInfos.json`) contains an inconsistency (an account listed under one number in `/accounts` but indexed differently in transactions), which makes that specific account's transactions call fail every time.

### Error handling

The adapter converts every axios error into a domain exception before it leaves the adapter: a 401 becomes `BankAuthenticationException`, a network error (mock unreachable) becomes `BankUnavailableException`, anything else becomes an `Error` with a clean message — no raw axios error ever reaches the domain. `AllExceptionsFilter`, registered globally through the `APP_FILTER` provider, turns these exceptions into structured JSON responses:

```json
{
  "statusCode": 401,
  "message": "Authentication failed: 401 Unauthorized",
  "timestamp": "2026-08-13T15:56:22.997Z",
  "path": "/aggregated-accounts"
}
```

| Cause | Code |
| --- | --- |
| `BankAuthenticationException` (invalid credentials) | 401 |
| `BankUnavailableException` (mock server unreachable) | 503 |
| Any other unhandled error | 500 |

## Test strategy

- **Domain** (`aggregate-accounts.use-case.spec.ts`): `BankPort` mocked, no HTTP call.
- **Adapter** (`*.adapter.spec.ts`): `HttpService` mocked, no call to a real mock server.
- **Controller / DI** (`app.controller.spec.ts`): the full HTTP → controller → use case → DTO pipeline is exercised via `supertest` against a real Nest instance, but `BankPort` is replaced there with a fake implementation (`overrideProvider`). The bank API is treated the way a real third-party API would be treated in production: simulated by the test suite, never called by it.

Behavior against the *real* mock server (actual pagination across ~22 pages, the data inconsistency, deduplication of repeated transactions, real 401/503 codes) was verified manually during development rather than automated in CI, to keep the test suite fast and deterministic.

## Environment variables

See [`.env.example`](.env.example).

| Variable | Description |
| --- | --- |
| `PORT` | Application listening port (3001 by default, different from the mock which is fixed on 3000) |
| `BANK_URL` | Bank API URL (mock server locally) |
| `BANK_CLIENT_ID` / `BANK_CLIENT_SECRET` | Client credentials for `POST /login` |
| `BANK_LOGIN` / `BANK_PASSWORD` | User credentials for `POST /login` |

With `docker-compose`, `BANK_URL` is automatically overridden to `http://mock-server:3000` (the service name on the Docker network); the value from `.env` is for running outside containers.

## Available commands

```bash
npm run start:dev      # Start the application in watch mode
npm run start-server    # Start the mock bank server (outside Docker)
npm run test             # Unit + integration tests
npm run test:cov        # Tests with coverage
npm run lint              # ESLint (with --fix)
npm run typecheck       # TypeScript check without emitting
npm run build             # Production build
```

## Tech stack

NestJS · TypeScript · Jest · Swagger (`@nestjs/swagger`) · Docker / Docker Compose · `@nestjs/config`

## Conventions

- Code, comments and commits in English ([Conventional Commits](https://www.conventionalcommits.org/))
- Strict domain / infrastructure separation: no HTTP dependency in `src/domain`
- No secret committed, everything goes through `.env`
