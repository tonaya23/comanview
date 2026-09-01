# Phase 1U — Device Pairing and Installation Readiness

## Device identity and credential

POS, Waiter and KDS generate a UUIDv7 `deviceId` and a random 256-bit device secret. The browser
stores both only in an IndexedDB object store scoped to that application origin. User logout does
not delete device identity. Clearing the browser profile creates a new Device that must be paired.
An in-progress pairing's request proof is stored in the same IndexedDB so a refresh can continue
polling the same durable request; it is removed after bootstrap or when the operator requests a new
code following expiry/cancellation.

The secret is submitted only in JSON request bodies over the protected local transport and never
in a URL. Edge stores a salted `scrypt-device-v1` hash of the context-prefixed secret and compares
derived keys in constant time. The stored value is not accepted as a bearer credential. V1 still
requires a trusted LAN and HTTPS at the deployment boundary: IndexedDB does not defend against
same-origin XSS, and cloning a whole browser profile clones the Device identity. Hardware
fingerprinting is deliberately out of scope.

POS restores Device identity and pairing as one correlated client state. A stored pairing is usable
only when its `deviceId` equals the current IndexedDB Device identity. Old polling responses are
generation-guarded and cannot restore a pairing after bootstrap cleanup or identity replacement.
Clearing site data and reloading creates a new Device identity and credential; the operational PIN
does not recover, recreate or replace Device proof.

Adding that new identity requires approval by an OWNER/MANAGER authenticated from another active,
accessible Device. Recovery when the last accessible Device credential is lost remains explicitly
outside Phase 1U; Super Admin installation authorization is not reused as an improvised bypass.

## Pairing lifecycle

`POST /device-pairing/requests` creates a durable `PENDING` request bound to the exact
Edge/Tenant/Location/Device. Its six-digit CSPRNG code expires after ten minutes. Edge stores only
the contextual code hash and request-token hash. Invalid attempts are durable; the fifth attempt
locks the request for one minute. Approval is transactional and single-use. An expired or cancelled
request may be replaced for the same still-`PENDING` Device identity; an `ACTIVE` or `REVOKED`
identity cannot be paired again.

`REVOKED` is terminal for that durable Device row and credential. If the same physical browser
still possesses the historical credential and requests pairing with the revoked `deviceId`, Edge
verifies that proof against the stored revoked credential hash and returns
`DEVICE_REPAIR_REQUIRED`. POS may rotate its IndexedDB identity only for that authoritative signal:
it compare-and-replaces the expected identity with a new UUIDv7 and independent 256-bit credential,
removes only the old pairing material, and retries pairing once. A wrong credential, an `ACTIVE`
Device, `DEVICE_ALREADY_REGISTERED`, network/auth/licensing errors or a stale local identity never
trigger rotation. The historical Device remains `REVOKED`; the replacement starts as a distinct
`PENDING` Device and must pass normal approval and Device-limit enforcement.

`ACTIVE` is the durable terminal/historical pairing state: the request was consumed and its Device
was activated. `expiresAt` governs approval only while the request is `PENDING`; it does not turn an
already `ACTIVE` historical row into `EXPIRED`, and the client must not present that timestamp as
remaining authorization validity. POS removes terminal `ACTIVE` pairing material from its
operational client state. `EXPIRED` and `CANCELLED` cannot complete onboarding and expose only the
supported action to request a new pairing.

POS, Waiter and KDS retain a non-secret local authorization marker only after an authoritative
pairing response, successful login, or restored session confirms the Device as `ACTIVE`. Their PIN
screens then hide redundant pairing controls. `REVOKED` remains explicit and offers re-pair through
the existing one-time identity rotation. This marker only drives presentation; Edge remains the
authorization authority.

After initial installation, an authenticated local actor with `DEVICE_PAIR` may approve another
Device without Cloud. `DEVICE_VIEW`, `DEVICE_PAIR`, `DEVICE_REVOKE` and
`INSTALLATION_READINESS_VIEW` are granted to OWNER and MANAGER through RBAC mappings. Usable LKG
licensing and the signed per-type Device limit remain mandatory.

