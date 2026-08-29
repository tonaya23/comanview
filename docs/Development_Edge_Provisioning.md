# Edge Provisioning de desarrollo (Fase 1S)

Cloud es la fuente canónica de `Tenant`, `Location`, identidad Edge y hashes de credenciales. El secreto permanente se genera en Edge. En producción Windows, el secreto local usa DPAPI `CurrentUser` bajo la identidad del Windows Service y un archivo con ACL restringida. `development-file` es explícitamente no productivo.

## Flujo manual en PowerShell

Use PostgreSQL migrado hasta `0003`, Cloud API y Super Admin según `Development_Cloud_Admin.md`. El usuario bootstrap debe tener rol `PLATFORM_ADMIN`.

1. En Super Admin abra **Control Plane**, cree Tenant y Location con timezone IANA.
2. Genere el provisioning code y cópielo. Se muestra una sola vez y expira en 30 minutos por defecto.
3. Con Edge detenido, use una SQLite de prueba nueva y rutas absolutas:

```powershell
$env:NODE_ENV = "development"
$env:COMANVIEW_CLOUD_URL = "http://127.0.0.1:4000"
$env:COMANVIEW_EDGE_DB_PATH = "C:\Proyects\comanview\apps\edge\edge-provisioning-dev.db"
$env:COMANVIEW_EDGE_SECRET_STORE = "development-file"
$env:COMANVIEW_EDGE_SECRET_PATH = "C:\Proyects\comanview\.comanview\edge-provisioning-dev.secret.json"
$env:COMANVIEW_PROVISIONING_CODE = "PEGUE_AQUI_EL_CODIGO_MOSTRADO"
pnpm --filter @comanview/edge provision
```

4. Quite el código y arranque usando identidad/credencial durables:

```powershell
Remove-Item Env:COMANVIEW_PROVISIONING_CODE
$env:COMANVIEW_SYNC_ENABLED = "true"
pnpm dev:local
```

Un reinicio offline posterior a `ACTIVE` no requiere Cloud. El command path local continúa operativo; Sync/heartbeat reintentan cuando Cloud vuelve. Un Edge `REVOKED` o `REPLACED` será rechazado al reconectar.

## Rotación iniciada por Edge

```powershell
pnpm --filter @comanview/edge provision -- rotate
```

Edge persiste B `PENDING`, la registra usando A y confirma posesión usando B. Después B pasa a `ACTIVE` y A a `RETIRING` durante el overlap. Los retries reutilizan B y el mismo `rotationId`.

## Replacement y recuperación

El provisioning code de un Replacement se entrega una sola vez. Si se pierde o revoca antes del exchange, Super Admin permite cancelar el Replacement `PENDING` mientras `new_edge_id` siga vacío. La cancelación requiere motivo y permiso, registra `EDGE_REPLACEMENT_CANCELLED`, inutiliza el código asociado y deja el Edge anterior exactamente en `ACTIVE`; después puede iniciarse un Replacement nuevo.

La cancelación no está permitida después del exchange ni del cutover. Mientras exista un Replacement `PENDING`, Cloud rechaza revocar su Edge anterior e indica cancelar primero. El cutover bloquea la Location y ambos Edges dentro de una transacción: debe completar exactamente `old ACTIVE → REPLACED` y `new PROVISIONING → ACTIVE`, o revierte todo sin marcar el Replacement `COMPLETED`.

## Compatibilidad de desarrollo

`COMANVIEW_CLOUD_EDGE_CREDENTIALS`, `COMANVIEW_EDGE_SYNC_TOKEN` y `COMANVIEW_EDGE_ID` quedan solo para desarrollo/test de fases anteriores. Cloud y Edge los rechazan en `NODE_ENV=production`.

Provisioning/recovery de credencial, decommission y factory wipe son operaciones distintas. Ningún flujo 1S borra la SQLite operacional.

## Dependencia conocida para Fase 1U

Provisionar un binding nuevo de Tenant/Location no crea automáticamente usuarios ni dispositivos locales listos para login operacional. Device Pairing e Installation Readiness pertenecen a Fase 1U; los seeds y credenciales legacy de desarrollo no son una solución productiva para esa preparación inicial.
