# ComanView Implementation Status

Ledger operativo del estado implementado y del trabajo restante de V1.
No sustituye las especificaciones canónicas ni autoriza implementación por sí mismo.
El repositorio determina qué existe; el Master PRD determina el comportamiento requerido.

## Current State

- Current functional phase: **1X — UX/UI Foundation & Product Experience**
- Current phase status: **CLOSED**
- Current block: **TECHNICAL VALIDATION PASS; MANUAL ACCEPTANCE PASS**
- Last closed phase: **1X — UX/UI Foundation & Product Experience**
- Closure commit message: `feat: complete phase 1X UX foundation`
- Branch: `main`
- 1V status: **CLOSED**
- 1W status: **CLOSED**
- 1X status: **CLOSED; X-A → X-I COMPLETE; UX ROUND 2 ACCEPTED**
- Manual acceptance 1X: **PASS**, confirmada por el usuario para POS, Cobro, descarte vacío, Admin Local, Waiter, KDS, Super Admin, continuidad, responsive y uso real. Evidencia técnica en `docs/Acceptance_Phase_1X.md`.
- Manual acceptance 1W: **PASS** (`phase-1w-final-acceptance`).

### Cierre final — 2026-09-16

**1X CLOSED — TECHNICAL VALIDATION PASS — MANUAL ACCEPTANCE PASS.**

- `pnpm test`: **PASS**, salida 0; 32 tareas Turbo; **865 pruebas PASS**:
  678 Turbo + 7 controles de partición + 180 en grupos aislados obligatorios.
- Edge normal **169/169**, recursos **35/35**, host/Windows/DPAPI **56/56**.
  Database recursos **39/39**, POS recursos **25/25**, Waiter **22/22**, Super Admin **3/3**.
- Focales previos: los tres timeouts por separado PASS; partición 7/7, recursos 35/35,
  Edge normal 169/169. Sin cambios productivos, aumentos de timeout, sleeps, retries ni skips.
- Los 31 skips PostgreSQL preexistentes del comando sin URL tienen validación real de esta
  ronda: PostgreSQL 18.6 **31/31 PASS sin skips** (Database 18, Cloud API 1, Cloud Worker 12).
- Typecheck **21/21 PASS** y build **20/20 PASS** conservan su aprobación; no se repiten
  después del ajuste exclusivo de tooling/tests/documentación.
- `git diff --check` PASS; migrations históricas intactas; candidatos revisados sin secretos
  reales, DB/WAL/SHM, backups, perfiles de navegador ni artifacts runtime/lab.
- X-A → X-I completos. Auth/Security Floor y coordinación WebSocket corregidos; indisponibilidad
  temporal y sesión inválida diferenciadas. UX Round 2 y aceptación manual PASS confirmados por el usuario.

Diferidos: **GROUP_B_CATALOG** (Commercial Catalog, categorías, página dedicada de productos,
configuración por producto, CSV/XLSX); **GROUP_C** (cancelación directa de DRAFT con productos
bajo reglas backend certificadas); **NICE_TO_HAVE** (long press, swipe actions, microanimaciones touch).
Cloud object backup y certificación física OFF_DEVICE siguen diferidos desde 1V. Grupo B no iniciado.

Los intentos anteriores se conservan como evidencia histórica, no como estado vigente.

Primer intento de cierre final 2026-09-16 (histórico): `pnpm test` FAIL (28/32 tareas; dos pruebas de carga inicial
Waiter/Super Admin fallaron en global y pasaron aisladas sin cambios). Typecheck 21/21, build 20/20,
Windows/DPAPI 56/56, Database resources 39/39, POS resources 25/25 y PostgreSQL real 31/31 PASS.
`git diff --check` PASS; migraciones intactas, sin nuevos skips de código ni artifacts/secretos reales
detectados. No hay total global certificado: Edge/POS no completaron en Turbo. Véase evidencia en
Acceptance Phase 1X. No se modificó producto ni timeouts, no se repitió la suite global, no commit/push.

