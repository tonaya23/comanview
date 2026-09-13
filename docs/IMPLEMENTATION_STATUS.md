# ComanView Implementation Status

Ledger operativo del estado implementado y del trabajo restante de V1.
No sustituye las especificaciones canónicas ni autoriza implementación por sí mismo.
El repositorio determina qué existe; el Master PRD determina el comportamiento requerido.

## Current State

- Current functional phase: **ninguna abierta**
- Current phase status: **1W CLOSED**
- Last closed phase: **1W — Restaurant Administration & Operational Configuration**
- Closure commit message: `feat: complete phase 1W restaurant administration`
- Branch: `main`
- 1V status: **CLOSED**
- 1W status: **CLOSED**
- Manual acceptance 1W: **PASS** (`phase-1w-final-acceptance`).

El roadmap restante fue reconstruido después de 1V y aprobado a nivel macro. El Grupo A se cerró
con 1W. El Grupo B es el siguiente grupo propuesto y permanece **NOT STARTED**; este cierre no
autoriza su implementación ni declara comercialmente completa toda la V1.

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
| RBAC/Auth | Login offline, sesiones, roles V1, administración de personal/PINs y Security Floor anti-rollback | UX administrativa transversal pendiente |
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
- UX/IA administrativa: sustituir rechazos genéricos por precondiciones accionables, guiar
  dependencias entre configuraciones y reemplazar campos técnicos por controles comerciales.
  Este follow-up corresponde a la fase UX/UI propuesta y no bloquea el cierre de 1W.
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
