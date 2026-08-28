# Desarrollo local de Cloud Sync (Fase 1P)

## Arquitectura

Las operaciones se confirman primero en Edge/SQLite. En la misma transacción comercial se conserva el Domain Event en `event_log`; posteriormente `SyncWorker` reclama eventos por lotes, los envía a Cloud API y procesa el ACK por `eventId`. Cloud persiste el envelope en PostgreSQL antes de reconocerlo. `event_id` es único, por lo que un retry después de perder el ACK no duplica el hecho.

Cloud no participa en el command path de POS, Waiter, KDS, Printing, Payments ni Cash. Sin configuración Cloud, Sync queda desactivado y el resto de Edge funciona normalmente.

## Requisitos

- Node.js 24 y pnpm.
- PostgreSQL 18. El archivo `docker-compose.cloud.yml` ofrece únicamente PostgreSQL de desarrollo; Edge continúa ejecutándose fuera de Docker.
- Docker Desktop, si se usa esa opción.

## Preparación (PowerShell)

Los siguientes valores son identificadores y credenciales efímeras de desarrollo. No deben reutilizarse en una instalación real.

```powershell
$env:COMANVIEW_DEV_POSTGRES_PASSWORD = "choose-a-local-password"
pnpm dev:cloud:db

$env:DATABASE_URL = "postgresql://comanview_dev:$env:COMANVIEW_DEV_POSTGRES_PASSWORD@127.0.0.1:5432/comanview_dev"
pnpm dev:cloud:migrate

$env:COMANVIEW_EDGE_ID = "01991a00-0000-7000-8000-0000000009a1"
$env:COMANVIEW_EDGE_SYNC_TOKEN = [Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 })).ToLower()
$edgeCredential = @{
  edgeId = $env:COMANVIEW_EDGE_ID
  tenantId = "01991a00-0000-7000-8000-000000000301"
  locationId = "01991a00-0000-7000-8000-000000000302"
  token = $env:COMANVIEW_EDGE_SYNC_TOKEN
} | ConvertTo-Json -Compress
$env:COMANVIEW_CLOUD_EDGE_CREDENTIALS = "[$edgeCredential]"
```

En una terminal que conserve `DATABASE_URL` y `COMANVIEW_CLOUD_EDGE_CREDENTIALS`:

```powershell
pnpm dev:cloud
```

En otra terminal, copie `COMANVIEW_EDGE_ID` y `COMANVIEW_EDGE_SYNC_TOKEN`, y ejecute:

```powershell
$env:COMANVIEW_CLOUD_URL = "http://127.0.0.1:4000"
$env:COMANVIEW_SYNC_ENABLED = "true"
$env:COMANVIEW_EDGE_DB_PATH = "./apps/edge/edge-sync-dev.db"
pnpm dev:local
```

El primer arranque fija `edgeId`, `tenantId` y `locationId` en SQLite. Un valor distinto en arranques posteriores se rechaza deliberadamente. Para una prueba de desarrollo desde cero puede eliminarse **solo** `apps/edge/edge-sync-dev.db` (con Edge detenido); nunca use el helper `dev:prepare` contra una base productiva.

## Prueba offline/reconnect

1. Inicie PostgreSQL, Cloud API y Edge/POS. Complete una venta.
2. Consulte el estado con una sesión local que tenga `AUDIT_VIEW` (el siguiente PIN pertenece exclusivamente al seed de desarrollo):

```powershell
$login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/auth/login" -ContentType "application/json" -Body '{"pin":"1111","deviceId":"01991a00-0000-7000-8000-000000000721"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod -Uri "http://127.0.0.1:3000/sync/status" -Headers $headers
```

Debe llegar a `pendingCount: 0` y registrar `lastSuccessfulSyncAt`.

`pendingCount` representa el total todavía no sincronizado; `failedCount` y `syncingCount` muestran subconjuntos de ese total.
3. Detenga solo Cloud API. Complete otra venta: toda la operación local debe funcionar y el estado mostrará eventos pendientes/fallidos y `cloudReachable: false` después del intento.
4. Reinicie Cloud API. El worker reintentará sin tocar la venta y el conteo volverá a cero.
5. Inspeccione PostgreSQL sin exponer un endpoint de debug público:

```sql
SELECT event_id, event_type, edge_id, occurred_at, received_at
FROM cloud_sync_inbox
ORDER BY received_at;

SELECT event_id, count(*)
FROM cloud_sync_inbox
GROUP BY event_id
HAVING count(*) > 1;
```

La segunda consulta debe devolver cero filas. `edge_heartbeats` contiene el último heartbeat.

## Configuración principal

Edge: `COMANVIEW_CLOUD_URL`, `COMANVIEW_EDGE_SYNC_TOKEN`, `COMANVIEW_EDGE_ID`, `COMANVIEW_SYNC_ENABLED`, `COMANVIEW_SYNC_BATCH_SIZE`, `COMANVIEW_SYNC_POLL_INTERVAL_MS`, `COMANVIEW_SYNC_TIMEOUT_MS`, `COMANVIEW_SYNC_LEASE_MS` y `COMANVIEW_HEARTBEAT_INTERVAL_MS`.

Cloud: `DATABASE_URL`, `COMANVIEW_CLOUD_EDGE_CREDENTIALS`, `COMANVIEW_CLOUD_PORT`, `COMANVIEW_CLOUD_HOST`, `COMANVIEW_CLOUD_BODY_LIMIT` y `COMANVIEW_CLOUD_SYNC_MAX_BATCH_SIZE`.

## Límites de 1P

Cloud Inbox conserva hechos versionados pero todavía no construye proyecciones de Orders/Sales/Catalog. No hay Cloud → Edge, provisioning completo, PKI, administración, licensing, OTA ni procesamiento en `cloud-worker`. La credencial configurada por entorno es el mecanismo provisional reemplazable de 1P.