Intento histórico tras corrección focal Waiter/Super Admin: se aislaron únicamente
`waiterNavigation.test.tsx` y `round2UX.test.tsx`, completos, en grupos obligatorios post-Turbo
encadenados por `pnpm test:ui-resources`. Partición 7/7 PASS; focales aislados 22/22 y 3/3,
convivencia normal 8/8 y 24/24, seguida del grupo conjunto 25/25 PASS. Sin cambios productivos,
assertions, timeouts, sleeps ni skips. La única nueva corrida global autorizada terminó FAIL:
31/32 tareas (28 cached), 710 pruebas Turbo PASS, 3 FAIL y 31 skips PostgreSQL preexistentes,
más 7 controles PASS. Los fallos son timeouts de 5000 ms en RecoveryLifecycle (2) y
PersonnelSecurityOperation (1). Los grupos posteriores no se ejecutaron por fail-fast.
Estos nuevos escenarios Edge quedan fuera del ajuste focal autorizado; no se aislaron ni se
repitieron. Se conserva la aprobación previa de typecheck/build/PostgreSQL/DPAPI, sin repetirlos
por separado. En ese intento 1X seguía OPEN, manual PASS y sin commit/push; el cierre final posterior resolvió el bloqueo.

El roadmap restante fue reconstruido después de 1V y aprobado a nivel macro. El Grupo A se cerró
con 1W. El Grupo B es el siguiente grupo propuesto y permanece **NOT STARTED**; este cierre no
autoriza su implementación ni declara comercialmente completa toda la V1.

### Phase 1X execution ledger

- **X-A — Error Contract Closure: COMPLETE.** Los códigos de error son contractuales, el SDK
  conserva únicamente detalles públicos allowlisted y los errores desconocidos fallan de forma segura.
- **X-B — UX Foundations: COMPLETE.** `@comanview/ui` incorpora primitives
  incrementales para controles, campos, feedback, estados, diálogos accesibles y detalles técnicos.
- **X-C — Guidance & Prerequisites: COMPLETE.** El frontend compartido es dueño
  del catálogo español `ErrorCode → UserGuidance`; las acciones usan destinos tipados resueltos por
  cada app. POS adopta prerequisites en moneda/caja, impuesto predeterminado y propinas, y convierte
  Readiness en acciones locales cuando el usuario tiene permiso. Edge conserva la autoridad al submit.
- **X-D — Admin Local UX Migration: COMPLETE.** Navegación local tipada y
  agrupada, ocho secciones con montaje/carga por demanda y cache local respetando permisos.
  Los borradores por formulario sobreviven al cambio de sección; guardar o descartar uno no borra
  los demás. Los conflictos conservan la intención y requieren revisión explícita de la base.
  Checklist opcional y preparación accionable usan evidencia consultada, sin sustituir la autoridad
  de Edge. Formularios y diálogos compartidos incorporan labels, PIN enmascarado, validación,
  foco atrapado/restaurado y controles para desktop/tablet. Station Purpose conserva vocabulario
  abierto con presets y opción personalizada. Sin cambios de dominio ni migrations.
- **X-E — POS Operational UX: COMPLETE.** Guidance operacional compartido,
  razones visibles de bloqueo y terminología comercial. Conexión local, indicación offline,
  información degradada, licencia y recuperación se presentan por separado. El estado de impresión
  no revierte ni oculta el ACK de una venta/ronda; consultar la cola puede fallar sin convertir una
  solicitud confirmada en error. Cobro muestra total/pagado/saldo y propina separada usando los
  modelos existentes. Diálogos de caja, cobro, anulación, productos y ventas abiertas comparten
  foco/Escape; Admin/Devices conservan venta y mesa. Sin cambios financieros, payloads ni migrations.
- **X-F — Waiter mobile-first: COMPLETE.** Navegación local tipada
  Mesas → Productos → Pedido; una tarea montada por vista, con acceso persistente al pedido y
  contador de productos sin enviar. Back conserva zona/categoría/pedido y no crea ni cancela ventas.
  Reconnect y polling consultan mesas y pedido; OCC conserva la intención segura, sin repetir comandos.
  Respuestas obsoletas no reemplazan una versión confirmada más reciente. Pedido cerrado/cancelado,
  ausente o mesa reasignada/no disponible vuelve al mapa con explicación. Diálogos compartidos,
  foco, labels y targets de al menos 44 px; guidance compartido sin mensajes crudos del servidor.
