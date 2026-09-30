# Group B — B3 Core

Group B OPEN. B1/B2 CLOSED. B3a quantity implemented; API gate PASS.
B3b implemented / GATE PASS. B3c implemented; focal validation PASS.
B3 review and manual acceptance pending. No B3 closure.

## B3a compatibility and API gate (2026-09-21)

Orders accept either unique legacy `selectedModifierIds` (quantity 1) or explicit
`selectedModifiers: [{modifierOptionId, quantity}]`. Both representations together,
duplicate IDs and unsafe/nonpositive/noninteger quantities are rejected. Group
min/max counts the sum of quantities. Captured price remains a unit delta; quantity
multiplies that delta before item quantity and tax calculation. Existing snapshots
are never refreshed by catalog changes. A legacy DRAFT reconstruction of a snapshot
containing quantity >1 fails with `CLIENT_CAPABILITY_REQUIRED`. Modern edit/retry
preserves quantities. Reads expose quantity, with historical absence interpreted as 1.

Catalog legacy writes are a different contract: B1 already rejects
`POST /catalog/products` and `PATCH /catalog/products/:id/availability` with
409 `CLIENT_CAPABILITY_REQUIRED`. The current write boundary is `/catalog/commands`.
No rejected write route was reopened for these tests.

### Initial API failures and classification

Reproduced all 20 cases: 14 failed / 6 passed. Direct Catalog rejections are
EXPECTED_LEGACY_REJECTION; remaining failures are TEST_OUTDATED fixture dependencies,
not a demonstrated quantity compatibility regression.

| Test | Request / route | Expected → actual | Classification / cause |
|---|---|---|---|
| empty-counter discard | fixture POST /catalog/products, details/price without commandId/OCC | 201 → 409 CLIENT_CAPABILITY_REQUIRED | TEST_OUTDATED: fixture uses rejected Catalog write |
| 2. POST /catalog/products | same legacy details/price shape | 201 → 409 CLIENT_CAPABILITY_REQUIRED | EXPECTED_LEGACY_REJECTION |
| 3. GET /catalog/products/:id | GET with undefined ID after failed creation | 200 → 500 invalid EntityId | TEST_OUTDATED: missing fixture ID |
| 4. PATCH availability | legacy `{available:false}`, no commandId/OCC | 200 → 409 CLIENT_CAPABILITY_REQUIRED | EXPECTED_LEGACY_REJECTION |
| 6 & 7. add item | Order POST items, commandId/expectedVersion, undefined productId, no modifiers | 200 → 400 VALIDATION_ERROR | TEST_OUTDATED: missing fixture ID |
| 12. retry | same Order add shape | 200 → 400 VALIDATION_ERROR | TEST_OUTDATED: missing fixture ID |
| 11. OCC | Order add with stale version but undefined productId | 409 STALE_ORDER_VERSION → 400 VALIDATION_ERROR | TEST_OUTDATED: validation precedes OCC |
| 8. send round | Order POST rounds, commandId/expectedVersion | 200 → 409 NO_DRAFT_ITEMS | TEST_OUTDATED: add never succeeded |
| 10. remove SENT | DELETE item, undefined item ID | 409 ORDER_ITEM_SENT → 500 invalid EntityId | TEST_OUTDATED: no item was created |
| 9. remove DRAFT | Order add prerequisite, undefined productId | 200 → 400 VALIDATION_ERROR | TEST_OUTDATED: missing fixture ID |
| 20. partial CASH | POST payments, amountApplied=105, tip/tendered/OCC | 200 → 409 PAYMENT_OVERPAYMENT | TEST_OUTDATED: empty order balance=0 |
| 21. mixed payment | POST payments, CARD amountApplied=1395/OCC | 200 → 409 PAYMENT_OVERPAYMENT | TEST_OUTDATED: empty order balance=0 |
| 15. close | POST close after failed prerequisite add; undefined expectedVersion | 409 ORDER_BALANCE_NOT_ZERO → 400 VALIDATION_ERROR | TEST_OUTDATED: invalid dependent request |
| 13 & 16. restart | GET persisted order | CLOSED → OPEN (200) | TEST_OUTDATED: preceding close never succeeded |

These failing Catalog fixtures did not use either modifier representation. The
existing Order modifier case uses allowed `selectedModifierIds` and passes with its
CashSession prerequisite. Test-only fixed product data now separates Order coverage
from Catalog creation; dedicated B1 command tests remain authoritative for Catalog
writes. Legacy rejection tests also assert no availability mutation.

Final affected API file: **21/21 PASS, no skips**. Added one integrated case covering
modern quantity 1/2, legacy unique IDs, duplicate/invalid requests without partial
writes, legacy read of quantity 2, capability rejection, modern edit/retry and restart.
Its fixture uses the real Store and productive 14→15→16→17 transitions, not a schema
marker shortcut. The existing schema14 scenario reads historical modifier rows as 1.
Edge typecheck PASS. Prior quantity/domain/persistence/UI/printing focal results remain
applicable; no global suite repeated. No production change was needed for this API fix.

## Protected lifecycle

