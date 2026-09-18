# B1 — Cross-cutting architecture review

Estado: **B1 CLOSED — CROSS-CUTTING REVIEW PASS**, 2026-09-18.
Group B OPEN; B0 COMPLETE; B2 NOT STARTED. B2–B5 y Group C no iniciados. Sin commit/push.

## Fronteras de escritura

Inventario por referencias SQL, llamadas a repositories/services, routes, SDK y tooling
en apps/packages/scripts; fixtures distinguidos de callers productivos.

| Path | Clasificación | Frontera efectiva |
| --- | --- | --- |
| CatalogCommandService: details/SKU/barcode/displayOrder/active/available/category/price/create Product | AUTHORIZED_COMMAND_PATH | Auth/Floor lease → IMMEDIATE → OCC → mutation/version/generation/Audit/Event/receipt |
| CatalogCommandService: Category create/name/active/reorder | AUTHORIZED_COMMAND_PATH | Mismo protocolo; OCC de cada Category; reorder una generation |
| TaxAdministrationService → assignProductReference | AUTHORIZED_COMMAND_PATH | Permiso TAX_PROFILE_MANAGE, sesión actual y misma products.version |
| AdministrationService → assignProductReference | AUTHORIZED_COMMAND_PATH | Permiso STATION_MANAGE, mismo protocolo y products.version |
| GET Catalog/state; DTO/domain reconstruction; Admin state | READ_ONLY | No crean IDs, Categories, claims o versiones |
| POST products / PATCH availability antiguos; métodos legacy de CatalogService | LEGACY_REJECTED | CLIENT_CAPABILITY_REQUIRED, sin read-current/write |
| CatalogRepository.saveProduct | LEGACY_REJECTED | Guard catalog_state antes de cualquier upsert; no caller comercial válido |
| prepareDevelopmentDatabase, seeds históricos | TEST_ONLY | Tooling de desarrollo; producción y schema comercial rechazados antes del seed |
| Fixtures y SQL de aceptación/test aislados | TEST_ONLY | No camino operacional ni autorización de mutación de instalaciones existentes |
| Cloud readCatalog/projection | READ_ONLY | Lectura derivada; escritura técnica solo por eventos Edge autenticados/Ingest |

Excepción explícita de lifecycle, **no comando comercial**: applyCatalogSchemaMigration
y restore autenticado normalizan categorías nulas/SKU claims, agregan UNCATEGORIZED y
CATALOG_IMPORT bajo snapshot/journal/transacción productivos. No se les atribuye un
commandId/OCC de edición ni se fabrican eventos de alta históricos. Baseline los representa.
No se encontraron BUG_BYPASS operacionales en las superficies inventariadas.

## OCC, identidad y receipts

`products.version` es la autoridad de Product para Catalog, Tax y Station. Las revisiones
de TaxProfile/Station validan referencias, no son una segunda versión de Product.
Todas las ediciones requieren expectedVersion del cliente; no hay versión inventada por
el servidor. `categories.version` cumple la misma función para Category. Generation no es OCC.

Catalog parsea el comando, aplica defaults/trim del contrato y canonicaliza keys antes
del digest; incluye binding, actor/device/session y epoch. Assignments mantienen el formato
administrativo anterior: comando parseado, binding e identidad en digest, epoch comprobada
en receipt. Son formatos de transporte distintos con el mismo resultado de seguridad,
no dos autoridades de Product. No se migra el formato histórico por estética.

Mismo commandId/digest devuelve el resultado confirmado, aunque la entidad ya avanzó.
Digest distinto o epoch diferente rechaza; retry reautoriza bajo Floor antes del receipt.
Catalog y assignments detectan colisión cruzada entre receipts. No-op permite receipt,
sin mutation/version/generation/Event/Audit ficticios. Fallo de Event/Audit/receipt revierte
todo. Realtime queda fuera de la transacción y su fallo no anula ACK.

## Categorías y SKU

UNCATEGORIZED se identifica por system_key único, no por etiqueta. UUID generado solo en
la transición, preservado al restart/retry/restore16. Triggers protegen ID/system_key/active
y delete. Renombrar la etiqueta no cambia identidad. Las categorías legacy llamadas
`Category` se conservan; las lecturas nunca crean categorías.