- **X-G — KDS UX adoption: COMPLETE.** Conserva columnas y comandos de
  preparación, alto contraste y componentes de comanda locales. Tiempo y urgencia textual no
  dependen del color. Transiciones muestran razones de bloqueo y conservan el foco al cambiar
  de columna; los rechazos no desaparecen con un refresh exitoso. Conexión local, reconexión de
  avisos, permisos y estación no disponible son estados distintos; no cambia de estación sin
  selección explícita cuando la anterior desaparece. Contexto disponible: pedido, ronda y tipo
  de servicio; el contrato KDS actual no incluye nombre/número de mesa y no se inventa ni amplía aquí.
- **X-H — Super Admin critical flows: COMPLETE.** Diálogos sensibles
  compartiendo primitives de foco/teclado, contexto humano, impacto, motivo, validación y errores
  locales. Migrados propinas, revocación de equipo/código de alta, inicio/cancelación de reemplazo,
  autorización de recuperación de hardware, instalación inicial y confirmación de estado de licencia.
  Se conserva la semántica de porcentajes → basis points, revisiones esperadas, IDs y motivos de
  los comandos existentes; vigencia, firma, uso único, binding, cutover y permisos siguen en Cloud.
  La autorización del propietario contractual usa el contrato/endpoint de recuperación ya existente,
  con transporte SDK tipado y contexto público validado; no permite elegir otro propietario ni
  inventar identidad. Documentos firmados y códigos de alta se entregan por copia explícita, sin
  renderizar su contenido; vencimiento y feedback de copia son visibles. Identificadores quedan en
  detalles técnicos. No se añaden operaciones nuevas de revocación de Devices o rotación de credenciales
  que no existían en esta superficie, ni se rediseñan dashboard, tablas o navegación general.
- **X-I: TECHNICAL VALIDATION COMPLETE.** Revisados guidance compartido, estados, permisos, reconexión,
  foco/diálogos y CSS de la matriz. Corregidas asociaciones de errores/aria-invalid en Super Admin
  y terminología comercial de respaldo en Devices; operaciones y payloads conservados.
  Actualizada una expectativa anterior a X-A: el rechazo de cancelación conserva 409/código,
  pero permite únicamente el diagnosticId público seguro, sin detalles internos adicionales.
  Semántica y responsabilidades en `docs/UX_State_Semantics.md`; aceptación manual final **PASS**, confirmada por el usuario.
  La evidencia DOM/CSS no sustituye evaluación visual ni certificación de accesibilidad.

### X-I — evidencia técnica inicial (histórica; bloqueo resuelto abajo)

- Typecheck global: **PASS**, 21 tareas.
- Focales nuevos: Super Admin 18/18; Devices 13/13; expectativa de cancelación 1/1.
- `pnpm test`: **NO PASS global**. El primer intento no inició suites por resolución local de
  Vitest; restaurar enlaces desde lockfile con instalación offline/frozen resolvió ese punto.
  La ronda concurrente encontró timeouts de 5000 ms en persistencia SQLite y OCC Admin.
  Aislados pasaron sin modificaciones de timeout: deduplicación 167 ms, OCC 1445 ms.
- Se reanudó una vez el comando oficial tras corregir la expectativa diagnosticId; Turbo
  reutilizó 26 tareas aprobadas. OCC volvió a superar 5 s y también hubo timeouts en restauración
  del harness 1V y seed de desarrollo. Es evidencia de sensibilidad a contención, no prueba
  concluyente de regresión de dominio ni motivo para declarar PASS. No se aumentaron timeouts,
  no se añadieron skips ni se cambió el agrupamiento de pruebas en esa ronda inicial.
- Los otros dos timeouts también pasan aislados: restauración del harness 406 ms y seed 1669 ms.
  Los skips de estas repeticiones son filtros `-t`, no cambios en cobertura/configuración.
- Build global: **PASS**, 20 tareas. Grupo host sin contención: **56/56 PASS**, Windows/DPAPI real.
- PostgreSQL 18 real: **31/31 PASS, sin skips** (Database 18, Cloud API 1, Cloud Worker 12),
  contenedor temporal y tres bases propias, sin usar el laboratorio de aceptación existente.
  Contenedor desechable eliminado al finalizar; ninguna instalación operacional modificada.
- `git diff --check`: **PASS**. Migrations sin cambios; sin nuevos skips/timeouts; sin secretos
  o artifacts runtime detectados en los archivos candidatos. Build/Turbo generan archivos ignorados.
