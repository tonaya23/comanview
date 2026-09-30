# Task ID

`<ID único>` — usar este documento como task contract, no como autorización ya otorgada.
Referencias: [contexto](COMANVIEW_CONTEXT.md) y [workflow](TEAM_WORKFLOW.md).

# Title

<Resultado concreto que necesita el usuario/producto.>

# Owner

Owner humano: <Ángel/Amanda>. Reviewer: <persona>. Integration Owner: <persona>.

# Status

<ASSIGNED | IN_PROGRESS | READY_FOR_REVIEW | ACCEPTED | CLOSED>.

# Base branch

<Base acordada>. Working branch: <angel/task o amanda/task>.

# Base commit

<SHA completo verificado; indicar fecha de actualización de refs y si hay WIP dependiente.>

# Context

<Problema, evidencia del repo y estado oficial de fase. Enlaces normativos aplicables,
decisiones aprobadas y entorno relevante. No depender de chats privados.>

# Objective

<Resultado observable y condición de término de esta tarea.>

# Frozen invariants

<Reglas obligatorias y contratos que deben preservarse, con fuente/sección concreta.>

Estas reglas no son preferencias. No violarlas ni reinterpretarlas silenciosamente;
un cambio requiere DECISION_REQUIRED y decisión humana explícita registrada.

# Proposed design / engineering preferences

<Propuesta, alternativas y motivos. Señalar claramente qué es una preferencia.>

El implementador/agente puede cuestionar y mejorar esta propuesta dentro del scope,
con evidencia y preservando las invariantes. No confundirla con una regla congelada.

# Scope

<Cambios autorizados, superficies y entregables.>

# Out of scope

<Features/fases/refactors que no se deben iniciar en esta tarea.>

# Expected affected areas

<Archivos/subsistemas previstos; marcar áreas compartidas de alto conflicto y quién
reserva su ownership. Inspeccionar el repo antes de asumir rutas o APIs.>

# Dependencies

<Tasks, branches/SHAs, decisiones, migraciones y tooling necesarios; orden de
integración acordado y estado de cada dependencia.>

# Acceptance criteria

<Criterios observables con resultado esperado, incluidos fallos/retry/persistencia
cuando corresponda. Definir los gates para review y aceptación.>

# Automated test strategy

<Tests focales y targets typecheck/build pertinentes; bases reales y grupos aislados
requeridos; validación reciente reutilizable. Global solo si este cierre lo justifica,
indicar autorización y comando canónico. Docs-only: contenido/enlaces/diff.>

# Manual acceptance

<REQUIRED / NOT REQUIRED con razón>. Responsable: <persona>.
Estado: <PENDING | STARTED | INTERRUPTED | PASS | FAIL | NOT REQUIRED>.
Entorno aislado/build: <identificador sin secretos>. Escenarios/evidencia: <enlaces>.
Automated PASS no sustituye este gate.

# Documentation

<Documentos a crear/actualizar y referencias normativas; registrar estado real,
decisiones, limitaciones y deuda sin duplicar especificaciones.>

# DECISION_REQUIRED rules

<Triggers específicos además de cambios materiales de arquitectura/invariantes o
política financiera no definida. Quién decide y dónde se registra la aprobación.>

Formato de escalación: propuesta original; problema/evidencia; alternativa recomendada;
impacto; decisión concreta. Detener solo el trabajo dependiente y conservar evidencia.

# Git restrictions

<Declarar expresamente qué está autorizado: branch, commit, push, PR, merge; quién
integra y destino permitido. Por defecto: NO COMMIT / NO PUSH / NO MERGE.>

No descartar trabajo ajeno ni usar reset/clean/stash automáticamente. Revisar staged
diff y excluir secrets/runtime artifacts. PR obligatorio antes de merge colaborativo
a main. Un WIP no representa aceptación ni cierre.

# Final implementation report

```text
TASK:
OWNER:
STATUS:

IMPLEMENTED:
<Qué cambió, contratos preservados, archivos/subsistemas.>

TESTS:
<Comandos focales, resultados/counts, filtros/skips y límites de la evidencia.>

MIGRATIONS:
<Nuevas, compatibilidad/upgrade/restore; o NONE.>

MANUAL ACCEPTANCE:
<Estado humano y evidencia; no inferir PASS.>

DEBT:
<Deuda, riesgos y fuera de scope restante.>

DECISION_REQUIRED:
<Pendientes/resueltas con enlace a decisión; o NONE.>

GIT:
branch:
commit:
working tree:
PR / integración:

READY_FOR_REVIEW
```

Usar READY_FOR_REVIEW solo tras cumplir los gates definidos; si falta un requisito,
reportar IN_PROGRESS y blocker. ACCEPTED requiere review/aceptación; CLOSED requiere
integración a main y documentación consistente.
