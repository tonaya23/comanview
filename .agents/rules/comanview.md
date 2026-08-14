# ComanView — Repository Rules

## Source of Truth

This repository implements ComanView V1.

The authoritative product and architecture specification is:

@../../Master_PRD.md

Read the relevant sections of `Master_PRD.md` before implementing or changing domain behavior.

If code and the PRD conflict, the PRD wins unless the user explicitly changes the specification.

Do not invent missing financial, security, synchronization, licensing, or lifecycle rules.
If a required behavior is genuinely undefined, stop and identify the ambiguity before implementing it.

## Documentation Hierarchy

Debe establecer explícitamente esta jerarquía:

1. `Master_PRD.md` — fuente normativa y autoritativa para implementación.
2. `docs/Master_Technical_Specification.md` — referencia técnica ampliada.
3. `docs/Full_Specification.md` — referencia completa para razonamiento, ejemplos, edge cases y contexto adicional.

Reglas:

- Ante cualquier contradicción, `Master_PRD.md` prevalece.
- Los documentos de referencia MUST NOT sobrescribir una regla explícita de `Master_PRD.md`.
- Antes de implementar comportamiento de dominio, consulta primero la sección relevante de `Master_PRD.md`.
- Si `Master_PRD.md` no proporciona suficiente detalle, consulta `Master_Technical_Specification.md`.
- Si aún se necesita contexto adicional, consulta `Full_Specification.md`.
- No cargues o analices innecesariamente los documentos completos para cada tarea; consulta únicamente las secciones relevantes cuando sea posible.
- Si existe una contradicción real que no pueda resolverse mediante esta jerarquía, detente y pregúntame antes de implementar.

## Core Architecture

ComanView is Offline-First.

The restaurant Edge is the authoritative local operational system.

Cloud MUST NOT be required to:
- create or modify local Orders;
- send kitchen rounds;
- print;
- use KDS;
- accept local Payments;
- operate CashSessions;
- execute Corte X or Corte Z.

Internet loss is a normal operating condition.
Edge loss is a local critical failure.

Clients express intent.
Edge validates and commits authoritative state.

The browser clients MUST NOT become independent transactional authorities.

## Technology

Primary language: TypeScript.

Runtime: Node.js 24 LTS.

Edge:
- Node.js;
- Fastify;
- SQLite;
- WAL mode;
- better-sqlite3 initially;
- Drizzle;
- Zod;
- REST + WebSocket.

Cloud:
- Node.js;
- Fastify;
- PostgreSQL;
- Drizzle;
- background workers.

Clients:
- React;
- Vite;
- PWA where applicable.

Public Storefront:
- Next.js;
- Cloud-hosted only;
- MUST NOT connect directly to restaurant Edge.

Monorepo:
- pnpm workspaces;
- Turborepo.

Testing:
- Vitest;
- real SQLite/PostgreSQL integration tests;
- Playwright for E2E.

## Architecture Boundaries

`packages/domain` MUST NOT depend on:
- Fastify;
- React;
- Next.js;
- Vite;
- Drizzle;
- SQLite;
- PostgreSQL;
- AWS.

Domain code contains:
- entities;
- value objects;
- invariants;
- state transitions;
- domain services;
- domain errors;
- domain events.

Transport and persistence depend inward toward the domain.
The domain never depends outward toward infrastructure.

Preferred mutation flow:

Transport
→ Runtime validation
→ Application command
→ Domain
→ Repository
→ Database transaction
→ Domain/Event Log
→ COMMIT
→ notification

HTTP routes MUST remain thin.
Do not put business rules directly inside Fastify route handlers.

Domain objects MUST NOT automatically become API response objects.
Use explicit contracts and mappers.

## Domain Rules

Use UUID v7 for new globally unique entity identifiers unless explicitly documented otherwise.

Human-readable numbers such as `order_number` are separate from technical IDs.

`order_type` and `order_channel` are separate concepts.

V1 order types:
- COUNTER;
- TABLE;
- TAKEOUT.

V1 order channels:
- POS;
- WAITER.

Order primary states:
- OPEN;
- CLOSED;
- CANCELLED.

OrderItem send states:
- DRAFT;
- SENT.

Preparation states:
- PENDING;
- PREPARING;
- READY.

A SENT item MUST NOT disappear or be silently rewritten.

A CLOSED or CANCELLED Order MUST NOT be reopened or directly edited through normal V1 flows.

Payment completion and Order closure are different domain facts.

Historical transactional data MUST NOT be recalculated from current catalog state.

Product snapshots are captured when the OrderItem is created, including while DRAFT.

`active` and `available` are distinct Product concepts.

## Financial Rules

Edge is the authoritative financial calculator.

Never trust totals calculated by a client.

Money MUST use exact arithmetic.