- **Bloqueo inicial, resuelto en la corrección siguiente:** ejecución concurrente de `pnpm test`.
  No declarar `TECHNICAL VALIDATION COMPLETE` a partir de repeticiones aisladas verdes.
  No se ha ejecutado aceptación manual 1X, no commit/push, no Grupo B.

### X-I — corrección focal de concurrencia

El comando canónico conserva Turbo paralelo y después ejecuta obligatoriamente, mediante `&&`,
Edge `test:host`, Database `test:resources` y POS `test:resources`. Los tres grupos posteriores
son uncached, seriales entre sí, con `maxWorkers=1`, `fileParallelism=false` y
`passWithNoTests=false`. No se alteraron timeouts, assertions, escenarios ni código productivo.

| Archivo aislado nuevo | Recurso / evidencia del diagnóstico |
| --- | --- |
| Database `persistence.test.ts` | Deduplicación usa SQLite en memoria y lectura síncrona de migrations; no comparte WAL ni espera un lock de otro test. 167 ms aislado frente a >5 s con carga. |
| Database `recoveryAcceptanceLab.test.ts` | Migrations, backup SQLite, validación, copias/rename/cleanup en `mkdtemp` propio; no usa puertos ni PowerShell. Restore 456 ms aislado. |
| Database `developmentSeed.test.ts` | SQLite en archivo temporal propio, migrations y hashes scrypt síncronos; NODE_ENV restaurado dentro del worker Vitest. Seed 1683 ms aislado. |
| POS `administrationMigration.test.tsx` | React/jsdom, consultas accesibles y user-event con API simulada; sin SQLite, filesystem operativo ni red real. OCC 1671 ms aislado / 1391 ms en el grupo completo. |

La sensibilidad a carga es reproducida por la ronda anterior y desaparece en aislamiento.
CPU/E/S y planificación de workers son la explicación consistente con código y tiempos;
no se afirma haber medido starvation a nivel kernel ni un lock compartido inexistente.
No hay evidencia de retries infinitos, rutas compartidas entre estos escenarios, conflicto de
cleanup o regresión de producto. Se mantienen archivos completos para conservar hooks/cobertura.
No se movieron otros archivos por precaución: los tests SQLite/DOM vecinos sin fallo demostrado
siguen en el bloque paralelo. No es una prohibición general de concurrencia para SQLite o React.

`scripts/test-execution.test.mjs` comprueba partición exhaustiva/exclusiva de Edge, Database y POS,
existencia de archivos, grupos no vacíos, límites originales y cadena canónica fail-fast.
Convivencia focal Database/POS normal: 41/41 + 85/85 PASS; grupos nuevos: 39/39 + 20/20 PASS.
Los 18 PostgreSQL omitidos por ausencia de URL en esta prueba normal son los gates preexistentes;
su aprobación real 18+1+12 de esta ronda se conserva, no se repite ni se convierte en skip nuevo.
Resultado global con la nueva estrategia: **PASS**, exit code 0 confirmado el 2026-09-14.
La ejecución iniciada el día anterior terminó el bloque Turbo correctamente, pero se perdió la
sesión antes de obtener evidencia de los grupos posteriores. Se retomó el comando canónico:
32/32 tareas Turbo recuperadas de caché aprobada, sin reejecutarlas, y los tres grupos posteriores
ejecutados realmente, sin caché: Windows/DPAPI 56/56, Database 39/39 y POS 20/20.
Total: **813 pruebas aprobadas** (693 del bloque Turbo + 5 controles de partición + 115 aisladas).
Los 31 gates PostgreSQL preexistentes permanecen omitidos sin URL en el comando normal;
su validación real **31/31 PASS** de X-I se mantiene. No se repitieron typecheck/build/PostgreSQL.
OCC final 1426 ms; restore 418 ms; seed 1645 ms; deduplicación 1376 ms: sin aumentar límites.
`git diff --check` PASS; sin skips nuevos, sin cambios productivos ni migrations en este ajuste.
**Estado histórico de X-I/Fix Round 1:** validación técnica previa completa; aceptación fallida antes del retest de Auth/Floor/WebSocket y de UX Round 2.
Sin blockers técnicos conocidos; no commit/push, no Grupo B.

### UX Round 2 — implementación y aceptación aprobadas