## First Device and initial OWNER

The initial path is not opened merely because there are zero active Devices. Super Admin issues a
short-lived Ed25519 `comanview-installation-authorization`, using the 1T signing keyring, bound to
the precise pairing, code hash, Device, Tenant, Location, active Edge and contractual initial OWNER.
The OWNER PIN is entered only at Edge and never reaches Cloud.

Edge verifies signature, `kid`, binding, expiry, request proof, bootstrap state, usable licensing
and Device limits. One SQLite transaction creates the OWNER with a salted PIN hash, assigns OWNER
RBAC, activates the Device credential, consumes pairing/authorization, permanently changes
`installation_state` to `COMPLETED`, and appends Audit with actor type
`CLOUD_ADMIN_AUTHORIZATION`. Completion is idempotent for the same signed authorization. A durable
best-effort ACK later marks the Cloud authorization `CONSUMED`; Cloud availability is not required
to commit the local installation. Super Admin can query the latest authorization's safe
`ISSUED/CONSUMED/EXPIRED/REVOKED` status without retrieving its signed envelope again.

### Transferring pairing bindings to Super Admin

For the first Device, POS renders **Datos para autorizar este dispositivo** and copies one strict,
versioned JSON block containing `pairingId`, the temporary six-digit `pairingCode`, `deviceId`,
`deviceType` and the exact `displayName` stored by Edge. In Super Admin, **Autorizar instalación
inicial** asks for that block once and validates it with the shared contract. The technical bindings
are not entered or edited independently; Super Admin asks separately only for the contractual
initial OWNER display name.

The administrator copies the resulting signed `InstallationAuthorization` once, pastes it into
POS, enters the initial OWNER PIN locally, and asks Edge to complete bootstrap. Edge still compares
every signed binding—including the exact Device `displayName`—against its durable pairing and
rejects any mismatch without consuming the pairing or creating the OWNER.

The copied pairing block is short-lived installation material for an authorized installer. It
contains the temporary pairing code, but never the Device credential, request token, PIN, internal
hashes, Edge secret, session token, signed authorization, signature or key material. It must not be
logged or retained after onboarding. Losing or altering an expired block requires a new pairing and
a new authorization; existing rows must not be edited manually.

Revoking every Device does not reopen bootstrap. Full Device recovery is deferred.

## Device limits and 1T compatibility

The 1T design described Device limits but did not transport or persist them. Phase 1U closes that
gap incrementally with `deviceLimits = { POS, WAITER, KDS }`, where each value is a non-negative
integer or `null` for no explicit limit. Existing plans without limit rows and signed legacy
LicenseDocuments without `deviceLimits` are preserved: existing Devices continue to authenticate,
but new activation fails with `DEVICE_LIMITS_UNAVAILABLE`. Lowering a limit never revokes existing
Devices; excess only blocks further activation.

## Revocation, offline behavior and Audit

Revocation changes `ACTIVE → REVOKED`, revokes the hash credential and every Device session, and
appends the user-attributed Audit record in one transaction. Device proof + local PIN and all normal
sessions work without Cloud after installation. Additional pairing and revocation are also local.

Audit supports `USER`, `CLOUD_ADMIN_AUTHORIZATION` and narrowly-scoped `SYSTEM` actors. Codes,
request tokens, PINs, device secrets/hashes, signed envelopes, signatures, headers, PEM and Edge
secret-store data are never Audit payloads.

## Installation Readiness

`GET /installation/readiness` is protected by `INSTALLATION_READINESS_VIEW`. It derives technical,
operational, licensing, catalog, user, RBAC, cash register, station, printing, Device, bootstrap and
Sync states from current durable data. Backup remains `PENDING_PHASE / PENDING_1V`, therefore
`productionReadiness` remains `NOT_READY`; this does not disable local development operation.

Manual validation of the complete installation sequence and the previously deferred 1T operational
scenarios remains pending. Phase 1U does not implement Backup/Recovery, OTA or Storefront.