Use integer minor units as the default representation.
Never use binary floating-point as authoritative money.

Keep separately:
- sale amount;
- tax;
- discount;
- comp;
- tip;
- cash tendered;
- amount applied;
- change.

Payment creation and its financial effect MUST be atomic.

Critical financial commands MUST be idempotent.

A POS Payment requires an OPEN CashSession.

CARD payments in V1 represent the administrative record in ComanView.
ComanView does not control the external bank terminal.
Voiding a CARD Payment does not automatically reverse the bank transaction.

## Persistence and Events

Use Current State + immutable Event Log.

Do not implement pure Event Sourcing for the entire application.

Edge Event Log also acts as the Transactional Outbox.

Business mutation and its synchronizable event MUST be committed atomically.

Cloud uses an idempotent Inbox.

Duplicate `event_id` MUST produce one logical Cloud effect.

Sync batches MAY be partially accepted.
Only acknowledged events may become SYNCED.
Rejected events remain retryable/diagnosable.

Cloud configuration received by Edge MUST be persisted locally for Offline operation.

WebSocket is notification transport, not transactional authority.

Emit success notifications only after authoritative persistence/commit.

## Concurrency

Do not rely on timestamps alone for concurrency.

Orders use logical versioning.

Commands requiring optimistic concurrency SHOULD include `expected_version`.

Edge MUST validate every mutation against current authoritative state.

Retries MUST NOT duplicate business effects.

## Printing

Printing is controlled by Edge.

Every print operation is represented by a durable PrintJob before transmission.

Printing failures MUST NOT revert successful financial transactions.

Print queues MUST survive Edge restart.

Uncertain physical transmission MUST NOT be blindly retried as if nothing was sent.

Printer access MUST be behind PrinterAdapter abstractions.

Order, Payment, Cash, and KDS domain code MUST NOT depend directly on ESC/POS libraries.

## Security

Authorization is enforced server-side by Edge or Cloud according to authority.

UI visibility is not authorization.

Use RBAC permissions rather than hard-coded role-name checks.

Every employee has an individual identity.

Users have operational states such as ACTIVE or DISABLED.

Sensitive actions require Audit Log when specified by the PRD.

OWNER has maximum authority but never bypasses audit.

Audit history is append-only through normal application flows.

Never log:
- passwords;
- PINs;
- private keys;
- complete auth tokens;
- PAN;
- CVV;
- secrets.

## Time

Persist unambiguous timestamps.

Keep these concepts separate:
- UTC timestamp;
- Location timezone;
- business_date.

`business_date` MUST NOT be reconstructed solely from UTC or calendar midnight.

## Backup and Recovery

SYNC is not BACKUP.

Database corruption MUST NOT create a fresh empty production database.

Corruption enters RECOVERY_REQUIRED.

Sensitive schema migrations require a valid pre-update backup.

Application rollback MUST NOT assume database rollback is safe.

One Location has one primary operational Edge in V1.

Do not introduce active-active Edge behavior.

## Scope Control

Do not implement V2 features unless explicitly requested.

Do not introduce without demonstrated need:
- Kubernetes;
- Kafka;
- Redis on Edge;
- RabbitMQ on Edge;
- Docker on Edge;
- Electron;
- React Native;
- Go services;
- Rust services;
- browser gRPC;
- GraphQL for the local API;
- LibSQL replication as the Sync Engine;
- multiple primary Edges.

Prefer the simplest implementation that preserves all domain invariants.

## Development Rules

Before modifying domain behavior:
1. read the relevant PRD section;
2. identify affected invariants;
3. implement the smallest coherent change;
4. add or update tests;
5. run typecheck and tests.

Do not weaken an invariant just to make a test pass.

Do not bypass domain/application layers for convenience.

Do not directly modify production-style database schemas outside migrations.

Do not silently swallow errors.

Use stable machine-readable domain error codes.

Prefer explicit code over clever abstractions.

Avoid premature generic frameworks.

Do not create abstractions until at least one real boundary requires them.

## Commands

Install:
`pnpm install`

Development:
`pnpm dev`

Build:
`pnpm build`

Lint:
`pnpm lint`

Typecheck:
`pnpm typecheck`

Unit tests:
`pnpm test`

Integration tests:
`pnpm test:integration`

E2E:
`pnpm test:e2e`

Run Edge only:
`pnpm --filter @comanview/edge dev`

Test domain only:
`pnpm --filter @comanview/domain test`

## Definition of Done

A task is not complete until:
- relevant PRD invariants remain satisfied;
- runtime inputs are validated;
- error behavior is explicit;
- typecheck passes;
- relevant unit/integration tests pass;
- no unrelated architecture was introduced.

For critical transaction changes, test at least:
- normal success;
- invalid state;
- retry/idempotency;
- concurrency where applicable;
- process/network failure where applicable.