**1X CLOSED — UX ROUND 2 ACCEPTED — MANUAL ACCEPTANCE PASS.** Validación técnica final PASS; evidencia en Acceptance Phase 1X.

- POS: pedido compacto, acciones persistentes, cobro a dos columnas donde cabe, feedback contextual/transitorio y descarte vacío a estado neutral.
- Admin Local: contexto de sección, scroll compartido y acciones de guardado sticky; conserva drafts y OCC.
- Waiter: contexto zona/mesas/pendientes, navegación móvil compacta, alta directa cuando solo hay nota opcional y edición secundaria; modificadores siguen requiriendo configuración.
- KDS: jerarquía compacta y carriles con scroll accesible, sin comprimir/ocultar tickets ni cambiar transiciones; mínimo 1024×640.
- Super Admin: creación opt-in, Tenant → Location → secciones, nombres humanos y detalles técnicos secundarios, ausencia de proyección distinta de cero, autorización inicial consumida deshabilitada.
- Validación focal: POS/hardening 30/30, Admin 25/25, Waiter 22/22, KDS 18/18, Super Admin 25/25. Typecheck y build de las cuatro apps PASS. Sin suites globales en esta ronda.
- Browser smoke en todos los viewports solicitados; detalle en Acceptance Phase 1X. No sustituye el retest manual del usuario ni certificación de dispositivos físicos.
- Diferido **GROUP_B_CATALOG**: página de productos, categorías, commercial catalog, configuración/metadata por producto y CSV/XLSX.
- Diferido **GROUP_C**: cancelación de DRAFT con productos bajo reglas certificadas.
- Diferido **NICE_TO_HAVE**: long press, swipe y microanimaciones; nunca gesture-only.
- No cambios de dominio/contratos/seguridad en Round 2; se preservan los fixes previos. NO COMMIT / NO PUSH.

### Device / viewport matrix — X-F/X-G

| Superficie | Objetivo | Comportamiento / límite |
| --- | --- | --- |
| Waiter | Teléfono 360–480 px de ancho | Una tarea por vista, navegación inferior persistente, targets ≥44 px, sin dependencia de hover |
| Waiter | Tablet 768–1024 px, secundario | Mismo recorrido por tareas; no monta catálogo y pedido completos simultáneamente |
| KDS | Pantalla fija de cocina ≥1024 × 640 px | Tres columnas, comandas grandes, acciones de preparación por teclado/touch |
| KDS | Menor ancho o alto | Aviso de vista limitada y desplazamiento horizontal; no es una versión móvil de KDS |

La cobertura focal de navegación, DOM/teclado, estados y estilos no equivale a aceptación manual
en dispositivos físicos. La aceptación visual/manual final fue aprobada por el usuario; no constituye certificación WCAG.

## Implemented Foundation

Las capacidades operativas siguientes existen; su uso presupone un entorno configurado.
Backend, dominio o persistencia no equivalen a administración accesible al restaurante.

| Área | Implementación real hasta 1W | Límite comercial actual |
| --- | --- | --- |
| Core domain/invariants | Money, catálogo, snapshots y reglas transaccionales | No sustituye configuración/onboarding |
| Orders | POS, DRAFT/SENT, rondas, cierre y operaciones de mesa | Recorridos V1 adicionales pendientes |
| Payments | CASH/CARD/OTHER, pagos parciales, propinas y void autorizado | Sin terminal bancaria integrada ni split bill completo |
| Cash | Apertura, movimientos, arqueo, X/Z, caja predeterminada, moneda y jornada administrables | Multicaja simultánea permanece para evaluación posterior |
| Tables/Waiter | UI de mesas, comandas, solicitud de cuenta y administración de zonas/mesas | Recorridos y UX comerciales adicionales pendientes |
| KDS | UI de tickets, estaciones, preparación y administración básica de estaciones | Configuración física/printing comercial pendiente |
| Printing infrastructure | Cola durable, renderer ESC/POS y adaptador TCP | Startup normal DEBUG; falta configuración física comercial |
| RBAC/Auth | Login offline, sesiones, roles V1, administración de personal/PINs y Security Floor anti-rollback | UX administrativa 1X aceptada; mejoras futuras fuera de alcance |
| Audit/Event Log | Persistencia, trazabilidad y eventos operacionales | Nuevos comandos deberán integrarse sin duplicar autoridad |
| Sync | Outbox/Inbox, ACK, recoveryEpoch y proyecciones operacionales | No es backup ni catálogo público publicado |
| Tenant/Location control plane | Alta y gestión de infraestructura desde Super Admin | No es el backoffice normal del restaurante |
| Provisioning | Protocolo durable, credenciales y CLI | Falta integración de instalación productiva desde PC limpia |
| Licensing/Entitlements/Configuration | Documentos firmados, enforcement y control comercial | Configuration actual limitada a propinas |
| Device identity/pairing | Bootstrap OWNER/primer Device y administración local de Devices | No resuelve el lifecycle general del personal |
| Backup/Recovery | UI, LOCAL/OFF_DEVICE, Security Floor, restore y upgrade productivo 1U→1V | Integración con instalador/servicio aún pendiente |