Única normalización reusable: `normalizeCatalogSku` (Database), NFKC/trim/uppercase,
rechazo de controles/invisibles, ceros/puntuación/espacios interiores conservados.
Migración conserva valor visible legacy; claims CONFLICT no eligen ganador cuando miembros
cambian SKU. Command/claims/receipt se guardan juntos; rollback y reintento no dejan reservas
parciales. B4 deberá reutilizar esta utility; no existe todavía implementación de import.

## Schema, Drizzle, Floor y recuperación

0016 es la única migration Edge nueva de B1; 0008 es la nueva Cloud de B1d. Históricas
intactas. Fingerprint compara sqlite_master con migrations canónicas hasta 16; valida FK,
UNCATEGORIZED, generation y claims. Partial/future/downgrade no se reparan silenciosamente.

El mapping Drizzle existente es deliberadamente un **subconjunto compatible con schemas
legacy**, no la autoridad DDL completa: tampoco mapea las extensiones fiscales de 0015.
Las columnas/tablas B1 son SQL explícito en repositories/primitives tipados y verificadas
contra SQLite real. Añadirlas indiscriminadamente a select() legacy rompería schema14.
No se genera migration desde Drizzle ni existe otra definición que cambie sus constraints.

Startup: recovery/administration/catalog lifecycle antes de repositories operacionales.
15→16 usa snapshot cifrado y journal catalog separado; PREPARING/SNAPSHOT_READY/VALIDATED,
CAS/Floor y fail-closed cubren la ventana SQL/Floor. Minimum schema nunca retrocede.
Restore15 migra dentro del restore validado; restore16 conserva las nuevas tablas/versions,
claims, generation, grants y receipts. Receipts de otra epoch permanecen como evidencia,
no autorización para repetir comandos. Backup completo de SQLite incluye estas tablas;
Cloud projection no sustituye backup.

15→16 no inicializa Personnel ni cambia trust domain, credenciales, Device binding,
revocaciones, recoveryEpoch, Recovery Key o Licensing. Reutiliza validación monotónica y
locking/CAS existentes. La transición Personnel14→15 y hardware replacement conservan
su protocolo; no se introduce bootstrap alternativo. Pruebas usan store/protocolo reales;
las unidades de comandos declaran su seam de actor, complementada por HTTP/Auth real.

## Eventos, realtime y consumidores

Taxonomía completa y payloads en [Catalog Propagation](Catalog_Propagation.md). Cada comando
changed produce su tipo correspondiente; details/category comparten PRODUCT_UPDATED,
active/available comparten PRODUCT_STATUS_CHANGED. Reorder lleva estados finales ordenados
según el comando, un Event y una generation. Payload usa whitelist pública; no secrets.

Generation aumenta una vez por mutación lógica, incluidas Tax/Station; no-op/retry no
incrementan. Epoch+generation separan restore de atraso. CATALOG_CHANGED post-commit usa
IDs acotados, fullInvalidation para más de 100 y barrera/localidad del Hub existente.

POS y Waiter usan un controlador compartido: una carga en vuelo, before/after state y
target máximo observado; descartan respuestas inconsistentes y clientes desmontados.
Foco/reconnect/HTTP-resume recuperan eventos perdidos. Sin repetir commands ni modificar
Order, snapshots, mesa activa o pending items. El backend sigue validando nuevas altas.
KDS/printing consultan OrderItem/snapshot persistido para productos/modifiers/routing/precios;
leer configuración actual de estación/impresora no reinterpreta el snapshot del ticket.

## Cloud, baseline y deuda

Baseline captura en IMMEDIATE y persiste manifest/chunks/completion consecutivos. ID/digest
deterministas incluyen binding/epoch/generation. Cloud verifica completitud, count, índices,
digest/identidad y duplicados; nunca publica parcial. Incremental 21 durante baseline20 queda
buffered y se aplica después; gaps esperan y baseline viejo no sobreescribe estado nuevo.
Nueva epoch exige nueva captura; sourceEpoch impide confundir baseline pendiente reenvelopado
con captura de restore. Dedup/leases/receipts/replay usan la pipeline existente.

Cloud contiene read model interno, sin endpoint de authoring, publicación ni ordering
Storefront. Estado viejo no se mezcla con nuevo como actual. Rebuild conserva historia Inbox.