Remaining 1U UX closure work includes visually aligning the Devices/installation panel with POS,
styling its controls, differentiating default Device display names, reconciling expired pairing
display in Admin, exposing pairing cancellation appropriately, and reviewing Spanish pairing
terminology. These presentation items do not change Device lifecycle or authorization rules.

## Clean 1U Manual Validation Environment

The isolated development environment prepared for the manual 1U validation uses:

- Tenant `ComanView 1U Clean Test`;
- Location `1U Clean Location`;
- Edge database `C:\Proyects\comanview\apps\edge\edge-1u-clean-test.db`;
- Edge secret store `C:\Proyects\comanview\.comanview\edge-1u-clean-test.secret.json`;
- DPAPI-protected runtime settings under
  `%LOCALAPPDATA%\ComanView\Development\1u-clean`;
- the existing Ed25519 development key files under
  `%LOCALAPPDATA%\ComanView\dev-licensing-keys` with `kid=dev-1t-current`.

The runtime settings and secret material stay outside source control. The checked-in
`scripts/Load-1UDevelopmentEnvironment.ps1` helper reads them without printing the PostgreSQL
password, Cloud Admin password, private signing key, public key contents or Edge credential. Its
`-Environment` parameter selects an isolated profile under
`%LOCALAPPDATA%\ComanView\Development`; it defaults to `1u-clean` for backward compatibility. The
Cloud-only process receives the private key; Edge receives only the public keyring. After a Windows
restart, open separate PowerShell terminals at `C:\Proyects\comanview` and use this order.

Terminal 1 — PostgreSQL and migrations:

```powershell
docker start comanview-cloud-development-postgres-1
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Target Database
pnpm --filter @comanview/database cloud:migrate
```

Terminal 2 — Cloud API (leave open):

```powershell
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Target Cloud
pnpm --filter @comanview/cloud-api dev
```

Terminal 3 — Super Admin (leave open):

```powershell
pnpm --filter @comanview/super-admin dev
```

Open `http://localhost:5176`. To copy the local development password without displaying it:

```powershell
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -CopyCloudAdminPassword
```

Terminal 4 — provisioned Edge (leave open):

```powershell
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Target Edge
pnpm --filter @comanview/edge dev
```

Terminal 5 — POS (leave open):

```powershell
pnpm --filter @comanview/pos dev
```

Open `http://localhost:5173`. Before starting the validation, use browser DevTools → Application →
Storage → **Clear site data** for `localhost:5173` only, then reload. This removes the old POS
IndexedDB Device identity without touching Edge or Cloud data. The expected first screen is an
unauthorized Device with the **Emparejar dispositivo** action.