## Commercial V1 Gaps

El recorrido PC limpia → restaurante configurado → primera venta todavía requiere desarrollo.
Gaps confirmados; no deben confundirse con reapertura automática de fases cerradas:

- **Commercial Catalog administration:** UI y comandos completos para categorías, productos,
  precios, modificadores/overrides, active/available; retirar supuestos de prueba del alta actual.
- **CSV/XLSX import:** upload, validación por fila, preview, confirmación y resultado determinista.
- **Remaining V1 operational flows:** split bill y tratamiento completo de cancelaciones SENT,
  descuentos/comps y excepciones según las reglas aprobadas, sin inventar política financiera.
- **Commercial printing/hardware configuration:** selección de adapter, impresoras, routing,
  test print, fallback y atención de trabajos FAILED/UNKNOWN desde UI.
- **Installer/distribution/deployment/onboarding/go-live:** paquete Windows autocontenido,
  servicio/auto-start, inicialización productiva nueva, assets locales, seguridad de deployment,
  Cloud productivo, diagnóstico y verificación de instalación sin fixtures ni SQL manual.
- **Signed release/OTA:** paquetes verificados, ventanas seguras, rollout y rollback compatible.
- **Public Storefront:** aplicación Cloud-only read-only, publicación, proyección pública,
  landing/menú, disponibilidad, slug/QR y consistencia eventual; hoy existe solo un placeholder.

La existencia de readiness técnico no acredita por sí sola configuración comercial ni hardware probado.

## Known Non-Blocking Debt

- Cloud object backup: diferido explícitamente en 1V.
- Automated/physical OFF_DEVICE certification: diferida explícitamente.
  No equivale a omitir la custodia de una copia externa real en una instalación comercial.
- UX/IA: X-B/X-C establecen foundations, X-D migra Admin Local y X-E los recorridos POS.
  Las demás superficies y su aceptación visual/operativa corresponden a los bloques posteriores;
  no se inician aquí ni reabren 1W.
- La administración comercial completa de catálogo y la importación CSV/XLSX pertenecen al
  Grupo B; no se consideran implementadas ni se reducen a una corrección UX de 1W.

## Explicit V2+ Boundaries

No contabilizar como faltantes de V1 ni introducir sin cambio explícito de alcance:

- Multi-location operational module; Tenant/Location en el modelo no implementa ese módulo.
- Inventory/Recipes.
- Electronic invoicing.
- Tip distribution.
- QR ordering/web ordering; el QR de menú read-only sí pertenece a V1.
- Integrated payment terminals.
- Custom role builder.
- Advanced promotions.
- Complete Refund domain.

## Proposed Remaining V1 Roadmap

**APROBADO A NIVEL MACRO — GRUPO A CLOSED (1W); GRUPO B PROPOSED / NOT STARTED.**
Los grupos posteriores no están iniciados.

| Grupo | Trabajo restante |
| --- | --- |
| A | Restaurant Administration + Operational Configuration |
| B | Commercial Catalog + CSV/XLSX Import |
| C | Complete V1 Operational Flows |
| D | Commercial Printing + Hardware Configuration |
| E | Distribution + Deployment + Onboarding + Go-Live |
| F | Signed Release / OTA Lifecycle |
| G | Public Storefront |

El cierre de 1W no autoriza iniciar los grupos posteriores. Multicaja simultánea
permanece como gap V1 a reevaluar en el grupo C, no como exclusión V2.