0017 adds persisted modifier quantity with default 1 and positive safe-integer checks.
The existing protected lifecycle uses the explicit
`CATALOG_MODIFIER_QUANTITY_16_TO_17` journal, schema fingerprint validation, safety
snapshot and monotonic Floor advancement. Restore16 under Floor17 upgrades before
NORMAL; restore17 validates without a fictitious migration. Binding, Personnel,
Licensing, epoch and revocation semantics are unchanged. No modifier business state
is stored in the Floor.

### Modifier versions: schema18 (2026-09-21)

Incremental 0018 adds `modifier_groups.version` and `modifier_options.version`.
Existing rows receive baseline 1, not reconstructed history. Positive safe-integer
constraints match the command version contract. 0017 is unchanged; schema17 keeps
its prior fingerprint and quantity semantics.

The explicit `CATALOG_MODIFIER_VERSION_17_TO_18` transition reuses the same writer
reservation, encrypted safety snapshot, protected journal, integrity/fingerprint
verification, Floor CAS and completion protocol. No second Floor or business state
in the Floor. Startup chains 15→16→17→18 without skipping transition evidence.
Restore under Floor18 applies missing schema steps inside the authorized restore
transaction before NORMAL; the known minimum never goes back to 17. Backup18 is
validated without a fictitious migration. A runtime capped at 17 fails closed.

Validation: 2/2 SQLite schema tests and 29/29 complete focal Catalog lifecycle tests
PASS (no skips in either final file run). Coverage includes baseline preservation,
constraints, SQL rollback, partial18 detection, idempotence, chained upgrade,
before-migration/post-SQLite/post-Floor interruption, stale writer rejection and
encrypted restore15/16/17/18 under Floor18. Existing Personnel, Licensing, revocation,
binding and epoch checks remain in the lifecycle. No operational lab was migrated
manually or started by this work. Acceptance harness now expects runtime schema18.

This closes only the schema/lifecycle prerequisite, not the B3b functional gate.
### B3b progress and assignment blocker resolution (2026-09-21)

At this intermediate checkpoint, Group/Option command contracts and transactional mutations were in progress, with
own OCC versions, parent Group version advancement for Option changes, receipts,
Audit/Event, generation and post-commit notification. A permission-protected
modifier read endpoint and SDK method were added. Cloud projection/baseline
extensions are implemented but not yet certified with real PostgreSQL. Admin UI
and B3c assignments remain pending; no functional completion is claimed.

The prior HTTP failure exposed two legacy exact-schema16 checks: application
authorization and the shared Product assignment transaction. Both now use the
same feature-minimum policy (16), with strict schema fingerprints for supported
16/17/18. The application also requires actual schema == Floor minimum, established
binding, matching epoch, NORMAL and no restore/upgrade journals. Validation runs
inside the same SQLite transaction under the existing Floor read lease, including
receipt retries. Unknown future or partial schemas fail closed. No Floor protocol,
historical migration, Product OCC, permission or snapshot semantics changed.

The blocker is resolved: 29/29 focal authorization cases, 17/17 affected existing
Tax/Station command cases, and 3/3 real Auth/Personnel/Floor HTTP scenarios PASS.
HTTP covers both effective Tax/Station assignments, own permissions, no-op, retries
and revocation on schemas16/17/18. Negative coverage includes DB/Floor mismatch,
partial18, below-minimum/future schema, missing/corrupt Floor, binding, epoch and
recovery-in-progress. The prior 51/51 command result is not re-run in full.
Database build and Database/Edge typechecks PASS; diff check PASS.

### B3b gate PASS (2026-09-21)

Admin Local now includes Catálogo → Modificadores: compact active-filtered Groups,
dedicated editor, commercial presets mapped to numeric min/max, reusable usage
list, exact signed option prices, separate active/available, accessible reorder.
Writes use Catalog commands only. ACK uncertainty retains the immutable command;
OCC/realtime preserves drafts and requires explicit rebase. Permission-separated
read includes the operational currency without requiring unrelated Admin access.

UI and B2 regression 48/48 PASS (11 new modifier tests, 37 existing Catalog tests).
Real PostgreSQL18 schema18 pipeline PASS: mutations, negative price, statuses,
ordering, extended baseline, duplicate transport/receipt, new epoch and fresh
worker projection replay. The unrelated schema16 parameter was explicitly filtered,
not silently skipped. HTTP schema18 recheck PASS after the read DTO extension.
Contracts/UI/client-sdk/Database/Edge/POS focal builds and typechecks PASS.
Read-only visual fixture checked 768×1024 and 1366×768, including keyboard focus,
scroll reachability and no horizontal control overflow. No operational lab used.
`apps/pos/qa` is reproducible dev-only tooling, absent from the production entry.
Diff check PASS. B3b IMPLEMENTED / GATE PASS; B3c IN PROGRESS. B3 remains OPEN.

### B3c implementation and Core handoff (2026-09-21)

B3c IMPLEMENTED; B3 remains REVIEW PENDING / manual acceptance pending. Group B
OPEN; B1/B2 CLOSED. No B3d/e/f, import or Group C work is included.

