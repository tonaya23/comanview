# ComanView — contexto de desarrollo

Entrada para humanos y agentes IA. Leer junto con [TEAM_WORKFLOW](TEAM_WORKFLOW.md)
y el task contract basado en [TASK_TEMPLATE](TASK_TEMPLATE.md). Este documento orienta;
las reglas especializadas permanecen en las especificaciones canónicas.

## Producto y arquitectura

ComanView es una plataforma modular B2B para operar restaurantes: POS, caja,
comandería, cocina y administración. El Edge concentra la autoridad operacional y
financiera local. POS, Waiter y KDS envían comandos por la LAN; sus estados de UI
no son una segunda base transaccional.

- **Offline-first:** con Edge disponible, la operación local soportada continúa sin
  Internet conforme a permisos, configuración y Licensing vigentes.
- **Cloud:** control contractual, documentos firmados, sincronización y proyecciones;
  no participa en el camino crítico de una venta. El bootstrap y otros procesos
  específicos pueden requerir Cloud. Sync no equivale a backup.
- **Persistencia:** current-state + Event Log inmutable; no Event Sourcing puro.
  Outbox/Inbox y ACK durable coordinan Sync.
- **V1:** un único Edge primario por Location; no active-active. Edge es un modular
  monolith y conserva la autoridad aunque haya varios clientes.

## Stack y ubicación

TypeScript; Node.js **24 LTS**; Fastify; SQLite/WAL con better-sqlite3 en Edge;
PostgreSQL **18** en Cloud; Drizzle y Zod; React/Vite en POS, Waiter, KDS y Super
Admin; pnpm workspaces/Turborepo. Versiones y scripts efectivos: [package.json](../../package.json)
y lockfile. Inspeccionar sus scripts antes de proponer comandos de ejecución.

| Área | Ubicación principal / responsabilidad |
| --- | --- |
| Orders, Payments, Cash | `packages/domain`, `packages/money`, módulos de `apps/edge/src/modules`: reglas financieras y lifecycle |
| Catalog, Modifiers | Dominio/contratos, persistencia Edge y módulo Catalog: precios, reglas y snapshots |
| POS / Admin Local | `apps/pos`: operación y administración contra Edge |
| Waiter / KDS | `apps/waiter`, `apps/kds`: comandas y preparación; API/KDS en Edge |
| Printing | `packages/printing`, módulo Printing de Edge: cola durable y snapshots de impresión |
| Auth, Licensing, Recovery | `packages/auth`, `packages/licensing`, módulos de Edge: autorización y estado de seguridad |
| Cloud projection | `apps/cloud-api`, `apps/cloud-worker`, `packages/database/src/cloud`: Inbox y read models derivados |
| Fronteras compartidas | `packages/contracts`, `packages/client-sdk`; migrations separadas en `migrations/edge` y `migrations/cloud` |

Las ubicaciones no acreditan que toda la capacidad comercial esté terminada.

## Invariantes que deben preservarse

1. Edge valida estado, permisos y precios autoritativos. La UI no autoriza operaciones
   por sí sola ni calcula una verdad financiera independiente.
2. Money usa aritmética exacta; la implementación usa minor units y reglas explícitas
   de moneda/redondeo. No introducir binary float como fuente financiera.
3. Event Log describe qué ocurrió; Audit quién, por qué y bajo qué autorización.
   Preservar historia y la atomicidad correspondiente con el estado de negocio.
4. Mutaciones críticas usan `command_id`/`commandId` e idempotencia. Un retry incierto
   conserva el mismo intento; receipts no sustituyen autorización actual.
5. OCC valida versiones y referencias contra el estado vigente; no resolver conflictos
   financieros con last-write-wins ni saltarse controles para lograr un 200.
6. Un OrderItem captura precio, impuestos, modifiers y estación. Cambios externos de
   catálogo no reescriben snapshots. Una edición explícita autorizada de DRAFT puede
   reconstruirlo según el PRD; SENT e historia conservan su semántica inmutable.
7. Security Floor vive fuera de SQLite y contiene solo seguridad/lifecycle monotónicos,
   no estado operacional. Preservar locking/CAS, binding, revisiones, Licensing,
   revocaciones, Personnel y reglas de `recoveryEpoch`. Restore no revive Devices.
8. Instalación establecida con DB ausente/corrupta entra en `RECOVERY_REQUIRED`;
   nunca crear silenciosamente una DB operacional vacía. FIRST_BOOT requiere una
   instalación genuinamente nueva. Upgrade/restore usan el lifecycle productivo
   validado; no editar migrations históricas ni sustituirlo con SQL manual.
9. No borrar historia, clonar identidad Edge, imprimir secretos ni descartar trabajo
   ajeno. Estados parciales o ambiguos de seguridad fallan cerrado.

## Estado oficial y trabajo preservado

Snapshot de colaboración **2026-09-29**; base funcional de main:
`c6ff1ceae84657ea1cd2fbdde9ca9ae0127db8f2` (checkpoint B2).

**GROUP B OPEN — B1 CLOSED — B2 CLOSED — B3 NOT OFFICIALLY ACCEPTED / NOT CLOSED.**

B3 está fuera de main en `angel/group-b-b3-core`, WIP commit
`03ba3c7f3c6f3db6ddc3403b614acac792003293`:
quantity/schema17, versions/schema18, Group/Option Admin, Product assignments y
overrides, proyección Cloud y retest del blocker de carga/creación. Está en revisión,
con aceptación manual incompleta y deuda UX; el WIP no acredita aceptación/cierre.
Este bootstrap documental tampoco integra B3.

[IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md) describe lo integrado en cada
checkout: en la base B2 aún indica B3 NOT STARTED. Para B3, consultar la rama WIP y
su `docs/Catalog_Modifiers_B3.md`; ese archivo no existe en la base de main. No copiar
sus cambios ni asumir disponibles sus contratos/migrations al trabajar desde main.
El SHA de base es evidencia histórica, no un requisito de congelar main para siempre.

## Fuente de verdad y ejecución de una tarea

Jerarquía normativa, en orden:

1. [Master_PRD.md](../../Master_PRD.md).
2. [Master_Technical_Specification.md](../Master_Technical_Specification.md).
3. [Full_Specification.md](../Full_Specification.md).

El repo/working tree demuestra implementación real; el ledger demuestra estado
registrado, no sustituye las invariantes. Un task contract autoriza alcance y acciones;
cualquier cambio normativo requiere una decisión explícita registrada. Leer las
secciones especializadas aplicables. La raíz no contiene `README.md` en esta base;
usar estas entradas y los documentos existentes, sin inventar enlaces.

Antes de trabajar, inspeccionar rama, base, diff, scripts, contratos y subsistemas
relevantes. No reimplementar por falta de historial de chat. Si hace falta cambiar
materialmente arquitectura/invariantes o definir una regla financiera no aprobada,
detener esa parte con **DECISION_REQUIRED**: problema, evidencia, alternativa,
impacto y decisión concreta. Las preferencias de diseño pueden mejorarse conservando
las invariantes.

Durante implementación/fixes, pruebas focales; validación global solo cuando un
cierre estable de fase lo justifique. Automated PASS no acredita aceptación manual.
Git: no commit, push ni merge salvo autorización explícita del task contract o del
owner humano. Seguir el flujo y los entornos aislados de TEAM_WORKFLOW.
