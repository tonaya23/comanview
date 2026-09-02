# ComanView Implementation Status

Ledger operativo del estado implementado y del trabajo restante de V1.
No sustituye las especificaciones canónicas ni autoriza implementación por sí mismo.
El repositorio determina qué existe; el Master PRD determina el comportamiento requerido.

## Current State

- Current functional phase: **NONE**
- Last closed phase: **1V — Backup / Recovery**
- Last closed commit: `48b9c3a61a2c36acac60737a981741dcfd1ab74a`
- Commit message: `feat: complete phase 1V backup and recovery`
- Branch: `main`
- 1V status: **CLOSED**
- Clasificación de cierre: `READY_WITH_NON_BLOCKING_DEBT`.

El roadmap restante fue reconstruido después de 1V y aprobado a nivel macro.
Ninguna fase funcional posterior ha comenzado. Crear este ledger no abre 1W.
El cierre de 1V no equivale a declarar comercialmente completa toda la V1.

## Implemented Foundation

Las capacidades operativas siguientes existen; su uso presupone un entorno configurado.
Backend, dominio o persistencia no equivalen a administración accesible al restaurante.

| Área | Implementación real hasta 1V | Límite comercial actual |
| --- | --- | --- |
| Core domain/invariants | Money, catálogo, snapshots y reglas transaccionales | No sustituye configuración/onboarding |
| Orders | POS, DRAFT/SENT, rondas, cierre y operaciones de mesa | Recorridos V1 adicionales pendientes |
| Payments | CASH/CARD/OTHER, pagos parciales, propinas y void autorizado | Sin terminal bancaria integrada ni split bill completo |
| Cash | Apertura, movimientos, arqueo y X/Z | Register, moneda y fecha operativa no administrables integralmente |
| Tables/Waiter | UI de mesas existentes, comandas y solicitud de cuenta | Falta configuración administrativa de zonas/mesas |
| KDS | UI de tickets, estaciones existentes y preparación | Falta administración de estaciones/thresholds |
| Printing infrastructure | Cola durable, renderer ESC/POS y adaptador TCP | Startup normal DEBUG; falta configuración física comercial |
| RBAC/Auth | Login offline, sesiones, roles V1 y autorización superior | Falta administración cotidiana de usuarios/PINs |
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

- **Restaurant Administration / Operational Configuration:** datos del negocio, branding,
  moneda, impuestos, timezone/business date, register, usuarios/PINs, zonas y estaciones.
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

**PROPUESTO / APROBADO A NIVEL MACRO — NO INICIADO.**
Estos grupos representan el roadmap macro, no fases funcionales ya abiertas.
El alcance detallado y las decisiones correspondientes deben aprobarse antes de implementar.

| Grupo | Trabajo restante |
| --- | --- |
| A | Restaurant Administration + Operational Configuration |
| B | Commercial Catalog + CSV/XLSX Import |
| C | Complete V1 Operational Flows |
| D | Commercial Printing + Hardware Configuration |
| E | Distribution + Deployment + Onboarding + Go-Live |
| F | Signed Release / OTA Lifecycle |
| G | Public Storefront |

Ningún grupo constituye una autorización de ejecución. No hay una fase actualmente iniciada.

## Next Decision

- Candidate next phase: **1W — Restaurant Administration & Operational Configuration**
- Status: **PROPOSED / NOT STARTED**
- Next approved functional work: **NONE**; falta aprobación de alcance detallado.

Antes de implementarla deben resolverse autoridad Cloud/Edge/OWNER y política de configuración:
qué campos administra cada actor, tratamiento de Configuration firmada existente y reglas de
moneda, impuestos, timezone y business date. No cambiar estas decisiones implícitamente desde UI.

## Canonical References

- [Master PRD](../Master_PRD.md): autoridad normativa de implementación.
- [Master Technical Specification](Master_Technical_Specification.md): referencia técnica ampliada.
- [Full Specification](Full_Specification.md): contexto y detalle complementario.
- [Acceptance Phase 1V](Acceptance_Phase_1V.md): aceptación general y upgrade productivo PASS.

## Ledger Maintenance Rule

Actualizar este archivo únicamente cuando:

- Una fase abre o cierra.
- Cambia el commit de cierre.
- Cambia el roadmap aprobado.
- Aparece o se resuelve un blocker comercial relevante.
- Cambia deuda explícitamente aceptada.

Mantenerlo breve: no convertirlo en changelog, historial de tests ni otra especificación.
