# Catalog propagation — B1d

Estado: IMPLEMENTED; revisión transversal B1 PASS, B1 CLOSED. Group B OPEN; B2 NOT STARTED.
Evidencia de cierre y deuda: [Catalog B1 Review](Catalog_B1_Review.md).
Edge es autoridad. Esta proyección no publica un Storefront ni permite authoring Cloud.

## Eventos durables y atomicidad

Taxonomía `payloadVersion: 1`:

- `CATALOG_PRODUCT_CREATED`
- `CATALOG_PRODUCT_UPDATED` (details/category)
- `CATALOG_PRODUCT_STATUS_CHANGED` (active/available)
- `CATALOG_PRODUCT_PRICE_CHANGED`
- `CATALOG_PRODUCT_TAX_ASSIGNED`
- `CATALOG_PRODUCT_STATION_ASSIGNED`
- `CATALOG_CATEGORY_CREATED`
- `CATALOG_CATEGORY_UPDATED`
- `CATALOG_CATEGORY_STATUS_CHANGED`
- `CATALOG_CATEGORY_REORDERED`

Payload: binding público tenant/location/edge, entityId/entityVersion, catalogGeneration,
commandId y entities con estado autoritativo explícito. El envelope aporta recoveryEpoch,
eventId y localSequence. Products incluyen Money entero seguro/currency, nombre/description,
category, SKU/barcode, active/available, tax reference/revision, station, displayOrder/version.
Categories incluyen nombre, active, displayOrder, systemKey/version. No se serializan filas
arbitrarias, credenciales o auditoría privada. Modifiers quedan para B3.

La misma transacción IMMEDIATE guarda mutation, versión compartida, generation, Event,
Audit y receipt. No-op y replay de receipt no emiten ni incrementan. Reorder lleva todos
los estados finales en un evento y una generation; el primer elemento identifica el envelope.
Tax/Station conservan Audit especializado y sus permisos. Fallo de cualquier escritura
revierte la operación completa. Las autorizaciones existentes no se sustituyen.

## Invalidación local

`CATALOG_CHANGED`: locationId, recoveryEpoch, catalogGeneration, capabilityVersion=1,
affectedTypes, affectedIds (máximo 100), fullInvalidation. Solo después de commit;
notificación fallida no convierte un comando confirmado en error. Hub conserva barrera
de autorización y aislamiento por Location. No sustituye Event Log ni ACK de comandos.

`GET /catalog/state`, con CATALOG_VIEW, devuelve recoveryEpoch, catalogGeneration,
capabilityVersion=1. SDK/POS/Waiter comparan la pareja, no generation aislada.
Epoch 8/generation 30 reemplaza epoch 7/generation 100.

Controlador compartido, sin acceso a pedidos/comandos: una carga en vuelo, bursts
coalescidos y mayor target observado. Lee state antes y después de categories/products;
descarta respuesta si cambió o si todavía es anterior al target. Foco, reconexión HTTP
y autenticación/reconexión WebSocket comprueban state. Si no cambió, no descargan catálogo.
No depende de Internet. Tras error HTTP conserva la lectura anterior y reintenta en el
siguiente disparador. Bajo cambios sostenidos limita cada check a tres intentos; si no
converge, permanece stale hasta otra notificación/foco/reconexión. No hay polling agresivo.

Solo cambia selección futura. POS conserva Order/DRAFT/SENT y snapshots; Waiter conserva
mesa, pending items y rondas. No repite comandos. La selección nueva respeta available y
el backend conserva autoridad. KDS sigue usando snapshots y routing persistido, sin nueva
dependencia de catálogo. La recuperación explícita tras rechazo de configuración utiliza
la misma carga coordinada, no una descarga paralela capaz de sobrescribir datos nuevos.

## Baseline y transporte

Tras lifecycle/upgrade válido, setup de servicios schema 16 llama `ensureCatalogBaseline`
antes de arrancar workers/routes. Una transacción captura Categories/Products ordenados por
ID y escribe STARTED, CHUNK(s), COMPLETED consecutivos en Event Log. Una captura por epoch;
reiniciar no la repite. Incluye entidades legacy sin eventos históricos de alta.

Manifest: binding, payloadVersion, sourceEpoch, baselineId, catalogGeneration, chunkCount,
entityCount, digest SHA-256. Canonical JSON ordena keys; el digest cubre entidades ordenadas.
baselineId deriva de binding, epoch, generation, capabilityVersion y digest, no del reloj.
Chunks: máximo 100 entidades y aproximadamente 128 KiB de estado por chunk; una entidad
mayor se rechaza. Catálogo vacío lleva un chunk vacío. Rollback elimina toda captura parcial;
no existe marker separado que declare completion prematuro.