Product Editor now contains “Opciones y extras”: assign reusable Groups, accessible
assignment ordering, remove only the relationship, and exact signed per-Option
price overrides. Blank or default-equal prices mean inheritance. Shared Groups
are not cloned. The configuration read model uses set queries, not per-Product
SQL queries, and includes current Group/Option versions, rules and defaults.

`SET_PRODUCT_MODIFIERS` atomically replaces the explicit Product configuration
through the existing command boundary: current authorization/Floor lease, SQLite
transaction, Product.version OCC, referenced Group versions, receipt, Audit/Event,
generation and post-commit invalidation. Group/Option mutations retain their own
versions without mass-bumping Products. Existing Tax/Station permissions and
versions remain unchanged. Invalid currency, references and unsatisfiable required
Groups fail closed. No legacy write route is used.

Product fields and modifier configuration save separately; pending drafts cannot
silently overwrite each other. Realtime preserves the draft and marks changed
versions stale. Explicit rebase confirms retaining the selected configuration;
uncertain ACK retries reuse the immutable command. Confirmed writes followed by
refresh failure are reported as pending reconciliation, not failed mutations.
Historical snapshots are unchanged; future snapshots use current shared defaults
and Product overrides, with captured unit delta × quantity.

Cloud Product projections include assignments/order/overrides; Group and Option
entities preserve own versions and states. PostgreSQL18 real pipeline validates
mutation transport, duplicate receipts/events, override inheritance and removal,
baseline with a nonempty override, fresh-worker replay and new epoch isolation.
Before baseline completion no partial entities are published; a new epoch returns
no catalog until validated completion. The initial added assertion expected an
empty list, but the existing read contract returns null; the assertion was corrected
without changing product behavior.

Final focal evidence (overlapping reruns are not added to totals):
- UI/Admin: 52/52 PASS, including 11 Group/Option and 4 Product-assignment tests;
  the 15 affected editor tests were rechecked after ACK/style adjustments.
- Catalog commands: 53/53 PASS, including shared versions, quantities, override
  inheritance, relationship removal and immutable historical snapshots.
- Real schema18 HTTP: PASS, including assignment authorization and revoked access.
- PostgreSQL18 pipeline: 1/1 selected PASS; schema16 parameter deliberately filtered.
- Captured-quantity printing, KDS persistence and Waiter logic: 1 selected test each PASS.
- Eight affected targets typecheck PASS; focal dependency/Edge/POS builds PASS.
  Final POS build and Edge/POS typecheck rechecked. No global suites or timeout changes.

Manual acceptance prerequisites: use an isolated acceptance lab with current builds,
the protected productive upgrade to schema18 and a coherent Security Floor; configure
currency and use an authorized Device/user with CATALOG_VIEW/CATALOG_MANAGE. Cloud
projection validation additionally requires canonical Cloud migration0009. Do not
apply Edge migrations manually to an existing lab. Exercise Groups/Options, shared
impact, assignments/order/overrides, two-client OCC/realtime and quantity capture
through POS/Waiter, then inspect KDS/printing snapshots. No lab was altered or manual
acceptance claimed by this implementation. Visual fixture evidence covers desktop,
tablet and keyboard behavior, not physical-device or WCAG certification.

No known blocker or DECISION_REQUIRED. NO COMMIT / NO PUSH.

### Manual acceptance load/create incident (2026-09-22)

Manual acceptance is NOT approved. Its initial runtime blocker was reproduced and
resolved: the lab `phase-1w-1x-final-20260914` still ran Edge started on September20,
with schema16/Floor16 NORMAL, while POS already served B3 UI. GET `/catalog/modifiers`
returned 404 (unregistered route); POST `/catalog/commands` returned 400 VALIDATION_ERROR
because the loaded discriminator accepted only B1 commands. Same stale-runtime cause,
not a demonstrated Auth/OCC/persistence bug. SDK safe fallback rendered generic guidance.

The normal harness Start loaded current code and performed productive 16→17→18;
no manual SQL/migration/Floor replacement. Its initial Stop refused a sub-millisecond
boot-time discrepancy; all six PID/creation-tick identities were checked exactly,
stopped using the existing verified-process primitive, and runtime evidence archived.
No process/security guard was relaxed. This boot-time precision issue remains a
separate harness limitation, not a modifier-domain defect.

Real browser retest: empty read200, create Extras (min0/max3/active)200 with success
ACK, full page reload and persisted Group, no residual error. Floor18 NORMAL/epoch0
and binding coherent; OWNER access preserved. Extras remains in the acceptance lab
as test data. This is a focal retest, not full B3 manual acceptance.

Added real HTTP/Auth/Floor18/file-SQLite coverage for empty state, create/read and
fresh application/connection reload. Existing revoked-permission assertions remain.
Selected schema18 test PASS; schema16/17 were deliberately filtered. Modifier Admin
12/12 PASS. Optional defaults already used max3; zero is still valid and means no
selection, now explicitly explained in UI without changing domain semantics.
Edge/POS typecheck, POS build and diff-check PASS. No global suite or lifecycle rerun.
NO COMMIT / NO PUSH; B3 REVIEW/MANUAL ACCEPTANCE PENDING.