## Next Decision

- Closed phase: **1W — Restaurant Administration & Operational Configuration**
- Status: **CLOSED**
- Manual acceptance: **PASS**.
- Next roadmap group: **B — Commercial Catalog + CSV/XLSX Import**, **PROPOSED / NOT STARTED**.

Decisiones aprobadas: timezone/jornada Edge; propinas mediante policy Cloud y preferencia Edge;
moneda inmutable tras actividad monetaria; impuestos efectivos HALF_UP por línea; una caja
operacional predeterminada; revisiones de seguridad de personal y recuperación OWNER autorizada.
La implementación focal, la validación técnica y la aceptación manual están completas. La aceptación
manual detectó defectos funcionales y problemas UX;
los cuatro blockers funcionales (PIN, borradores, ventas stale/cancelación y permisos administrativos)
fueron corregidos. Las mejoras UX/IA no bloqueantes pasan a la propuesta futura correspondiente,
no iniciada. La aceptación manual final en `phase-1w-final-acceptance` resultó PASS.
Incluye Admin Local, schema 0015/Cloud 0007, jornada/moneda/impuestos,
personal con Security Floor anti-rollback, caja predeterminada, zonas/mesas, estaciones, propinas,
readiness, proyección Cloud y upgrade/restore 1V→1W. Solo una edición explícita autorizada de un
Item DRAFT puede reemplazar su snapshot fiscal; cambios externos, SENT e historia no se reinterpretan.

La política efectiva de propinas ya limita preferencias antiguas por la configuración Cloud vigente,
incluido restore. La limpieza PostgreSQL de Cloud Licensing ya respeta la referencia de
`cloud_contractual_owners`; PostgreSQL 18 real pasa Database 18/18, Cloud API 1/1 y Cloud Worker
12/12, sin skips. El harness de upgrade reutiliza evidencia validada dentro de cada inspección.
El blocker de contención quedó resuelto con separación del grupo host y comparación binaria nativa
en las pruebas: grupo focal 56/56 PASS, upgrade 54,36 s y rechazo WAL 3,92 s.
La única corrida global posterior pasa: checks de configuración 3/3, Turbo 32/32 tareas
(31 desde caché), Edge paralelo 186/186 y grupo host real 56/56, sin skips en Edge.
Upgrade global 53,42 s y rechazo WAL 3,82 s, sin ampliar los límites originales de 60 s y 5 s.
Typecheck 21/21, build 20/20 y PostgreSQL conservan su validación previa; no se repitieron porque
esta corrección solo afecta infraestructura/pruebas. No quedan blockers técnicos conocidos;
1W queda CLOSED tras la aceptación manual y la autorización de cierre.

La estrategia oficial de validación es `pnpm test` desde la raíz: comprueba la partición de tests,
ejecuta el bloque paralelo de Turbo y, tras su finalización correcta, ejecuta obligatoriamente
`@comanview/edge test:host` sin caché de Turbo y con un solo worker. El grupo host conserva los
archivos completos de upgrade acceptance, ProductionRecoveryUpgrade, RecoverySecurityConcurrency,
RecoverySecurityStore y EdgeSecretStore. `pnpm --filter @comanview/edge test` por sí solo cubre
únicamente el bloque paralelo; no sustituye la validación global. No se amplían timeouts ni se
añaden skips. Las comprobaciones de archivos binarios usan igualdad byte por byte nativa.

## Canonical References

- [Master PRD](../Master_PRD.md): autoridad normativa de implementación.
- [Master Technical Specification](Master_Technical_Specification.md): referencia técnica ampliada.
- [Full Specification](Full_Specification.md): contexto y detalle complementario.
- [Acceptance Phase 1V](Acceptance_Phase_1V.md): aceptación general y upgrade productivo PASS.
- [Acceptance Phase 1W](Acceptance_Phase_1W.md): aceptación manual PASS y cierre de 1W.

## Ledger Maintenance Rule

Actualizar este archivo únicamente cuando:

- Una fase abre o cierra.
- Cambia el commit de cierre.
- Cambia el roadmap aprobado.
- Aparece o se resuelve un blocker comercial relevante.
- Cambia deuda explícitamente aceptada.

Mantenerlo breve: no convertirlo en changelog, historial de tests ni otra especificación.
