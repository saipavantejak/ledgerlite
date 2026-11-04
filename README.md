# LedgerLite

A small **double-entry ledger service** with a React UI, built to show correct money handling: the database, not just the API, refuses to let the books go out of balance.

- **API:** NestJS + TypeScript (strict), PostgreSQL 16, `pg` with raw SQL migrations (no ORM)
- **Web:** React + Vite + Tailwind (four pages)
- **Tests:** Vitest, fast-check (property-based), supertest
- **Layout:** pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`

## Run it

### Everything in Docker
```bash
docker compose up --build
# UI  http://localhost:8080      API  http://localhost:3000      (dev API key: dev-key)
pnpm install && pnpm seed         # optional: load the five demo flows through the real API
```
`pnpm seed` needs `API_KEY=dev-key` in the environment because compose enables the key (`API_KEY=dev-key pnpm seed`).

### Local dev (Postgres in Docker, apps on the host)
```bash
docker compose up -d db           # also creates the ledgerlite_test database
pnpm install
cp .env.example .env              # optional; defaults already match compose
pnpm migrate                      # apply SQL migrations to ledgerlite
pnpm dev:api                      # http://localhost:3000
pnpm dev:web                      # http://localhost:5173 (proxies /api to the API)
API_KEY=dev-key pnpm seed         # demo flows (omit API_KEY if the API runs without one)
```
Set `API_KEY` in the API's environment to require the `x-api-key` header (everything except `/health`). The web app sends `VITE_API_KEY`. This is a dev-grade shared secret: it ships in the browser bundle, so it is not real authentication.

### Tests
```bash
docker compose up -d db           # or any Postgres 16 with a database named ledgerlite_test
pnpm test                         # builds shared, runs the API suite against ledgerlite_test
```
`TEST_DATABASE_URL` overrides the connection string. The test setup **drops and recreates the `public` schema** and refuses to run unless the database name ends in `_test`.

## Invariants and where each is enforced

| # | Invariant | Enforced by |
|---|-----------|-------------|
| 1 | Every transaction balances (debits = credits, at least 2 entries) | **Database:** deferred constraint trigger `trg_transaction_balanced` validates at COMMIT. The API also validates first and returns 422 so clients get a clear error. |
| 2 | Money is integer cents | `BIGINT` column with `CHECK (amount_cents > 0)`; JS `bigint` in code; the API sends and prefers amounts as **strings** because JSON numbers lose precision above 2^53. Number inputs must be safe integers. The UI converts dollars to cents by string parsing, never floats. |
| 3 | A write is all-or-nothing | Each `POST` runs in a single DB transaction. |
| 4 | The ledger is immutable | `BEFORE UPDATE OR DELETE` triggers on `transactions` and `journal_entries` raise. Corrections are reversing transactions. Balances are derived by the `account_balances` view; there is no stored balance column to drift. |
| 5 | Idempotent writes | `transactions.idempotency_key` is `UNIQUE`; `request_hash` is a SHA-256 of the canonical (key-sorted) body. |

### Idempotency
Replaying a key with the same body returns the stored transaction with **200** (201 on first post). The same key with a different body is **409**. Keys are scoped per endpoint (stored as `post|<key>` and `reverse|<key>`), so one key string can be used once for each. Parallel retries are safe: the unique index makes the losers wait for the winner, then they read the stored result.

### Reversals
`POST /transactions/:id/reverse` creates a new transaction with every entry flipped and `reference = reverses:<original id>`. The original is never touched. Reversal locks the original row, so concurrent attempts with different keys produce one reversal and the rest get **409 already reversed**.

## Schema choices
The schema is the specified one, unchanged. Additions beyond it:
- `002_indexes.sql`: lookup indexes only (FK columns, `reference` for the reversal check, and `(created_at, id)` for pagination). No columns or tables.
- `schema_migrations`: created by the tiny migration runner (`apps/api/src/db/migrate.ts`) to remember what has been applied.
- `accounts.normal_balance` is derived from `type` (asset/expense = debit, others = credit) rather than accepted from the client, so the two cannot disagree.

## API

| Method | Path | Notes |
|---|---|---|
| POST / GET | `/accounts` | list includes derived balances |
| GET | `/accounts/:id/balance` | `balanceCents` (normal side positive) and `signedBalanceCents` (debits − credits) |
| POST | `/transactions` | `{ idempotencyKey, description, reference?, entries: [{ accountId, direction, amountCents }] }` |
| GET | `/transactions/:id`, `/transactions?accountId=&limit=&cursor=` | keyset pagination, newest first |
| POST | `/transactions/:id/reverse` | `{ idempotencyKey, reason }` |
| POST | `/reconciliation/run` | manual run |
| GET | `/reconciliation/runs`, `/reconciliation/runs/:id` | the latter includes findings |
| GET | `/health` | |

Validation failures are **422**, key reuse with a different body and double reversal are **409**, unknown ids are **404**.

## Reconciliation
A daily `@Cron` job and the manual endpoint run four checks inside a `READ ONLY, REPEATABLE READ` transaction, so the job cannot write to the ledger and sees one consistent snapshot: (1) global signed sum is zero, (2) every transaction balances, (3) no orphan entries, (4) idempotency keys are unique. Failures become rows in `reconciliation_findings` and the run is marked `drift`. If the job itself errors, the run is also marked `drift` with a `jobError` finding rather than reporting a false `ok`.

## Demo flows
`pnpm seed` creates the six accounts and posts the five flows through the HTTP API with fixed idempotency keys (safe to re-run). Expected result: Cash 33450 cents, Member Wallet 33450, Provider Payable 0, Card Clearing 0.

## Deployment targets
- **Web → Vercel:** root `apps/web`, build `pnpm --filter @ledgerlite/shared build && pnpm --filter @ledgerlite/web build`, output `apps/web/dist`. Set `VITE_API_URL` to the API's public URL and `VITE_API_KEY`.
- **API → Fly.io or Render (Docker):** use `apps/api/Dockerfile` with the repo root as build context. Set `DATABASE_URL`, `API_KEY`, `CORS_ORIGIN` (the web origin). Migrations run on container start.
- **Postgres → Neon or any managed Postgres 16.**

## Known limitations
- `created_at` is the transaction start time (`now()`), so under concurrency a row can commit slightly after rows with later timestamps. Keyset pagination is stable per page chain but a late-committing row may be skipped by a client that has already paged past it.
- Idempotency records are kept forever (they are the ledger's own rows).
- Single tenant, USD only, no auth beyond the dev API key. Intentional per the spec.
- Entry order within a transaction is not stored (the schema has no sequence column); the API returns debits first, then credits.
