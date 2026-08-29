# Cloud Read API y Super Admin — Desarrollo (Fases 1R–1S)

Super Admin es el Control Plane privado de ComanView. Su autenticación humana es independiente de
las credenciales Edge usadas por `/sync/v1/*`; una credencial Edge nunca autoriza `/admin/v1/*`.

## Preparación local

Inicie PostgreSQL y aplique las migrations incrementales `0000 → 0001 → 0002 → 0003` siguiendo
`Development_Cloud_Sync.md`:

```powershell
$env:COMANVIEW_DEV_POSTGRES_PASSWORD = "choose-a-local-password"
pnpm dev:cloud:db
$env:DATABASE_URL = "postgresql://comanview_dev:$env:COMANVIEW_DEV_POSTGRES_PASSWORD@127.0.0.1:5432/comanview_dev"
pnpm dev:cloud:migrate
```

El bootstrap humano requiere valores elegidos localmente. Los siguientes son placeholders, no
credenciales incluidas en el repositorio:

```powershell
$env:NODE_ENV = "development"
$env:COMANVIEW_CLOUD_DEV_ADMIN_EMAIL = "admin@your-development.invalid"
$env:COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD = "choose-a-unique-local-password"
$env:COMANVIEW_CLOUD_DEV_ADMIN_DISPLAY_NAME = "Cloud Admin Local"
$env:COMANVIEW_CLOUD_DEV_ADMIN_ROLE = "PLATFORM_ADMIN"
$env:COMANVIEW_CLOUD_DEV_ADMIN_TENANT_IDS = "[]"
pnpm dev:cloud
```

`PLATFORM_ADMIN` posee scope global y los permisos de escritura del Control Plane. Para probar una
sesión global de solo lectura use `PLATFORM_ADMIN_READ`; para `SUPPORT_READ`, use ese rol y
proporcione en `COMANVIEW_CLOUD_DEV_ADMIN_TENANT_IDS` un array JSON con los Tenant UUID permitidos.
El bootstrap se ejecuta únicamente cuando ambas variables email/password están presentes y el
arranque falla si se intentan configurar bajo `NODE_ENV=production`.

Una Location canónica puede existir sin Edge `ACTIVE`. En ese estado la API de Overview conserva
`CLOUD_LOCATION_UNPROVISIONED` como precondición estructurada y Super Admin muestra un estado vacío
con acceso al Control Plane, sin dejar la vista cargando indefinidamente.

En otra terminal:

```powershell
pnpm dev:super-admin
```

Abra `http://127.0.0.1:5176`. Vite mantiene la llamada same-origin mediante proxy hacia Cloud API
en `127.0.0.1:4000`; no se habilita CORS global.

## Sesiones y permisos

El password se persiste como hash `scrypt` versionado. La sesión utiliza un token opaco de 256 bits
en cookie `HttpOnly; SameSite=Strict`; PostgreSQL conserva únicamente SHA-256 del token. La cookie
se marca `Secure` fuera de development/test. Logout, expiración absoluta, idle timeout, usuario
inactivo y bloqueo persistente invalidan la sesión.

Permisos V1 de esta superficie:

- `CLOUD_LOCATION_VIEW`
- `CLOUD_OPERATIONAL_VIEW`
- `CLOUD_FINANCIAL_VIEW`
- `CLOUD_TENANT_READ_ALL`

Las queries específicas siempre combinan `tenant_id + location_id + resource_id`. Un recurso fuera
del scope responde 404.

## Estado operacional

Defaults configurables:

- `COMANVIEW_CLOUD_HEARTBEAT_STALE_MS=90000`
- `COMANVIEW_CLOUD_PROJECTION_LAG_MS=120000`

Sin heartbeat o superando staleness: `OFFLINE`. Con heartbeat fresco y una anomalía activa
(estado Edge degradado, lag, dead letter/checkpoint vigente o venta incompleta): `DEGRADED`. En los
demás casos: `ONLINE`. `pendingEventCount` se informa, pero no degrada automáticamente.

Un replay elimina receipts/checkpoints de la versión reconstruida; por ello un dead letter histórico
ya resuelto no mantiene degradación permanente.

## Límites de datos

La UI consume resúmenes, no una réplica comercial completa. No existen todavía nombres/timezone de
Location, líneas de Order, productos/modificadores, subtotal/balance abierto, expected cash en vivo,
cash tender/change ni telemetría de printers/KDS/devices/storage. `lastEventReceivedAt` y
`lastProjectionProcessedAt` se muestran con su nombre real; no representan “Last sync”. Totales
confiables incluyen exclusivamente ventas `COMPLETE` y mantienen sale, tip y charged total separados
en integer minor units por moneda.