| Deuda B1d | Clasificación | Evidencia / límite |
| --- | --- | --- |
| Tres intentos por check | NON_BLOCKING_DEBT | Test agota los tres, conserva snapshot, demuestra ausencia de loop y recuperación en siguiente focus/check; no pérdida permanente demostrada |
| Compaction de buffers Cloud | B5_HARDENING | Almacenamiento durable por evento/epoch, sin cola RAM que crezca por retries; duplicados no agregan filas. Crecimiento en disco con historial legítimo requiere política de retention/volumen, no borrado preventivo |

No se cambia preventivamente ninguno. No se certifica capacidad ilimitada: baseline/replay
materializan datos, y la prueba de catálogo grande es acotada. La certificación de volumen
y limpieza segura queda para B5; no hay evidencia de starvation o corrupción por estos límites.

## Defecto confirmado y corrección focal

**Lectura legacy:** CatalogService solicitaba Product version incondicionalmente. SQLite14
real produjo `no such column: version`. Corregido únicamente getProductVersion: omite la
versión si schema pre15 carece de columna y de catalog_state. No inventa expectedVersion;
schemas actuales/parciales siguen fallando, escrituras legacy siguen rechazadas. Test rojo
antes del cambio y verde después; no modificación de migrations ni reglas comerciales.

## Evidencia transversal

Nuevo CatalogPipeline.postgres: comandos reales → Event/notification → controlador usado
por POS/Waiter → Outbox/Inbox → repositorio de proyección PostgreSQL. Incluye create, precio,
Tax, Station, no-op, receipt, retry/ACK duplicado, rollback, categorías legacy/sistema,
claims ambiguos y nueva epoch con menor generation. Complementado por Worker/parser real,
HTTP/Auth/Hub, DOM POS/Waiter y restore cifrado: **no se presenta como E2E de navegador ni
como prueba única de transporte HTTP/WebSocket real**. El test de pipeline usa seam de actor
y el boundary de restore ya validado; protocolos completos se prueban por separado.

### Validación transversal final

**362/362 PASS**, sin contar reproducciones diagnósticas ni reejecuciones del fix:

| Grupo focal | Tests PASS |
| --- | ---: |
| Edge: Catalog commands/lecturas, realtime, Admin, Startup/RecoveryCoordinator/Artifact | 74 |
| Edge resources: Catalog lifecycle/HTTP/pipeline PG, Personnel, Restore lifecycle | 52 |
| Edge host: Productive upgrade, Floor concurrency/store, Windows DPAPI real | 43 |
| Database: Catalog schema/SKU, Tax/Admin, snapshots fiscales, KDS/printing, Outbox, permisos | 37 |
| Contracts | 6 |
| Client SDK | 8 |
| Auth permissions | 12 |
| UI guidance | 24 |
| POS operational / Admin resources | 21 + 28 |
| Waiter resources | 23 |
| Cloud Worker: Catalog PG / Worker PG / payloads | 10 + 12 + 5 |
| Partición exhaustiva/exclusiva de grupos de tests | 7 |

PostgreSQL 18 real: **23/23** (pipeline Edge 1 incluido en resources, Catalog 10,
Worker 12). Base propia efímera para cada suite nueva; contenedor exclusivo de validación,
ningún lab operacional/de aceptación utilizado. Cero skips en la selección ejecutada;
los dos archivos PostgreSQL nuevos conservan el gate opt-in estándar cuando no hay URL.
No aumentos de timeouts; grupos host/resources originales seriales, sin serializar el monorepo.

Build y typecheck: **9/9 proyectos PASS** — Contracts, Auth, UI, Client SDK, Database,
Edge, POS, Waiter y Cloud Worker. El nuevo test de pipeline inicialmente requirió corregir
su anotación callback por exactOptionalPropertyTypes; usa ahora el DTO real, sin casts/any
para ocultar el diagnóstico. Solo Edge repitió typecheck después de esa corrección.

`git diff --check` PASS; hygiene focal sin artifacts runtime/lab ni secretos detectados
en candidatos. No private keys, DB/WAL/SHM, backups o profiles de navegador nuevos.
Migrations históricas sin modificaciones; esta revisión no modifica 0016 ni 0008 ni añade
otra migration. Mapping Drizzle legacy permanece intencionalmente compatible.

Sin blockers o DECISION_REQUIRED pendientes. No suite global ni aceptación manual nueva.
Cambios B1a–B1d y corrección focal permanecen locales; main y HEAD/origin sin cambios.
NO COMMIT. NO PUSH. B1 listo para revisión de cierre por el usuario; Group B no cerrado.