Viaja por Event Log → Outbox → Sync → Inbox → Worker existentes. Outbox mantiene el head y
localSequence; limita batches a 750000 bytes estimados (payload UTF-8 + margen por envelope)
para dejar espacio al límite HTTP. No nueva pipeline, orden/epoch de Sync ni dependencia
Cloud para operar localmente.

## Cloud read model

Migration incremental `cloud/0008_catalog_projection.sql`:

- cloud_catalog_checkpoint: binding/epoch/generation/baseline/sourceSequence por Edge/projectionVersion.
- cloud_catalog_entities: estado público Product/Category y versión/epoch.
- cloud_catalog_baselines: manifest y marcas STARTED/COMPLETED.
- cloud_catalog_chunks: chunks validados por índice.
- cloud_catalog_deltas: incrementales por epoch/generation.

Worker utiliza su lease/receipt/transacción existente y bloquea checkpoint por Edge.
`readCatalog` verifica binding y devuelve null mientras no exista baseline válido; no
expone entidades antiguas como actuales. No se añade endpoint Cloud de escritura o UI.

Baseline solo se publica cuando hay STARTED, COMPLETED, todos los chunks/índices,
entityCount correcto, IDs únicos, digest e identidad determinista válidos. Duplicados
idénticos son idempotentes; manifest/chunk/generation conflictivos fallan mediante el
mecanismo existente del Worker. Recepción parcial nunca significa baseline completo.

Incrementales se almacenan y aplican en generaciones contiguas después del baseline.
Si llega 21 durante transporte de baseline 20, queda durable y se aplica al completar 20.
Si llega 22 antes de 21, espera el gap; no pierde ni sobrescribe 21. Un baseline anterior
no reemplaza un checkpoint más nuevo. sourceSequence registra recepción; generation
representa el estado aplicado. Entity version no retrocede. Reset/replay de projectionVersion
reconstruye el mismo resultado desde Inbox, sin borrar Event Log ni audit históricos.

## Restore y compatibilidad

Epoch nueva invalida checkpoint actual hasta baseline nuevo; epoch anterior no modifica
estado actual. Se mantienen buffers/historia por epoch, no se mezclan como contemporáneos.
Restore existente puede reenvelopar eventos pendientes: sourceEpoch distingue un baseline
antiguo de una captura nueva. Esos chunks históricos no completan la nueva epoch y tampoco
suprimen la captura de startup. Incrementales previos a la nueva captura quedan cubiertos
por su generation; los posteriores avanzan normalmente. No se modifica RecoveryCoordinator.

Los descriptores Tax/Station reference-only emitidos por B1c son reconocidos/validados como
NOOP de proyección, no como eventos desconocidos. El baseline aporta el estado completo.
No cambia OCC, autorización, Floor, snapshots ni reglas de recoveryEpoch.

## Validación y límites

Pruebas focales: atomicidad/rollback/no-op/post-commit, reorder, baseline grande/fallo/restart,
Outbox, contratos, SDK bursts/respuestas stale/foco/epoch, POS/Waiter con pedidos conservados,
KDS y persistencia fiscal. PostgreSQL real: baseline vacío/legacy/parcial, digest/conflictos,
duplicados/gaps, incrementales durante captura, restore/re-envelope y replay determinista.
Cloud comparte el gate PostgreSQL opt-in existente; su archivo usa una DB efímera propia
para no competir por leases Inbox con otros archivos de pruebas.

Resultado focal histórico B1d (sin contar reejecuciones): **149/149 PASS**;
la revisión transversal posterior y sus resultados vigentes se registran en Catalog B1 Review:

| Área | Tests |
| --- | ---: |
| Edge CatalogCommandService / HTTP / RealtimeHub | 48 + 1 + 6 |
| POS / Waiter | 21 + 23 |
| Contracts / SDK | 3 + 7 |
| Database Outbox / fiscal snapshots / KDS | 4 + 8 + 1 |
| Cloud PostgreSQL: Catalog / Worker existente | 10 + 12 |
| Cloud payload validation | 5 |

Typecheck y build focales PASS: Contracts, Client SDK, Database, Edge, POS, Waiter,
Cloud Worker. `git diff --check` PASS. PostgreSQL 18 real en contenedor exclusivo de
validación, sin tocar instalaciones/labs existentes. El fallo inicial al compartir
Inbox entre dos archivos se resolvió aislando la DB del nuevo test; sin aumentar
timeouts. Los 22 escenarios PostgreSQL se ejecutaron sin skips. Fuera de una ejecución
con URL PostgreSQL, el nuevo archivo conserva el gate opt-in estándar del workspace.

Read model administrativo, no catálogo público. Sin B2 UI, B3 modifiers, B4 import, B5
aceptación, Cloud editing ni Group C. Retención/compactación de buffers no se introduce aquí;
replay conserva evidencia durable. No se ejecuta validación global ni aceptación manual B1d.
