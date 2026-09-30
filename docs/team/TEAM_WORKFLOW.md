# ComanView — flujo de colaboración

Protocolo operativo de Ángel y Amanda. Contexto: [COMANVIEW_CONTEXT](COMANVIEW_CONTEXT.md).
Cada trabajo parte de un [task contract](TASK_TEMPLATE.md) y evidencia en el repo.

## Ownership humano

| Responsable | Ownership inicial |
| --- | --- |
| Ángel — Product / Integration Owner | Prioridades, decisiones de producto, aprobación de cambios arquitectónicos significativos, integración final y coordinación de aceptación manual |
| Amanda — Development Owner de sus tareas asignadas | Implementación del scope, pruebas focales, documentación, reporte técnico y PR |

Ambos pueden proponer mejoras, decisiones técnicas y revisar trabajo. Son
responsabilidades operativas, no una jerarquía personal. Cada tarea tiene **un owner
humano**; el reviewer puede ser la otra persona. No implementar la misma unidad de
trabajo simultáneamente desde dos branches.

## Branches y coordinación

- `main` contiene trabajo integrado, revisado y aceptado según corresponda.
- Desarrollo en `angel/<task>` o `amanda/<task>`, desde la base acordada. Ejemplos:
  `angel/group-c-order-cancellation`, `amanda/group-b-b4-import` (nombres, no autorización).
- No desarrollar directamente en main. Un WIP preserva trabajo pendiente y no
  demuestra aceptación. B3 sigue preservado fuera de main según COMANVIEW_CONTEXT.
- Paralelismo permitido cuando los límites son claros. Coordinar owner y orden antes
  de cambios simultáneos en migrations, Security Floor, `packages/domain`,
  `packages/contracts`, contratos SDK, Auth/RBAC, Event Log core, infraestructura de
  proyección Cloud o primitives financieros. Estas áreas pueden cambiar con scope aprobado.
- Si dos tareas empiezan a modificar el mismo core subsystem, pausar una antes de
  crear divergencia material. Acordar quién termina primero y quién actualiza/rebasa
  después. Un merge conflict no decide arquitectura.

## Inicio y estados

Antes de iniciar: revisar working tree y preservar cambios existentes; actualizar
refs (`git fetch origin`), confirmar base branch/SHA y dependencias; leer task
contract, COMANVIEW_CONTEXT, [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md)
y secciones normativas; inspeccionar código, scripts y contratos reales. Crear la
branch desde la base acordada, sin reset/stash/limpieza automática de trabajo ajeno.

| Estado | Significado |
| --- | --- |
| ASSIGNED | Owner humano, scope y base definidos |
| IN_PROGRESS | Implementación activa |
| READY_FOR_REVIEW | Implementación y validación focal terminadas; aún no integrada |
| ACCEPTED | Review y aceptación manual requerida completados, con evidencia |
| CLOSED | Integrado a main y documentación consistente |

READY_FOR_REVIEW no equivale a ACCEPTED. Un blocker de revisión vuelve la tarea a
IN_PROGRESS; una decisión pendiente se registra con evidencia y limita el trabajo
dependiente. No declarar CLOSED antes de los gates requeridos.

## IA y decisiones

Cada desarrollador puede usar su propio agente. Preferencia: implementador + AI A
→ reviewer humano + AI B. La IA implementadora no debe ser la única fuente de review;
la responsabilidad y aceptación permanecen en humanos.

Compartir por Git, PR, task contract, implementation report y docs; no depender de
historial privado ni de «mi IA dijo que…». El agente verifica el checkout y los
contratos vigentes antes de actuar. No delegar autoridad de producto/merge al agente.

Separar invariantes congeladas de preferencias de diseño. Propuestas pueden
cuestionarse/mejorarse dentro del scope. Cambios materiales de arquitectura,
invariantes o política financiera requieren **DECISION_REQUIRED** y decisión humana
registrada antes de implementarlos. Ángel coordina esa aprobación inicialmente.

## Validación y aceptación

- Implementación: tests focales del código y contratos afectados.
- Fixes: repetir solo escenarios afectados; ampliar si una regresión lo justifica.
- READY_FOR_REVIEW: cierre focal suficiente, typecheck/build de targets afectados
  cuando corresponda, `git diff --check`, evidencia y limitaciones en el reporte.
- Global: ejecutar cuando el cierre estable de una fase lo justifique, según su
  contract. El comando raíz `pnpm test` incluye grupos resource/Windows-DPAPI
  posteriores a Turbo; un test filtrado de Edge no lo sustituye. Consultar scripts
  actuales y cubrir PostgreSQL real cuando sea parte del gate. No ocultar fallos
  aumentando timeouts, eliminando escenarios o creando skips injustificados.
- Documentación sola: validar contenido, enlaces y diff; no ejecutar tests de producto.

**Automated PASS != manual acceptance.** Features visibles/operativas requieren
aceptación humana cuando corresponda, coordinada por Ángel y realizada por owner/
reviewer humano. Registrar entorno, build/commit, escenarios, resultado y defects.
STARTED, INTERRUPTED o PENDING no se convierten en PASS por tests automáticos.

## PR e integración

PR obligatorio antes de merge colaborativo a main. Antes de publicar, revisar
candidatos y staged diff; excluir secretos y artifacts locales. Commit/push/PR/merge
requieren la autorización indicada en el task contract o una instrucción humana
explícita. La obligación de PR no concede permiso automático para publicar o mergear.

El PR debe incluir Task ID, owner y reviewer, base commit, scope/out of scope,
decisiones arquitectónicas, archivos/subsistemas, migrations/compatibilidad,
tests y resultados, estado de aceptación manual, deuda y decisiones resueltas.
Añadir screenshots si ayudan a evaluar UX, sin datos sensibles.

Ángel es Integration Owner inicial. Amanda entrega PR y no mergea automáticamente
sus propios PRs a main; el mismo cuidado aplica a agentes. Review/aceptación deben
corresponder al diff final: revisar cambios posteriores y validar lo afectado antes
de integrar. Tras merge, registrar SHA/estado en documentación y cerrar la tarea.
El equipo puede cambiar explícitamente este modelo más adelante.

## Entornos locales

Cada persona usa su propia DB, runtime Edge, secretos y configuración. Los labs
necesitan binding, Secret Store, Security Floor y Device/browser identity coherentes;
no combinar artifacts de instalaciones distintas ni copiar identidades por conveniencia.
Preparar/arrancar por tooling y lifecycle soportados; inspeccionar scripts antes de
ejecutar `dev:prepare` o una migration. Para aceptación, usar laboratorio aislado.

No compartir mediante Git `.env`, SQLite/DB/WAL/SHM, secret stores, Security Floors
runtime, passwords/tokens/PINs reales, provisioning codes, Recovery Keys, private keys,
logs sensibles, backups, browser profiles ni outputs temporales de labs. Fixtures
versionadas y harnesses reproducibles pueden formar parte de la tarea; sus datos
runtime permanecen locales. Nunca incluir secretos en reportes o screenshots.

## Sync breve

Usar en handoff/PR o conversación del equipo; no requiere una ceremonia adicional:

```text
OWNER:
TASK:
STATUS:
BRANCH:
TOUCHED AREAS:
BLOCKERS:
DECISION_REQUIRED:
NEXT:
```

Ante un conflicto de ownership/base, registrar evidencia y acordar orden antes de
continuar la parte compartida. El trabajo independiente puede seguir dentro del scope.