Cloud health and Edge health can be checked without credentials:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-RestMethod http://127.0.0.1:3000/health
```

The current clean Edge is `658d42e2-e777-443a-81da-5f86020ad82c`. The following read-only query
confirms heartbeat and signed-control convergence without exposing credentials or document
contents:

```powershell
docker exec comanview-cloud-development-postgres-1 psql -U comanview_dev -d comanview_dev -P pager=off -c "SELECT e.status,h.last_seen_at,now()-h.last_seen_at AS heartbeat_age FROM edges e LEFT JOIN edge_heartbeats h ON h.edge_id=e.edge_id WHERE e.edge_id='658d42e2-e777-443a-81da-5f86020ad82c'; SELECT d.document_type,d.revision,CASE WHEN a.revision IS NULL THEN 'PENDING' ELSE 'ACKED' END AS ack_status FROM cloud_signed_control_documents d LEFT JOIN cloud_edge_control_state_acks a ON a.edge_id=d.edge_id AND a.document_type=d.document_type AND a.revision=d.revision WHERE d.edge_id='658d42e2-e777-443a-81da-5f86020ad82c' ORDER BY d.document_type,d.revision;"
```

Before the first pairing, a read-only SQLite check must report zero Users, Devices and pairing
requests, plus `PENDING` bootstrap:

```powershell
$code = @'
const Database = require('better-sqlite3');
const db = new Database('C:/Proyects/comanview/apps/edge/edge-1u-clean-test.db', { readonly: true });
for (const table of ['users', 'devices', 'device_pairing_requests']) {
  console.log(table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}
console.log(db.prepare("SELECT bootstrap_status FROM installation_state WHERE singleton_key='PRIMARY'").get());
db.close();
'@
pnpm --filter @comanview/database exec node -e $code
```

In Super Admin, open **Control Plane**, select `1U Clean Location`, and verify its active Edge,
license and Device limits (`POS=2`, `WAITER=2`, `KDS=1`). Those conditions make **Autorizar
instalación inicial** available once POS creates the first pairing. Stop there until the supervised
manual bootstrap begins; do not issue or consume an installation authorization during environment
preparation.

### Preserved second clean validation profile

The independent `1u-clean-2` profile preserves the first validation environment and uses:

- Tenant `ComanView 1U Clean Test 2` (`c82446be-0542-469a-81bf-550315914e2f`);
- Location `1U Clean Location 2` (`786de08f-ae1b-4257-afed-454024d32328`);
- Edge `84d9ffd9-7909-4375-9b57-305fcf8217f9`;
- database `C:\Proyects\comanview\apps\edge\edge-1u-clean-2.db`;
- secret store `C:\Proyects\comanview\.comanview\edge-1u-clean-2.secret.json`.

Use `-Environment 1u-clean-2` for Database, Cloud, Edge and password-copy commands. For example:

```powershell
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Environment 1u-clean-2 -Target Edge
pnpm --filter @comanview/edge dev
```

Its initial durable state is zero Users, Devices and pairing requests with bootstrap `PENDING`.
The active license carries `CORE_POS`, `KDS` and `PRINTING`, with Device limits `POS=2`,
`WAITER=2`, `KDS=1`. No pairing or installation authorization is created during preparation.

## Administrative UX

POS groups local administration under **Dispositivos e instalación**. It presents the readiness
summary and every real Edge component, durable Devices and pairing requests. States use both text
and a visual badge. A request whose `expiresAt` has passed is rendered as `EXPIRED` and cannot be
approved or cancelled. Approval, cancellation and revocation keep validation feedback inside the
panel; revocation requires confirmation and explains that sessions will close and a new Device
identity will be required. No reactivation action exists.

Device state and Pairing state remain separate. A `Device PENDING` is retained after its latest
request becomes `CANCELLED` or `EXPIRED` so history and auditability are not lost and the same
pending identity may request pairing again. The UI derives installation activity: only a Device
with a currently valid `Pairing PENDING` is labelled **Pendiente activo**; otherwise it is shown as
**No completado** with the latest terminal request outcome. Active requests appear first. Terminal
requests remain available under a collapsed pairing history so old attempts do not displace the
approval workflow.

Selecting **Usar solicitud** scrolls the administration panel to the approval form and focuses the
six-digit code. Successful approval, cancellation, expiry, or another authoritative terminal state
clears the selected Pairing ID and temporary code. Correctable validation errors keep the entered
values. Waiter and KDS reuse the same onboarding hierarchy and lifecycle language as POS.

The POS cash-movement selector uses an accessible single-choice control with explicit Entrada and
Salida descriptions plus a non-color-only selected indicator. This is presentation only:
`CASH_IN` and `CASH_OUT` retain their existing financial semantics.

The Device name is captured before pairing. Duplicate names are differentiated with Device type and
a short, non-sensitive identifier suffix. Full IDs and exact timestamps are progressive-disclosure
support data. Credentials, request tokens, PINs, signing material and secret-store contents are
never rendered.

Super Admin accepts the structured pairing block in a dedicated installation form, validates its
shape and previews only public bindings before issuing the one-time signed authorization. Errors
remain contextual. This presentation does not change Ed25519 verification, binding validation,
single-use semantics or Cloud/Edge responsibilities.

Each Location also presents its assigned Plan separately from the current Cloud-authorized License
snapshot. The summary uses the License assignment revision, capabilities and Device limits as the
effective authorization data; it does not infer them from the Plan form. A null limit is labelled
**Ilimitado**, zero is **No incluido**, and positive limits retain their exact value. Feature flags
are not presented as purchased capabilities. IDs, configuration revision and timestamps remain in
technical details; signatures, envelopes and credentials are never rendered.
