**ComanView**

Master Technical Specification / Product Requirements Document

V1 · Versión consolidada, auditada y corregida

# 0. Propósito del Documento

Este documento constituye la fuente de verdad funcional, arquitectónica y técnica de ComanView V1.

Está diseñado para ser interpretado tanto por desarrolladores humanos como por agentes de programación basados en IA.

Las decisiones aquí contenidas tienen carácter normativo.

### Convenciones

MUST: requisito obligatorio.

MUST NOT: comportamiento prohibido.

SHOULD: comportamiento recomendado salvo justificación técnica.

MAY: comportamiento permitido pero no obligatorio.

V1: alcance comercial inicial.

Las funcionalidades explícitamente marcadas como fuera de V1 MUST NOT introducirse durante el desarrollo inicial salvo cambio formal de alcance.

Cuando una regla aparezca definida en una sección especializada, dicha sección será la fuente de verdad y no deberá duplicarse con implementaciones alternativas en otros módulos.

### Principios globales

ComanView deberá priorizar:

Continuidad operacional.

Offline-First.

Integridad transaccional.

Trazabilidad.

Idempotencia.

Seguridad por defecto.

Modularidad comercial.

Mantenibilidad.

Recuperación ante fallos.

Simplicidad operacional en el restaurante.

# 1. Visión del Producto y Modelo de Negocio

## 1.1 Producto

ComanView será una plataforma B2B SaaS modular para restaurantes y establecimientos de alimentos.

Un mismo producto deberá adaptarse tanto a:

Un puesto pequeño con una caja e impresora.

Una cafetería.

Un restaurante con mesas y meseros.

Un restaurante con cocina, barra y KDS.

Operaciones mayores mediante módulos futuros.

```text
La diferencia entre clientes será determinada por:
```

```text
Plan
```

```text
+
```

```text
Entitlements
```

```text
+
```

```text
Feature Flags
```

```text
+
```

```text
Configuración del Location
```

No existirán versiones independientes del software por tipo de establecimiento.

**Regla:**

**One Product, Multiple Configurations.**

V1 no será un prototipo desechable ni un MVP trivial. Representa la primera implementación comercial seria de la plataforma modular; las decisiones de arquitectura SHOULD permitir su evolución sin exigir reescribir el Core para crecer.

## 1.2 Core obligatorio

Todo cliente deberá disponer del Core.

Incluye:

### Configuración

Información comercial.

Logo.

Moneda.

Impuestos.

Información operativa.

### Catálogo

Categorías.

Productos.

Precios.

Modificadores.

### POS

Creación de venta.

Productos.

Totales.

Cobros.

Tickets.

### Caja

Apertura.

Movimientos.

Corte X.

Corte Z.

Arqueo.

## 1.3 Módulos operativos V1

### Mesas y Comandería

Incluye:

Zonas.

Mesas.

Órdenes de mesa.

Comandería móvil.

Transferencia de mesas.

Unión física de mesas.

Split bill.

### Impresión

Incluye:

ESC/POS.

Print Manager.

Routing por estación.

Fallback.

Reimpresión.

Tickets de cancelación.

### KDS

Incluye:

Estaciones.

Tickets.

Estados de preparación.

Cronómetros.

Notificación de órdenes listas.

## 1.4 Módulos posteriores

Fuera del alcance funcional inicial:

### Inventario y Recetas

Insumos.

Recetas.

Costeo.

Mermas.

Stock.

Proveedores.

Compras.

### Facturación Electrónica

Deberá implementarse posteriormente como servicio desacoplado del POS.

El POS deberá completar la venta independientemente del sistema fiscal.

### Multi-Sucursal

Permitirá posteriormente:

Múltiples Locations.

Consolidación.

Traspasos.

Inventarios independientes.

Reportes consolidados.

El modelo de datos MUST estar preparado desde V1 mediante tenant_id y location_id.

## 1.5 Modularidad comercial

Los módulos comerciales y los Feature Flags técnicos MUST mantenerse separados.

```text
Ejemplo:
```

```text
ENTITLEMENT:
```

```text
KDS = enabled
```

```text
FEATURE FLAGS:
```

```text
kds.enabled = true
```

```text
kds.experimental_layout = false
```

Un Feature Flag no constituye necesariamente un producto vendible.

## 1.6 Public Storefront V1

ComanView Cloud incluirá un servicio público capaz de generar automáticamente:

Landing page del Location.

Menú digital.

Horarios.

Ubicación.

Contacto.

Categorías.

Productos.

Precios.

Disponibilidad.

Código QR.

URL pública.

Formato inicial:

restaurant-slug.comanview.app

El Storefront será definido técnicamente en la Sección 12.

# 2. Arquitectura de Red — Edge-to-Cloud / Offline-First

## 2.1 Arquitectura general

```text
ComanView utilizará:
```

```text
Cloud
```

```text
│
```

```text
Internet
```

```text
│
```

```text
Edge
```

```text
│
```

```text
LAN
```

```text
├── POS
```

```text
├── Waiter
```

```text
├── KDS
```

```text
└── Printers
```

El Edge será la autoridad operacional local.

Cloud será la capa administrativa, de sincronización, consolidación y servicios públicos.

## 2.2 Principio Offline-First

**Regla:**

**No Internet ≠ No Operation.**

Mientras Edge esté disponible, el restaurante MUST poder:

Autenticar usuarios existentes.

Abrir caja.

Crear Orders.

Gestionar mesas.

Enviar comandas.

Utilizar KDS.

Imprimir.

Cobrar.

Realizar Corte X/Z.

Consultar configuración local.

Cloud MUST NOT participar en el camino crítico de una venta.

## 2.3 Responsabilidades del Edge

Edge deberá proporcionar:

API local.

Base de datos local.

Autenticación.

Domain Engine.

Order processing.

Payment processing.

Cash processing.

Event Log.

Audit Log.

Sync Engine.

Print Manager.

Backup Engine.

License Manager.

Device Manager.

WebSocket server.

Health/telemetry.

## 2.4 Estado Actual + Event Log

```text
ComanView utilizará un modelo híbrido:
```

```text
Current State
```

```text
+
```

```text
Immutable Event Log
```

No implementará Event Sourcing puro para todos los módulos.

El estado actual optimiza la operación.

El Event Log proporciona:

Historia.

Sincronización.

Idempotencia.

Reconstrucción.

Trazabilidad.

## 2.5 Sincronización transaccional

Las operaciones transaccionales MUST sincronizarse mediante eventos y no mediante sobrescritura completa de objetos.

```text
Correcto:
```

```text
ITEM_ADDED
```

```text
ITEM_VOIDED
```

```text
PAYMENT_COMPLETED
```

Incorrecto como mecanismo principal:

"Replace entire Table 4 state"

## 2.6 Identidades

Las entidades sincronizables utilizarán identificadores globales.

```text
Como mínimo:
```

```text
tenant_id
```

```text
location_id
```

```text
edge_id
```

```text
device_id
```

```text
user_id
```

```text
order_id
```

```text
order_item_id
```

```text
payment_id
```

```text
event_id
```

El estándar técnico será UUID v7 según Sección 12.

## 2.7 Secuencia temporal

El reloj del dispositivo no será autoridad.

```text
Edge deberá asignar:
```

```text
edge_received_at
```

```text
edge_committed_at
```

```text
local_sequence
```

Los timestamps del cliente podrán conservarse únicamente como metadata.

## 2.8 Sync Queue / Transactional Outbox

Los eventos sincronizables deberán persistirse durablemente antes de intentar transmisión.

```text
Estados conceptuales:
```

```text
PENDING
```

```text
SYNCING
```

```text
SYNCED
```

```text
FAILED
```

Edge MUST conservar eventos pendientes tras reinicio.

## 2.9 Sincronización Edge → Cloud

```text
Flujo:
```

```text
Pending Events
```

```text
↓
```

```text
Batch
```

```text
↓
```

```text
Cloud Sync API
```

```text
↓
```

```text
Validate
```

```text
↓
```

```text
Idempotency
```

```text
↓
```

```text
Durable Persist
```

```text
↓
```

```text
ACK
```

```text
↓
```

```text
Mark SYNCED
```

Solo eventos confirmados mediante ACK podrán marcarse como sincronizados.

Un batch MAY producir resultados parciales. Cloud MUST identificar qué event_id fueron aceptados y cuáles fallaron. Solo los eventos aceptados podrán marcarse SYNCED; los fallidos deberán permanecer disponibles para retry y diagnóstico con su causa asociada.

## 2.10 Idempotencia

Cada evento utilizará event_id.

Procesar el mismo event_id varias veces MUST producir un único efecto lógico.

## 2.11 Concurrencia

Eventos compatibles podrán coexistir.

Operaciones incompatibles deberán validarse contra estado actual y versiones lógicas.

No se utilizará simplemente:

last write wins

para datos transaccionales sensibles.

## 2.12 Cloud → Edge

Cloud podrá sincronizar:

Licencias.

Entitlements.

Feature Flags.

Configuración.

Políticas.

Información OTA.

```text
Se utilizará:
```

```text
Push
```

```text
+
```

```text
Periodic Pull
```

```text
+
```

```text
config_version
```

El Push MUST NOT ser el único mecanismo.

Toda configuración Cloud validada que sea necesaria para operar —incluyendo licencia, Entitlements, Feature Flags y políticas aplicables— MUST persistirse localmente. Durante una desconexión, Edge utilizará la última versión local válida y MUST NOT consultar Cloud para cada decisión operacional.

## 2.13 Heartbeat

```text
Edge enviará información como:
```

```text
edge_id
```

```text
version
```

```text
last_sync
```

```text
pending_events
```

```text
health
```

```text
storage_status
```

La ausencia de heartbeat MUST NOT provocar bloqueo operacional automático.

## 2.14 Fallo del Edge

La pérdida del Edge sí representa un fallo local crítico.

V1 deberá garantizar:

Auto-start.

Persistencia.

Recuperación tras reinicio.

Event Log durable.

Print Queue durable.

CashSession durable.

Alta disponibilidad active-active queda fuera de V1.

# 3. Super Admin, Licenciamiento, Feature Flags, Monitoreo y OTA

## 3.1 Super Admin

Será el Control Plane privado de ComanView.

Administrará:

Tenants.

Locations.

Edges.

Licencias.

Entitlements.

Feature Flags.

Versiones.

Telemetría.

OTA.

Soporte.

No será el panel administrativo normal del restaurante.

## 3.2 Licencias

Cada Edge conservará una licencia local firmada.

```text
Conceptualmente:
```

```text
license_id
```

```text
tenant_id
```

```text
location_id
```

```text
plan
```

```text
entitlements
```

```text
device_limits
```

```text
issued_at
```

```text
expires_at
```

```text
grace_until
```

```text
license_status
```

```text
config_version
```

```text
signature
```

La clave privada de firma MUST permanecer únicamente en infraestructura ComanView.

Edge MUST poseer únicamente el material necesario para verificar la autenticidad de una licencia firmada. La capacidad de firmar, emitir o modificar criptográficamente licencias válidas MUST permanecer exclusivamente en infraestructura Cloud controlada por ComanView.

## 3.3 Estados

```text
ACTIVE
```

```text
PAST_DUE
```

```text
GRACE_PERIOD
```

```text
SUSPENDED
```

```text
TERMINATED
```

Offline MUST NOT interpretarse automáticamente como impago.

ACTIVE: licencia vigente; operación normal.

PAST_DUE: existe un pago vencido confirmado, pero el cliente continúa dentro del período administrativo permitido; la operación continúa y las advertencias se dirigen principalmente a usuarios administrativos.

GRACE_PERIOD: Edge no ha podido validar recientemente con Cloud o existe una condición administrativa que aún no justifica suspensión; POS, caja, mesas, KDS e impresión continúan mientras dure el período configurado.

SUSPENDED: Cloud confirmó explícitamente la suspensión y aplica la política de Cierre de Turno Garantizado.

TERMINATED: relación comercial terminada o licencia definitivamente cancelada; MUST NOT tratarse como una simple mora temporal.

## 3.4 Cierre de Turno Garantizado

Si Cloud confirma SUSPENDED mientras existe una CashSession OPEN:

ComanView MUST permitir finalizar la jornada:

Nuevas comandas durante el servicio activo.

KDS.

Impresión.

Cobros.

Cierre de Orders.

Corte X.

Corte Z.

```text
Después del Corte Z:
```

```text
License = SUSPENDED
```

```text
CashSession = CLOSED
```

```text
MUST bloquearse:
```

```text
OPEN_NEW_CASH_SESSION
```

hasta reactivación válida.

## 3.5 Reactivación temporal

Soporte podrá emitir una autorización temporal:

Firmada/verificable.

Limitada en tiempo.

Ligada a Tenant/Location.

## 3.6 Signed Licensing y tiempo efectivo V1

Cloud emite streams independientes `LICENSE`, `FEATURE_FLAGS` y `CONFIGURATION`, cada uno ligado a `tenantId`, `locationId` y `edgeId`, con revisión monotónica, `kid`, envelope Ed25519 y hash SHA-256. La private key se obtiene exclusivamente de secrets de deployment; PostgreSQL, repositorio, respuestas y logs MUST NOT contenerla. El keyring público de Edge soporta overlap `current` + `next`.

`LICENSE` dura 7 días y contiene un `graceUntil` 21 días posterior. Edge hace pull autenticado cada 5 minutos, renueva al restar 48 horas y limita backoff a 1 hora. `desiredControlRevision` en heartbeat es un hint; el pull periódico es la fuente durable de convergencia. Los ACK se almacenan en un outbox local y son idempotentes en Cloud.

SQLite conserva los documentos actuales y al menos las tres revisiones válidas más recientes, ACK pendientes, `effectiveTimeFloor`, última observación Cloud, checkpoints de reloj, sticky state, capabilities protegidas, Protected Orders y prueba de autorización de CashSession. Una revisión inferior se ignora; misma revisión con hash distinto se rechaza; documento inválido nunca sustituye last-known-good.

El tiempo efectivo es `max(monotonicWallEstimate, effectiveTimeFloor)`. Se persiste cada 60 segundos. Rollback mayor a 5 minutos y forward jump mayor a 5 minutos durante el proceso se marcan; después de restart un salto hacia adelante mayor a 7 días exige revalidación Cloud. Una respuesta Cloud autenticada actualiza el floor sin hacerlo retroceder.

`SUSPENDED` y `TERMINATED` son sticky offline. Una revisión firmada posterior MAY cambiar el estado; desconectar Cloud nunca revierte el último estado restrictivo conocido.

## 3.7 EffectiveCapabilities, Guaranteed Shift y recovery

Routes y componentes nunca autorizan con `planCode`. Application Services consultan `EffectiveCapabilities` antes de Orders, Payments, Cash, KDS y Printing. La UI solo refleja esa decisión; Edge sigue siendo autoridad.

Una reducción recibida durante una `CashSession` OPEN conserva durablemente para ese turno las capabilities que estaban autorizadas al abrirlo. Al cerrar la sesión se elimina esa protección. Si expira `graceUntil` o el estado es `SUSPENDED`/`TERMINATED`, la sesión demostrablemente autorizada entra en Guaranteed Shift y puede terminar Orders, KDS, impresión, Payments, Corte X/Z y cierre seguro; no puede abrir otra sesión.

Sin CashSession OPEN, las Orders OPEN preexistentes se capturan en `edge_protected_orders`. En modo Protected Operations solo pueden enviarse pendientes existentes, prepararse, imprimirse, cobrarse y cerrarse. Crear Orders/mesas, agregar items y utilizar administración general se rechaza en Edge.

Cuando sea necesario cobrar esas obligaciones puede abrirse una única CashSession `purpose=LICENSE_RECOVERY`, ligada mediante `cash_session_protected_orders`, auditada y sin capacidad de originar consumo nuevo. Su uso queda marcado durablemente para impedir encadenamiento. Si no existe documento utilizable, Guaranteed Shift Recovery requiere `opened_license_revision` y `opened_license_mode` persistidos por una apertura previamente autorizada; no se infiere autorización de estado incompleto o corrupto.

Configuration V1 está limitada a `payment.tipsEnabled` y `payment.tipPercentageOptionsBasisPoints`. Feature Flags no conceden Entitlements ausentes; solo pueden restringir una capability ya licenciada.

Auditada.

## 3.6 Restricciones en suspensión

Durante SUSPENDED deberán bloquearse funciones administrativas como:

Catálogo.

Usuarios.

Impresoras.

KDS config.

Configuración comercial.

Durante el cierre garantizado únicamente permanecerán disponibles funciones necesarias para terminar la operación.

## 3.7 Monitoreo

Super Admin podrá consultar:

Estado Edge.

Último heartbeat.

Versión.

Last sync.

Pending events.

Failed events.

DB status.

Storage.

Printers.

Devices.

KDS.

Uptime.

Telemetría técnica y analítica comercial MUST mantenerse conceptualmente separadas.

## 3.8 Acciones remotas

```text
Permitidas únicamente mediante comandos predefinidos:
```

```text
REFRESH_LICENSE
```

```text
REFRESH_CONFIG
```

```text
RETRY_SYNC
```

```text
RESTART_EDGE_SERVICE
```

```text
RUN_HEALTH_CHECK
```

```text
TEST_PRINTER
```

```text
DOWNLOAD_DIAGNOSTIC_LOGS
```

```text
CHECK_FOR_UPDATE
```

```text
INSTALL_UPDATE
```

MUST NOT existir ejecución arbitraria de comandos del sistema operativo desde Super Admin.

## 3.9 OTA

```text
Canales:
```

```text
INTERNAL
```

```text
PILOT
```

```text
STABLE
```

```text
Flujo:
```

```text
Publish
```

```text
→ INTERNAL
```

```text
→ PILOT
```

```text
→ gradual rollout
```

```text
→ STABLE
```

Toda actualización deberá:

Verificar integridad/firma.

Respetar ventana segura.

Ejecutar Health Check.

Soportar rollback cuando sea técnicamente seguro.

Integrarse con backups/migrations según Sección 11.

No deberá reiniciar Edge durante operaciones críticas.

## 3.10 Auditoría administrativa

Toda acción sensible del Super Admin MUST generar Audit Log.

# 4. Flujos Visuales, UX/UI y Experiencia Operativa

## 4.1 Interfaces

```text
V1 tendrá:
```

```text
POS
```

```text
Waiter
```

```text
KDS
```

Las interfaces compartirán estado pero MUST adaptarse al rol y dispositivo.

La interfaz deberá priorizar información y acciones según el rol: WAITER → mesas/comandas; CASHIER → POS/cobros/caja; KITCHEN → KDS/preparación; MANAGER → operación/autorizaciones; OWNER → administración/reportes. RBAC continúa siendo la autoridad real de permisos.

## 4.2 Principios UX

Priorizar:

Touch.

Pocos pasos.

Poco teclado.

Alto contraste.

Información crítica visible.

Confirmaciones únicamente en acciones sensibles.

Color + texto/icono.

## 4.3 POS

Layout recomendado:

Categories | Products | Current Order

```text
Flujo:
```

```text
Products
```

```text
→ Modifiers
```

```text
→ Review
```

```text
→ Pay
```

```text
→ Payment Method
```

```text
→ Tip
```

```text
→ Confirm
```

```text
→ Ticket
```

## 4.4 Tipos de Order

```text
COUNTER
```

```text
TABLE
```

```text
TAKEOUT
```

Se definen normativamente en Sección 7.

## 4.5 Mesas

```text
V1 utilizará:
```

```text
Zones
```

```text
+
```

```text
Configurable Grid
```

No habrá editor arquitectónico drag-and-drop avanzado.

```text
Estados visuales podrán representar:
```

```text
FREE
```

```text
OPEN
```

```text
READY
```

```text
PAYMENT_REQUESTED
```

```text
ALERT
```

sin convertirlos necesariamente en estados de Order.

En V1 el estado operacional de mesa se derivará con precedencia explícita:
`PAYMENT_REQUESTED > READY > OPEN > FREE`. `READY` significa que existe al menos un
`OrderItem` `SENT` con `prep_status = READY`; no modifica el lifecycle financiero ni impide cerrar
una Order. `PAYMENT_REQUESTED` se activa mediante la intención explícita `Solicitar cuenta` y se
persiste como `payment_requested_at` en la Order abierta.

## 4.6 Comandería

Tablet:

Categories | Products | Current Order

```text
Smartphone:
```

```text
Categories
```

```text
→ Products
```

```text
→ Order
```

Misma funcionalidad, layout responsive.

## 4.7 Draft vs Sent

```text
Sección 7 define:
```

```text
DRAFT
```

```text
SENT
```

Un ítem SENT ya produjo consecuencias operativas y requiere flujo explícito para modificación/cancelación.

## 4.8 Rounds

Cada acción SEND genera una Round.

Una Order puede contener múltiples rondas.

## 4.9 KDS

```text
Estados:
```

```text
PENDING
```

```text
PREPARING
```

```text
READY
```

Los tickets podrán dividirse por estación.

Los thresholds de tiempo serán configurables por estación.

## 4.10 Salida por estación

```text
KDS
```

```text
PRINTER
```

```text
KDS + PRINTER
```

## 4.11 Precuenta

Generar precuenta MUST NOT cerrar la Order.

Imprimir una precuenta y solicitar cuenta son conceptos separados: imprimir `PRECHECK` por sí solo
MUST NOT activar `PAYMENT_REQUESTED`. La UI MAY ofrecer ambas acciones juntas, pero Edge deberá
registrar explícitamente la intención de solicitar cuenta.

## 4.12 Split Bill

V1 soportará:

Por productos.

Por partes iguales.

No creará automáticamente nuevas Orders.

## 4.13 Pagos

Una Order podrá contener múltiples pagos y métodos mixtos.

El modelo financiero está definido en Sección 8.

## 4.14 Propinas

V1 permitirá activar/desactivar propinas.

Opciones:

Porcentaje.

Monto manual.

La propina transaccional será independiente del consumo.

Distribución laboral queda fuera de V1.

## 4.15 Estado de conectividad

```text
Internet caído:
```

```text
OFFLINE
```

```text
Operando localmente
```

```text
Edge caído:
```

```text
LOCAL CONNECTION LOST
```

La segunda condición deberá mostrarse como crítica.

## 4.16 Confirmación visual

Una UI MUST NOT mostrar una mutación como confirmada hasta recibir ACK del Edge.

# 5. Arquitectura de Impresión Local

## 5.1 Principio

Toda impresión será un PrintJob durable.

```text
Request
```

```text
→ Routing
```

```text
→ PrintJob
```

```text
→ Persistent Queue
```

```text
→ Print Worker
```

```text
→ PrinterAdapter
```

```text
→ Printer
```

## 5.2 PrintJob

```text
Campos conceptuales:
```

```text
print_job_id
```

```text
station_id
```

```text
printer_id
```

```text
order_id
```

```text
round_id
```

```text
parent_job_id
```

```text
job_type
```

```text
payload
```

```text
status
```

```text
attempts
```

```text
timestamps
```

```text
last_error
```

## 5.3 Estados

```text
PENDING
```

```text
SENDING
```

```text
DELIVERED
```

```text
CONFIRMED
```

```text
FAILED
```

```text
UNKNOWN
```

```text
CANCELLED
```

DELIVERED MUST NOT implicar necesariamente impresión física confirmada.

## 5.4 Tipos

```text
KITCHEN_TICKET
```

```text
BAR_TICKET
```

```text
STATION_TICKET
```

```text
CUSTOMER_RECEIPT
```

```text
PRECHECK
```

```text
CANCELLATION_TICKET
```

```text
REPRINT
```

```text
CASH_REPORT
```

## 5.5 Estaciones vs hardware

Productos se asignan a estaciones lógicas.

```text
COCINA
```

```text
BARRA
```

```text
POSTRES
```

```text
CAJA
```

Las estaciones se asignan posteriormente a impresoras físicas.

## 5.6 ESC/POS

Estándar principal.

```text
V1 priorizará:
```

```text
TCP/IP ESC/POS
```

La arquitectura utilizará:

PrinterAdapter

```text
para soportar:
```

```text
TCP_ESC_POS
```

```text
USB_ESC_POS
```

```text
SYSTEM_DRIVER future
```

Compatibilidad será amplia, no universalmente garantizada para cualquier modelo.

La integración de impresoras será capability-based. Cuando el hardware lo permita, el adapter MAY reportar estados como ONLINE, OFFLINE, PAPER_OUT, COVER_OPEN, ERROR o UNKNOWN; en modelos con menor telemetría deberá representar explícitamente la incertidumbre. Los perfiles de impresora también deberán contemplar diferencias de encoding/code pages y MUST NOT asumir UTF-8 universal.

## 5.7 Reintentos

Fallos anteriores a transmisión permiten retry seguro.

Transmisiones de resultado incierto deberán producir estado UNKNOWN o equivalente para evitar duplicados físicos.

## 5.8 Fallback

Cada estación podrá tener impresora secundaria.

Fallback deberá permanecer ligado al mismo trabajo lógico y quedar auditado.

Si la impresora principal y todos los fallbacks fallan, el PrintJob MUST conservarse, registrar el error y permanecer recuperable/reintentable. La UI deberá mostrar una alerta persistente; si la estación también usa KDS, este MAY continuar como respaldo operacional. La comanda MUST NOT desaparecer por un fallo físico de impresión.

## 5.9 Reinicios

Print Queue deberá sobrevivir reinicios.

Un job encontrado en SENDING tras crash deberá tratarse como potencialmente incierto.

## 5.10 Reimpresión

Será un nuevo PrintJob ligado mediante parent_job_id.

```text
Deberá indicar claramente:
```

```text
REPRINT
```

y respetar RBAC/Audit.

## 5.11 Cancelaciones

```text
Ítems enviados y posteriormente cancelados podrán generar:
```

```text
CANCELLATION_TICKET
```

además de actualizar KDS.

## 5.12 Templates

V1 incluirá templates configurables básicos para:

Cocina.

Barra.

Recibo.

Precuenta.

Cancelación.

Reportes.

Sin diseñador visual avanzado.

Soportará 58 mm y 80 mm.

## 5.13 Cajón

Abrir cajón será una operación independiente.

```text
Pago efectivo:
```

```text
PAYMENT_COMPLETED
```

```text
→ OPEN_CASH_DRAWER
```

Precuenta MUST NOT abrir cajón.

## 5.14 Pago vs impresión

Un recibo fallido MUST NOT revertir un Payment completado.

## 5.15 Datáfonos

V1 no integra directamente terminales bancarias.

El voucher continuará siendo generado por el hardware del banco.

# 6. Seguridad, RBAC, PINs y Audit Log

## 6.1 Principio

```text
Toda operación deberá asociarse a:
```

```text
User
```

```text
+
```

```text
Device
```

```text
+
```

```text
Session
```

```text
+
```

```text
Permission
```

cuando corresponda.

## 6.2 RBAC

```text
Modelo:
```

```text
USER
```

```text
→ ROLE
```

```text
→ PERMISSIONS
```

La autorización MUST basarse en permisos concretos, no en condicionales rígidos por nombre del rol.

## 6.3 Roles V1

```text
OWNER
```

```text
MANAGER
```

```text
CASHIER
```

```text
WAITER
```

```text
KITCHEN
```

Roles personalizados quedan fuera del constructor funcional de V1.

## 6.4 Usuarios

Cada trabajador deberá tener identidad individual.

Cuentas compartidas SHOULD NOT utilizarse como práctica normal.

Usuarios históricos no deberán eliminarse físicamente.

Los usuarios tendrán al menos estado ACTIVE o DISABLED. Un usuario DISABLED MUST NOT iniciar nuevas sesiones, pero su identidad histórica MUST conservarse en Orders, Payments, CashSessions y Audit Log.

## 6.5 Credenciales

Separar:

Primary Credential

Operational PIN

Contraseñas y PINs MUST almacenarse mediante hashing adecuado.

## 6.6 Autorización superior

```text
Cuando un usuario no tenga permiso:
```

```text
Request
```

```text
→ Authorization PIN
```

```text
→ Verify authorizing user
```

```text
→ Verify permission
```

```text
→ Execute one operation
```

La sesión activa MUST permanecer perteneciendo al solicitante.

Una autorización será de un solo uso.

## 6.7 OWNER

OWNER podrá autorizar cualquier acción permitida por la plataforma.

```text
MUST NOT existir:
```

```text
BYPASS_AUDIT
```

Toda acción sensible realizada por OWNER deberá conservar:

Motivo.

Usuario.

Dispositivo.

Timestamp.

Entidad.

Monto cuando corresponda.

## 6.8 Descuentos, Comps y Voids

```text
Son conceptos distintos:
```

```text
DISCOUNT
```

```text
COMP
```

```text
VOID
```

Los permisos de descuento podrán incorporar límites porcentuales.

## 6.9 Sesiones

```text
Cada sesión deberá registrar:
```

```text
session_id
```

```text
user_id
```

```text
device_id
```

```text
location_id
```

```text
login_at
```

```text
last_activity
```

Timeout configurable por tipo de dispositivo.

## 6.10 Autenticación Offline

Edge deberá disponer localmente de:

Usuarios.

Roles.

Permisos.

Hashes.

Estados.

Cloud no participa en cada login.

Usuarios locales con permisos adecuados MAY crear o deshabilitar usuarios y administrar credenciales operativas mientras Cloud esté inaccesible; estos cambios se sincronizarán posteriormente. Licencias, Entitlements, identidad contractual del OWNER y cambios de Tenant permanecen bajo autoridad Cloud/Super Admin.

## 6.11 Audit Log

Separado del Event Log.

### Event Log

Describe:

Qué ocurrió.

### Audit Log

Describe:

Quién, por qué y bajo qué autorización.

## 6.12 Audit Entry

```text
Conceptualmente:
```

```text
audit_id
```

```text
tenant_id
```

```text
location_id
```

```text
device_id
```

```text
session_id
```

```text
requesting_user_id
```

```text
authorizing_user_id
```

```text
action
```

```text
entity_type
```

```text
entity_id
```

```text
before
```

```text
after
```

```text
reason_code
```

```text
reason_comment
```

```text
amount_affected
```

```text
timestamp
```

```text
event_id
```

```text
previous_hash
```

```text
entry_hash
```

## 6.13 Append-only

```text
Audit Log MUST funcionar conceptualmente como:
```

```text
INSERT
```

```text
INSERT
```

```text
INSERT
```

No deberá existir edición/borrado normal de registros históricos.

## 6.14 Integridad

La implementación deberá preparar hash chaining o mecanismo equivalente para detectar manipulación.

No requiere blockchain.

Audit Log SHOULD sincronizarse a Cloud preservando identidad, orden, hashes y relaciones relevantes. La copia Cloud actuará como segunda capa de conservación y no deberá permitir que una eliminación local posterior borre silenciosamente el historial central ya recibido.

## 6.15 Device Pairing

Todo dispositivo deberá tener identidad independiente.

```text
Proceso:
```

```text
Device
```

```text
→ Pairing Request
```

```text
→ Authorized Approval
```

```text
→ Device Credential
```

Un dispositivo podrá revocarse.

## 6.16 API Security

Ocultar botones no constituye seguridad.

Edge MUST validar en cada mutación:

Device.

Session.

User.

Permission.

Entity state.

Authorization.

Business rules.

## 6.17 Fuerza bruta

PIN/login deberá disponer de:

Rate limiting.

Delays.

Temporary lock.

Audit/alerts.

# 7. Modelo de Órdenes y Ciclo de Vida

## 7.1 Order

Será la raíz transaccional central.

```text
Order
```

```text
├── OrderItems[]
```

```text
├── Rounds[]
```

```text
├── Payments[]
```

```text
├── Adjustments[]
```

```text
├── Tips
```

```text
├── TableAssignments[]
```

```text
└── Events[]
```

## 7.2 Identidad

```text
order_id      = UUID v7
```

```text
order_number  = human-readable per Location
```

order_number será generado localmente por Edge dentro del Location y MUST funcionar sin Internet. No necesita ser globalmente único entre Locations porque order_id proporciona la identidad distribuida global.

## 7.3 order_type

```text
COUNTER
```

```text
TABLE
```

```text
TAKEOUT
```

## 7.4 order_channel

Separado de order_type.

```text
V1:
```

```text
POS
```

```text
WAITER
```

```text
Preparado para:
```

```text
ONLINE_WEB
```

```text
DELIVERY_AGGREGATOR
```

```text
API
```

## 7.5 Estados

```text
OPEN
```

```text
CLOSED
```

```text
CANCELLED
```

Otros estados operativos deberán derivarse de componentes.

## 7.6 OrderItem

```text
MUST capturar snapshot al momento de creación:
```

```text
product_id
```

```text
product_name
```

```text
unit_price
```

```text
taxes
```

```text
modifiers
```

```text
modifier_prices
```

```text
station
```

Cambios posteriores del catálogo MUST NOT modificar el snapshot.

Esto aplica incluso mientras el ítem continúe DRAFT.

La edición explícita de configuración de un DRAFT se modela como un comando versionado sobre `Order`: conserva `OrderItem.id`, vuelve a validar Product/modifiers actuales en Edge y reemplaza atómicamente el snapshot y `special_instructions`. Una actualización del catálogo aislada nunca dispara este comando ni reescribe DRAFTs automáticamente.

`OrderItem` MAY contener `special_instructions: string | null` como estado transaccional propio, separado de `ProductSnapshot`, Product y Modifier. Edge normaliza whitespace exterior, convierte vacío a `null`, limita V1 a 500 caracteres y no incorpora este campo a ningún cálculo financiero.

La mutación versionada pertenece al Aggregate Root: DRAFT permite crear, editar o eliminar el texto; SENT lo congela. Persistencia MUST rehidratarlo desde `order_items` sin consultar ni modificar el catálogo.

## 7.7 Estados de ítem

```text
send_status:
```

```text
DRAFT
```

```text
SENT
```

```text
prep_status:
```

```text
PENDING
```

```text
PREPARING
```

```text
READY
```

## 7.8 Sent Finality

Un SENT OrderItem MUST NOT desaparecer ni modificarse silenciosamente.

La finalidad SENT incluye `special_instructions`, que MUST conservarse históricamente y no admite edición silenciosa.

## 7.9 Rounds

Todo ítem SENT pertenece a exactamente una Round.

Una ronda puede dividirse entre múltiples estaciones.

## 7.10 Mesas

Table es un recurso físico.

```text
Table
```

```text
→ Active Order
```

Una mesa MUST NOT pertenecer a dos Orders activas en V1.

Una Order MAY ocupar múltiples mesas.

## 7.11 Merge

MERGE_ORDERS queda fuera de V1.

## 7.12 Transferencias

```text
V1 permitirá:
```

```text
MOVE_ORDER
```

```text
TRANSFER_ORDER
```

sin recrear la transacción.

## 7.13 Pagos parciales

Una Order puede permanecer OPEN después de pagos parciales y recibir nuevos productos.

```text
PAYMENT_COMPLETED y ORDER_CLOSED representan hechos distintos. Un Payment registra un movimiento financiero; cerrar la Order congela la transacción comercial. Una Order MAY permanecer OPEN con balance_due = 0 hasta que se ejecute explícitamente su cierre.
```

## 7.14 Cierre

```text
Como mínimo:
```

```text
balance_due = 0
```

y demás validaciones operativas deben cumplirse. En V1 una Order MUST NOT pasar de OPEN a CLOSED mientras contenga cualquier OrderItem con `sendStatus = DRAFT`.

Para cerrar, `balance_due` MUST ser 0 y no MUST existir ningún OrderItem DRAFT. Los DRAFT deberán enviarse explícitamente mediante el flujo DRAFT → SENT / Round, o eliminarse mediante el flujo permitido mientras continúen siendo DRAFT.

`closeOrder` MUST NOT convertir DRAFT → SENT, eliminar DRAFT, producir una Round, emitir un evento de KDS ni provocar ninguna consecuencia implícita de envío.

CLOSED congela el estado comercial.

MUST NOT existir reapertura directa en V1.

## 7.15 Snapshot de cierre

Al cerrar deberá conservarse:

subtotal

```text
discounts
```

```text
comps
```

```text
taxes
```

```text
tips
```

```text
total
```

```text
payments
```

```text
change
```

```text
closed_at
```

```text
closed_by
```

## 7.16 Idempotencia

Toda mutación crítica deberá incorporar command_id.

Reintentar el mismo comando MUST producir un solo efecto comercial.

## 7.17 Versionado

Cada Order mantendrá:

version

para control de concurrencia.

## 7.18 Invariantes de Order

> **INVARIANT:** INV-01

> **INVARIANT:** Every Order MUST belong to exactly one Tenant and Location.

> **INVARIANT:** INV-02

> **INVARIANT:** Every Order MUST have one globally unique immutable order_id.

> **INVARIANT:** INV-03

> **INVARIANT:** CLOSED and CANCELLED Orders MUST NOT be edited through normal operations.

> **INVARIANT:** INV-04

> **INVARIANT:** Historical prices MUST NOT be recalculated from the current catalog.

> **INVARIANT:** INV-05

> **INVARIANT:** A SENT item MUST NOT disappear or be overwritten silently.

> **INVARIANT:** INV-06

> **INVARIANT:** Every SENT item MUST belong to exactly one Round.

> **INVARIANT:** INV-07

> **INVARIANT:** Every Payment MUST belong to an Order.

> **INVARIANT:** INV-08

> **INVARIANT:** Financial calculations MUST be authoritative in Edge.

> **INVARIANT:** INV-09

> **INVARIANT:** A TABLE Order MAY reference multiple physical tables.

> **INVARIANT:** INV-10

> **INVARIANT:** A physical table MUST NOT belong to multiple active Orders in V1.

> **INVARIANT:** INV-11

> **INVARIANT:** Retrying the same command MUST NOT duplicate its business effect.

> **INVARIANT:** INV-12

> **INVARIANT:** Order history MUST be preserved through non-destructive events.

> **INVARIANT:** INV-13

> **INVARIANT:** Cloud MUST NOT be required to create, modify, pay or close a local Order.

> **INVARIANT:** INV-14

> **INVARIANT:** Sensitive mutations MUST comply with RBAC/Audit.

> **INVARIANT:** INV-15

> **INVARIANT:** Closing an Order MUST freeze its commercial state.

> **INVARIANT:** ORDER-CLOSE-INV

> **INVARIANT:** An Order MUST NOT transition from OPEN to CLOSED unless `balance_due = 0` and no OrderItem has `sendStatus = DRAFT`.

# 8. Pagos, Propinas y Conciliación

## 8.1 Payment

```text
Payment
```

```text
├── payment_id
```

```text
├── order_id
```

```text
├── cash_session_id
```

```text
├── method
```

```text
├── amount_applied
```

```text
├── tip_amount
```

```text
├── status
```

```text
├── external_reference
```

```text
└── metadata
```

## 8.2 Métodos V1

```text
CASH
```

```text
CARD
```

```text
OTHER
```

## 8.3 Estados

```text
PENDING
```

```text
COMPLETED
```

```text
VOIDED
```

Un Payment completado MUST NOT eliminarse físicamente.

## 8.4 Múltiples pagos

Una Order MAY contener múltiples Payments.

Pagos mixtos y parciales forman parte de V1.

## 8.5 Efectivo

```text
Separar:
```

```text
cash_tendered
```

```text
amount_applied
```

```text
change_given
```

Ejemplo:

Due:      $470

Tendered: $500

Applied:  $470

Change:    $30

El ingreso de venta es $470.

## 8.6 Tarjeta

V1 mantiene datáfono externo.

```text
El operador:
```

```text
ComanView amount
```

```text
→ terminal bank
```

```text
→ voucher
```

```text
→ confirm Payment in ComanView
```

external_reference será opcional.

## 8.7 Propina

```text
Configurable:
```

```text
tips_enabled
```

```text
Métodos:
```

```text
PERCENTAGE
```

```text
FIXED_AMOUNT
```

La propina MUST mantenerse separada del consumo.

```text
amount_applied = sale
```

```text
tip_amount = tip
```

```text
charged_total = amount_applied + tip_amount
```

## 8.8 Split Bill

V1:

Por ítems.

Partes iguales.

No generará Orders nuevas automáticamente.

Cuando un OrderItem represente múltiples unidades, V1 MAY dividirlas por unidades enteras —por ejemplo, 3 tacos como 2 + 1—. V1 MUST NOT requerir propiedad financiera fraccionaria arbitraria de un producto unitario.

## 8.9 VOID

```text
Un Payment completado puede pasar:
```

```text
COMPLETED
```

```text
→ VOIDED
```

mediante flujo autorizado.

Full REFUND queda fuera de V1.

Para CARD en V1, cambiar un Payment a VOIDED dentro de ComanView MUST NOT interpretarse como una reversión bancaria automática. El operador deberá realizar o confirmar la operación correspondiente en la terminal externa cuando aplique.

## 8.10 Idempotencia y atomicidad

```text
Payment MUST ser:
```

```text
IDEMPOTENT
```

```text
ATOMIC
```

La creación del pago y su efecto financiero deberán persistirse en una misma transacción lógica.

## 8.11 Dinero

MUST utilizarse aritmética exacta.

Permitido:

integer minor units

exact decimal

Prohibido como fuente financiera:

binary float

double

## 8.12 Moneda

Una Order V1 utiliza una sola moneda configurada por Location.

## 8.13 Invariantes PAY

> **INVARIANT:** PAY-INV-01

> **INVARIANT:** Every Payment MUST belong to exactly one Order.

> **INVARIANT:** PAY-INV-02

> **INVARIANT:** Completed Payments MUST NOT be physically deleted.

> **INVARIANT:** PAY-INV-03

> **INVARIANT:** Only COMPLETED Payments affect paid_amount.

> **INVARIANT:** PAY-INV-04

> **INVARIANT:** VOIDED Payments MUST preserve history.

> **INVARIANT:** PAY-INV-05

> **INVARIANT:** Edge MUST be authoritative over balances.

> **INVARIANT:** PAY-INV-06

> **INVARIANT:** Retries MUST be idempotent.

> **INVARIANT:** PAY-INV-07

> **INVARIANT:** Tips MUST remain distinguishable from sales.

> **INVARIANT:** PAY-INV-08

> **INVARIANT:** Cash tendered MUST NOT be treated as sale revenue.

> **INVARIANT:** PAY-INV-09

> **INVARIANT:** Change MUST NOT alter sale revenue.

> **INVARIANT:** PAY-INV-10

> **INVARIANT:** Payments MUST NOT exceed the authoritative sale balance.

> **INVARIANT:** PAY-INV-11

> **INVARIANT:** Money calculations MUST use exact arithmetic.

> **INVARIANT:** PAY-INV-12

> **INVARIANT:** Completed Payments MUST persist atomically with their financial effect.

> **INVARIANT:** PAY-INV-13

> **INVARIANT:** Multiple Payments MAY belong to one Order.

> **INVARIANT:** PAY-INV-14

> **INVARIANT:** OPEN Orders MAY receive new items after partial payment.

> **INVARIANT:** PAY-INV-15

> **INVARIANT:** Cloud MUST NOT be required for local payments.

# 9. Caja, Turnos, Corte X y Corte Z

## 9.1 Modelo

```text
CashRegister
```

```text
└── CashSession
```

```text
├── opening_float
```

```text
├── Payments[]
```

```text
├── CashMovements[]
```

```text
└── ClosingSnapshot
```

## 9.2 Estados

```text
OPEN
```

```text
CLOSED
```

Una CashRegister MUST NOT tener más de una sesión OPEN.

Todo Payment registrado desde el POS MUST pertenecer a una CashSession OPEN.

## 9.3 opening_float

Toda apertura requiere fondo inicial explícito.

MUST NOT considerarse venta.

MUST NOT heredarse automáticamente de la sesión anterior.

## 9.4 Usuarios

Múltiples usuarios MAY operar una misma CashSession.

Cada operación conserva su identidad.

## 9.5 CashMovement

```text
CASH_IN
```

```text
CASH_OUT
```

Todo movimiento requiere:

Amount.

Reason.

User.

Timestamp.

RBAC.

Audit.

## 9.6 Expected Cash

```text
Edge calculará:
```

```text
expected_cash =
```

```text
opening_float
```

```text
+ cash_sales
```

```text
+ cash_in
```

```text
- cash_out
```

```text
- cash_refunds
```

Los Payments CARD no afectan efectivo físico.

## 9.7 Corte X

Informativo.

Repetible.

No cierra sesión.

No modifica estado.

## 9.8 Corte Z

```text
Flujo:
```

```text
OPEN
```

```text
→ validate
```

```text
→ counted_cash
```

```text
→ calculate difference
```

```text
→ ClosingSnapshot
```

```text
→ CLOSED
```

Una mesa u Order abierta MUST NOT bloquear automáticamente el Corte Z de una CashSession. Sí deberán bloquear el cierre las operaciones financieras incompletas o inconsistentes asociadas a esa sesión, como un Payment PENDING.

## 9.9 Blind Cash Count

```text
Configurable:
```

```text
blind_cash_count = true | false
```

Si está activo, expected_cash no se muestra antes de confirmar counted_cash.

## 9.10 Diferencias

difference =

counted_cash - expected_cash

Una diferencia MUST NOT bloquear automáticamente el cierre.

Podrán existir tolerancias y autorización superior.

## 9.11 business_date

Cada CashSession tendrá una fecha operativa independiente del cambio calendario.

```text
Ejemplo:
```

```text
business_date = Aug 12
```

```text
opened_at = Aug 12 18:00
```

```text
closed_at = Aug 13 03:00
```

MUST NOT existir cierre automático a medianoche.

## 9.12 ClosingSnapshot

```text
Deberá conservar:
```

```text
opening_float
```

```text
sales_by_method
```

```text
tips_by_method
```

```text
cash_in
```

```text
cash_out
```

```text
expected_cash
```

```text
counted_cash
```

```text
difference
```

```text
voids
```

```text
discounts
```

```text
comps
```

```text
opened_at
```

```text
closed_at
```

```text
opened_by
```

```text
closed_by
```

Será inmutable.

## 9.13 Invariantes CASH

> **INVARIANT:** CASH-INV-01

> **INVARIANT:** Every CashSession MUST belong to exactly one CashRegister and Location.

> **INVARIANT:** CASH-INV-02

> **INVARIANT:** A CashRegister MUST NOT have more than one OPEN CashSession.

> **INVARIANT:** CASH-INV-03

> **INVARIANT:** A CLOSED CashSession MUST NOT return to OPEN.

> **INVARIANT:** CASH-INV-04

> **INVARIANT:** Opening float MUST NOT be sales revenue.

> **INVARIANT:** CASH-INV-05

> **INVARIANT:** Every CashMovement MUST belong to one CashSession.

> **INVARIANT:** CASH-INV-06

> **INVARIANT:** CASH_IN/CASH_OUT MUST preserve user, amount, reason and timestamp.

> **INVARIANT:** CASH-INV-07

> **INVARIANT:** Manual drawer opening MUST NOT create a CashMovement automatically.

> **INVARIANT:** CASH-INV-08

> **INVARIANT:** CARD Payments MUST NOT affect physical expected cash.

> **INVARIANT:** CASH-INV-09

> **INVARIANT:** Expected cash MUST be calculated by Edge.

> **INVARIANT:** CASH-INV-10

> **INVARIANT:** Difference MUST be calculated by Edge.

> **INVARIANT:** CASH-INV-11

> **INVARIANT:** Cash differences MUST NOT be discarded silently.

> **INVARIANT:** CASH-INV-12

> **INVARIANT:** X Reports MUST NOT close or alter the session.

> **INVARIANT:** CASH-INV-13

> **INVARIANT:** A Z Report MUST correspond to one final session closure.

> **INVARIANT:** CASH-INV-14

> **INVARIANT:** Closing MUST be atomic and idempotent.

> **INVARIANT:** CASH-INV-15

> **INVARIANT:** Print failure MUST NOT invalidate Z.

> **INVARIANT:** CASH-INV-16

> **INVARIANT:** Edge restart MUST NOT close an OPEN CashSession.

> **INVARIANT:** CASH-INV-17

> **INVARIANT:** Cloud MUST NOT be required for local cash operation.

> **INVARIANT:** CASH-INV-18

> **INVARIANT:** business_date MUST represent the operational day.

# 10. Catálogo, Productos, Precios, Impuestos y Modificadores

## 10.1 Product

```text
Conceptualmente:
```

```text
Product
```

```text
├── product_id
```

```text
├── category_id
```

```text
├── name
```

```text
├── description
```

```text
├── product_type
```

```text
├── base_price
```

```text
├── tax_profile_id
```

```text
├── station_id
```

```text
├── active
```

```text
├── available
```

```text
├── display_order
```

```text
├── sku
```

```text
├── barcode
```

```text
└── ModifierGroups[]
```

## 10.2 active vs available

```text
active = false
```

Producto comercialmente retirado.

```text
active = true
```

```text
available = false
```

Producto temporalmente agotado.

Estos conceptos MUST permanecer separados.

```text
Si un Product cambia a available = false después de haber sido agregado a una Order, un ítem SENT no cambia y un ítem DRAFT MUST NOT eliminarse automáticamente. El DRAFT conserva su snapshot; la UI MAY advertir la nueva indisponibilidad y cualquier resolución deberá ser explícita.
```

## 10.3 Eliminación

Products históricamente utilizados MUST NOT eliminarse destructivamente.

## 10.4 Categorías

Un Product tendrá una categoría principal en V1.

Categorías y productos tendrán display_order.

## 10.5 Tipo

```text
V1 implementará:
```

```text
STANDARD
```

pero product_type será extensible.

## 10.6 Precio

base_price utilizará aritmética exacta.

Edge será autoridad del precio.

No habrá edición manual arbitraria del precio dentro de venta normal.

## 10.7 Snapshot inmediato

El momento de creación de OrderItem fija:

Precio.

Nombre.

Tax.

Modifiers.

Station.

Cambios posteriores de catálogo MUST NOT modificar ni DRAFT ni SENT existentes.

## 10.8 Modificadores

```text
ModifierGroup
```

```text
├── min_selections
```

```text
├── max_selections
```

```text
└── Modifiers[]
```

min/max serán la regla normativa.

## 10.9 Modifier

```text
modifier_id
```

```text
name
```

```text
default_price_delta
```

```text
active
```

```text
available
```

```text
display_order
```

Permitirá:

Precio positivo.

Precio cero.

Precio negativo.

Cantidad.

## 10.10 Reutilización

ModifierGroups MAY reutilizarse entre Products.

```text
Un modificador podrá tener:
```

```text
default_price_delta
```

```text
+
```

```text
price_delta_override per Product
```

## 10.11 Variantes

V1 no tendrá ProductVariant independiente.

Tamaños/opciones se modelarán mediante ModifierGroups obligatorios.

## 10.12 Estaciones

station_id MAY ser null.

Una vez un OrderItem es SENT, su routing destination queda congelado.

## 10.13 TaxProfile

```text
TaxProfile
```

```text
├── tax_profile_id
```

```text
├── name
```

```text
├── rate
```

```text
├── calculation_mode
```

```text
└── active
```

```text
Modos:
```

```text
TAX_INCLUDED
```

```text
TAX_ADDED
```

V1: un TaxProfile por Product.

Modifiers heredan tratamiento fiscal del producto.

## 10.14 Rounding

Política fiscal MUST ser:

centralized

deterministic

Edge-authoritative

## 10.15 Catálogo Offline

Usuarios autorizados MAY editar localmente:

Products.

Categories.

Prices.

Availability.

Modifiers.

Stations.

Taxes.

Los cambios se sincronizarán posteriormente.

## 10.16 Versionado

```text
Entidades/configuración mantendrán metadata equivalente a:
```

```text
version
```

```text
updated_at
```

```text
updated_by
```

No utilizar last write wins ciego para cambios sensibles.

## 10.17 Importante

Descuentos y comps pertenecen al dominio transaccional.

MUST NOT modificar Product.base_price.

## 10.18 Invariantes CAT

> **INVARIANT:** CAT-INV-01

> **INVARIANT:** Every Product MUST have an immutable global product_id.

> **INVARIANT:** CAT-INV-02

> **INVARIANT:** Historical OrderItems MUST NOT depend financially on current Product state.

> **INVARIANT:** CAT-INV-03

> **INVARIANT:** Price changes MUST NOT alter existing snapshots.

> **INVARIANT:** CAT-INV-04

> **INVARIANT:** Inactive Products MUST preserve historical references.

> **INVARIANT:** CAT-INV-05

> **INVARIANT:** Unavailable Products MUST NOT be normally added to new Orders.

> **INVARIANT:** CAT-INV-06

> **INVARIANT:** Active and availability MUST remain separate.

> **INVARIANT:** CAT-INV-07

> **INVARIANT:** Prices MUST be resolved by Edge.

> **INVARIANT:** CAT-INV-08

> **INVARIANT:** Catalog money MUST use exact arithmetic.

> **INVARIANT:** CAT-INV-09

> **INVARIANT:** Modifier selections MUST satisfy min/max rules.

> **INVARIANT:** CAT-INV-10

> **INVARIANT:** Modifier snapshots MUST remain historical.

> **INVARIANT:** CAT-INV-11

> **INVARIANT:** SENT routing MUST NOT change retroactively.

> **INVARIANT:** CAT-INV-12

> **INVARIANT:** Taxes MUST be deterministic and Edge-authoritative.

> **INVARIANT:** CAT-INV-13

> **INVARIANT:** Historical tax snapshots MUST NOT be recalculated.

> **INVARIANT:** CAT-INV-14

> **INVARIANT:** Price/tax changes MUST remain auditable.

> **INVARIANT:** CAT-INV-15

> **INVARIANT:** Catalog updates MUST NOT mutate transactional history.

> **INVARIANT:** CAT-INV-16

> **INVARIANT:** Products MAY exist without a preparation station.

> **INVARIANT:** CAT-INV-17

> **INVARIANT:** Cloud MUST NOT be required for authorized local catalog administration.

> **INVARIANT:** CAT-INV-18

> **INVARIANT:** Discounts/comps MUST NOT rewrite Product base prices.

# 11. Provisionamiento, Instalación, Backups y Recuperación

## 11.1 Edge Identity

```text
Cada Edge tendrá:
```

```text
edge_id
```

UUID v7 global e inmutable.

No dependerá de:

IP.

Hostname.

Hardware name.

MAC.

Filesystem path.

## 11.2 Estados

```text
UNPROVISIONED
```

```text
ACTIVE
```

```text
REVOKED
```

## 11.3 Provisionamiento

```text
Install
```

```text
→ Generate temporary provisioning request
```

```text
→ Super Admin approval
```

```text
→ Assign Tenant + Location
```

```text
→ Issue Edge credential
```

```text
→ Download config/license
```

```text
→ Bootstrap
```

```text
→ Health Check
```

```text
→ ACTIVE
```

El provisioning code será temporal y de un solo uso.

## 11.4 Servicio

Edge MUST:

Auto-start.

Ejecutarse como servicio supervisado.

Recuperarse tras reinicio.

No depender de inicio manual.

## 11.5 Separación local

Application

Configuration

Secrets

Database

Logs

Backups

Assets

deberán mantenerse conceptualmente separados.

## 11.6 Backups

```text
V1 requiere:
```

```text
Automatic Local Backup
```

```text
+
```

```text
Protected Cloud/External Backup
```

**Regla:**

SYNC ≠ BACKUP

Los backups transferidos fuera del Edge MUST utilizar cifrado en tránsito, cifrado en almacenamiento e integridad verificable. Los backups locales SHOULD protegerse adicionalmente cuando sea viable. Las claves de protección MUST NOT incluirse dentro del propio backup de forma que anulen el cifrado.

## 11.7 Backup metadata

```text
backup_id
```

```text
tenant_id
```

```text
location_id
```

```text
edge_id
```

```text
created_at
```

```text
edge_version
```

```text
schema_version
```

```text
checksum
```

## 11.8 Consistencia

Un backup MUST ser consistente y restaurable.

No copiar DB activamente modificada de forma insegura.

## 11.9 Retención

Backups deberán rotarse automáticamente.

## 11.10 Restore

```text
Flujo:
```

```text
Validate backup
```

```text
→ Validate tenant/location
```

```text
→ Validate schema
```

```text
→ Safety backup
```

```text
→ Stop transactional processing
```

```text
→ Restore
```

```text
→ Run migrations
```

```text
→ Integrity check
```

```text
→ Health check
```

```text
→ Resume
```

La arquitectura SHOULD permitir recuperación Offline cuando exista un backup válido, pero MUST exigir una autorización de recuperación verificable localmente. Copiar un backup MUST NOT permitir clonar libremente una instalación productiva. Un Recovery Package MAY combinar Backup, Metadata, Integrity Proof y Recovery Authorization.

### 11.10.1 Implementación 1V

`BackupManager` usa `better-sqlite3 Database.backup()` bajo WAL. El artifact v1 contiene manifest no secreto y `database.enc`; el payload se cifra con una DEK aleatoria AES-256-GCM y la DEK se envuelve con una Recovery Key de 256 bits. El estado local de esa clave y el Security Floor se protege con DPAPI en Windows productivo; development/test exige un modo explícito.

El Security Floor externo contiene solamente binding de instalación, `recoveryEpoch`, máximas revisiones firmadas, sticky licensing, un Bloom filter acotado de Devices revocados y el journal mínimo de recovery. No contiene estado transaccional. Su ausencia ante una DB con schema 1V, o su corrupción, entra fail-closed en `RECOVERY_REQUIRED`; el archivo corrupto se preserva. Una DB legacy pre-1V con credencial Edge durable puede migrar una vez sin ser confundida con instalación nueva. Restore realiza verify/decrypt en staging, preserva DB/WAL/SHM anteriores, hace swap por fases durable, valida integridad y fusiona el floor monotónicamente. El Bloom filter es acotado y deliberadamente fail-closed: un falso positivo puede exigir re-pair de un Device, nunca reactivar uno revocado. En hardware replacement invalida documentos firmados del Edge origen y todos los Devices, credentials y sesiones restaurados; el nuevo Edge debe converger a sus documentos firmados y emparejar Devices de nuevo.

Sync identifica el orden local mediante `(edgeId, recoveryEpoch, localSequence)`; datos anteriores usan epoch `0`. Tras restore, eventos todavía no sincronizados se asignan al nuevo epoch conservando `eventId`, mientras historia y receipts Cloud anteriores permanecen intactos.

Todas las escrituras del Security Floor pasan por una primitive central: `mutate` transforma el estado
vigente bajo exclusión, y `save` compara el checksum de origen de la copia derivada con el estado vigente.
Ambas rechazan retrocesos de epoch, versiones, revisiones, sticky Licensing, revocaciones, binding y
Recovery Key/exportación. Una cola por ruta canónica y un lock entre procesos (`proper-lockfile`, lease
30 s con renovación cada 10 s) protegen lectura/modificación/escritura y recuperación de corrupción.
Un lock ocupado falla cerrado; uno abandonado permite reintento tras expirar. No se elimina manualmente
un lock activo. Una pérdida de lease detiene el escritor. El temporal de cada escritura es único y se
sincroniza antes del rename. No se agrega estado operacional ni se cambia el formato del artifact.
Los ACK demorados solo retiran el ACK exacto que confirmaron, sobre el floor más reciente.

La monotonicidad de Licensing está vinculada a la revisión firmada: una revisión inferior nunca es
current/efectiva; una igual no retira sticky state ni sustituye una decisión con hash distinto. Solo
`applySignedLicenseTransition` puede cambiar sticky state con una revisión estrictamente superior,
tras verificar Ed25519/kid, binding exacto y vigencia dentro del lock. Esto permite la reactivación
firmada aprobada en 1U; no hace TERMINATED/SUSPENDED irreversibles ante una nueva decisión válida.
`mutate`/`save` genéricos no pueden retirar restricciones aunque aumenten la revisión, ni crear,
reemplazar o borrar la evidencia de esa decisión. Epoch, revocaciones, binding y claves mantienen
su monotonicidad absoluta.

El floor añade únicamente `licenseDecision` (revisión, hash del envelope, restricción asociada) y
`licensePending` (revisión/hash de preparación). El documento completo permanece en SQLite. Bajo el
mismo lock, el escritor registra preparación, guarda el documento no-current, confirma la decisión
del floor y activa SQLite sin awaits intermedios. Una preparación interrumpida no concede autoridad:
su documento no-current no aumenta máximos mediante merge y puede reintentarse por pull. Si la decisión
ya se confirmó, startup autentica el envelope preparado con ese hash y termina idempotentemente su
activación antes de validar el estado productivo. No se requiere Cloud para terminar esa ventana.
Un snapshot antiguo puede carecer del documento autorizado: se invalida lo anterior, se conserva el
floor y no se concede FULL; una recepción posterior válida puede recuperar el documento exacto.
Restore/merge jamás equivale a una nueva decisión comercial firmada ni revive sticky de una revisión
obsoleta por encima de una reactivación ya autorizada y persistida.

EffectiveCapabilities/Orders consultan una vista autenticada del floor, no solo `is_current`. Esa vista
se invalida cuando cambia el archivo protegido (también por otro proceso); sin una vista vigente no
se concede una licencia current. Los ACK de LICENSE no confirman revisiones inferiores al floor ni
hashes distintos de su decisión. Las garantías existentes de turno y operaciones protegidas siguen
siendo excepciones operacionales explícitas, no reactivaciones comerciales.

En restore, primero se confirma SQLite con sus revocaciones y restricciones; después se fusiona y
persiste el floor externo, conservando el journal `SWAPPED`/`VALIDATING`. Solo entonces se retira el
journal y se declara `NORMAL`/`COMPLETED`. Una interrupción entre esas etapas repite SQL y fusión
idempotentes al reiniciar. Esto incluye las revocaciones de todos los Devices/credentials/sesiones de
hardware replacement antes de que el guard productivo valide SQLite contra el floor, sin debilitarlo.

El journal de restore incluye el SHA-256 del staging verificado y sincronizado. Solo esa copia aislada
se consolida a SQLite sin WAL antes de calcular el hash; la DB fuente no se altera. Las fases conservan
estos significados: `PREPARING` registra staging/evidencia e intención, y puede haber preservación parcial
de la DB anterior; `QUIESCED` confirma que terminó esa preservación, no que ocurrió el swap; `SWAPPED`
confirma que la DB activa coincide con el snapshot esperado; `VALIDATING` permite iniciar o reintentar la
transacción sobre esa DB. Ningún catch adelanta la fase durable: conserva journal y `RECOVERY_REQUIRED`.
Ante un crash entre rename físico y `SWAPPED`, solo se reconoce el swap si falta staging y la DB activa
coincide con el hash esperado, sin sidecars ambiguos y con schema/integridad válidos. Si existen ambas DB,
faltan evidencias o no coinciden, falla cerrado; nunca sustituye una evidencia preservada.

La transacción de validación inserta `RECOVERY_VALIDATED` en el Audit Log existente usando `recoveryId`
como identificador único. El comprobante vincula recovery, backup, hash del staging, binding y epoch, y se
confirma atómicamente con epoch/revocaciones/Licensing. Un retry `VALIDATING` exige el snapshot pristine
o ese comprobante exacto con binding/epoch consistentes; no basta el nombre de la fase. Después vuelve a
validar schema/integridad y fusionar el floor antes de retirar el journal y publicar `NORMAL`/`COMPLETED`.
No duplica el comprobante al reiniciar. Journals previos sin hash y estados ambiguos permanecen en
`RECOVERY_REQUIRED`; requieren volver a preparar un restore verificado, no asumir que el swap ocurrió.
Un error posterior a guardar el journal tampoco elimina staging aún referenciado o cuya referencia no
puede comprobarse. No se agregan tablas/migrations, datos operacionales al floor ni otro protocolo de backup.

Production Readiness requiere recuperación `NORMAL`, backup LOCAL y OFF_DEVICE verificados vigentes
(máximo 4 horas; el externo debe corresponder al destino configurado), Recovery Key disponible y
exportada, y worker no `DEGRADED`. Un worker `RUNNING` puede seguir protegido por copias vigentes.
`BACKUP_PROTECTION_INCOMPLETE` nunca agrega `READY` a producción; la falta de protección no bloquea
por sí sola la operación offline ni cambia las demás condiciones operacionales de readiness.

La superficie de emergencia se expone solo en loopback cuando una instalación establecida no puede abrir SQLite. Requiere el artifact y la Recovery Key; hardware replacement requiere además `RecoveryAuthorization` Cloud firmada y single-use. Una barrera común impide solapar backup y preparación de restore; el safety backup interno es best-effort y nunca permite carreras con otra copia. Las operaciones normales de backup/restore permanecen RBAC-protected y auditadas. Cloud object storage no se simula en 1V: solo `LOCAL` y filesystem `OFF_DEVICE` están implementados. `OFF_DEVICE` significa un path configurado distinto; V1 no afirma que esté en otro disco físico porque el filesystem no ofrece una comprobación portable y fiable para todos los destinos.

## 11.11 Migrations

### Upgrade productivo local 1U → 1V

El lifecycle de `buildApp` ejecuta `prepareProductionRecoveryUpgrade` después de resolver un restore
pendiente y **antes de `initDatabase`, repositorios, workers o listen**. El entry point real activa esta
comprobación; `NODE_ENV=production` también la exige al invocar `buildApp` directamente. No usa Cloud,
`dev:prepare`, provisioning nuevo ni el laboratorio. El servicio 1U debe estar detenido y el nuevo servicio
debe conservar la misma cuenta Windows/DPAPI, rutas de DB, credenciales y Security Floor. El paquete
desplegado debe incluir los SQL históricos de `migrations/edge` junto con los módulos compilados.

El preflight abre SQLite con `readonly` y `fileMustExist`, exige `integrity_check` y `foreign_key_check`,
y compara el schema real con el producido por los SQL inmutables 0000–0013/0014. No basta encontrar
`recovery_epoch`. Los esquemas parciales, desconocidos o personalizados requieren diagnóstico, no una
migration tentativa. El `user_version` legacy 0 se acepta solo junto con ese schema conocido; la
transición registra 14. Comprueba identidad ACTIVE, binding Edge/Tenant/Location real, credencial durable
activa correspondiente al `credential_id` y epoch legacy 0. Un floor previo se conserva y fusiona, nunca
se reemplaza por el contenido más antiguo de SQLite.

Antes de mutar SQLite se toma un writer lock (`BEGIN IMMEDIATE`) y se revalida el estado. Se persiste
un `upgradeJournal` pequeño en el Security Floor DPAPI: versión del journal, schemas 13/14, ruta de DB,
identificador/ruta del safety snapshot, hash de 0014 y fase `PREPARING`/`SNAPSHOT_READY`. La escritura
del floor sincroniza el archivo temporal antes del rename. Este journal no contiene datos operacionales.
La Recovery Key queda protegida antes de crear el snapshot. Una conexión readonly separada utiliza
`Database.backup()` para obtener un snapshot WAL consistente, que reutiliza el artifact AES-256-GCM de
1V con schema 13, bajo `.upgrade-1v` junto a la DB. Se verifica antes de autorizar la migration. El fallo
de snapshot aborta; no hay copia ingenua de DB/WAL ni fallback a una DB vacía. Estos artifacts de schema
13 son evidencia de mantenimiento, no se aceptan en los endpoints normales de restore 1V; no se borran
automáticamente. No se deben eliminar floor, journal o snapshots para intentar desbloquear el startup.

El runner ejecuta el SQL incremental 0014 existente dentro de una transacción, sin alterar migrations
históricas. El harness comparte el ejecutor SQL sobre sus copias aisladas, pero conserva su propio
preflight de laboratorio. El commit SQLite precede a la inicialización final del floor; `SNAPSHOT_READY`
permite reconocer exactamente la ventana post-migration/pre-floor. Al reintentar se autentica el
snapshot y se comparan sus columnas operacionales legacy con la DB, en streaming, sin guardar una
segunda base operacional en el floor. Se conservan IDs, Orders, Payments, Cash, Event Log y Audit.

La fusión toma máximos de signed revisions, sticky SUSPENDED/TERMINATED y revocaciones tanto del
snapshot como del floor externo y la DB vigente; propaga las restricciones más fuertes a Devices,
credentials, sesiones y documentos actuales. No incrementa el epoch por un upgrade: legacy permanece
en 0. Valida schema 14, integridad, binding, epoch, floor persistido, Licensing, revocaciones y estructuras
de repositorios 1V antes de retirar el journal y declarar `UPGRADE COMPLETED`. El floor registra
`minimumSchemaVersion=14`, que rechaza un rollback posterior a schema 13 incluso con epoch 0.

Un restart en `PREPARING` puede crear un nuevo snapshot; en `SNAPSHOT_READY` revalida la evidencia y
migra solo si todavía existe schema 13. Si ya existe schema 14 continúa la inicialización/verificación,
sin reaplicar 0014. Con journal retirado y floor válido, startup es idempotente. Missing/corrupt DB,
snapshot inválido, downgrade, binding incompatible, floor inválido o schema 14 sin floor ni journal
válido producen `RECOVERY_REQUIRED` y un código diagnóstico seguro, sin abrir repositorios operacionales.
Una interrupción con journal válido permite retry al reiniciar; un estado ambiguo requiere diagnóstico
local. Un FIRST_BOOT genuino no crea DB desde este mecanismo y sigue el provisioning existente.

Este lifecycle es independiente del medio de distribución del software. No implementa OTA ni 1W.

Todos los cambios de DB utilizarán migrations versionadas.

Modificación manual productiva de tablas MUST NOT ser procedimiento normal.

## 11.12 OTA y migration

```text
Actualización sensible:
```

```text
Pre-update backup
```

```text
→ install
```

```text
→ migrate
```

```text
→ health check
```

Rollback de aplicación MUST NOT asumir rollback automático del schema.

## 11.13 Corrupción

```text
Ante corrupción:
```

```text
DB INTEGRITY FAILURE
```

```text
→ RECOVERY_REQUIRED
```

MUST NOT:

Create empty DB automatically

La información existente deberá preservarse.

## 11.14 Edge replacement

V1 tendrá un único Edge primario por Location.

```text
Reemplazo:
```

```text
Old Edge → REVOKED
```

```text
New Edge → ACTIVE
```

No habrá active-active.

## 11.15 Diagnóstico

```text
Edge deberá poder generar:
```

```text
EXPORT_DIAGNOSTIC_PACKAGE
```

sin exponer secretos.

## 11.16 Installation Health Check

```text
Antes de Go Live:
```

```text
Edge = OK
```

```text
DB = OK
```

```text
License = valid
```

```text
Tenant/Location = assigned
```

```text
Catalog = ready
```

```text
Users = ready
```

```text
CashRegisters = configured
```

```text
Stations = configured
```

```text
Printers = tested
```

```text
Devices = paired
```

```text
Backup = initialized
```

```text
Sync = verified when available
```

Las operaciones de prueba deberán mantenerse separadas de producción. Un Test Mode o flujo equivalente MUST NOT contaminar ventas, Corte Z, analítica ni reportes financieros reales; pruebas específicas SHOULD preferir acciones como TEST_PRINTER o RUN_HEALTH_CHECK sin crear Orders comerciales.

## 11.17 Importación inicial

```text
V1 soportará:
```

```text
CSV
```

```text
XLSX
```

para catálogo.

```text
Flujo:
```

```text
Upload
```

```text
→ Parse
```

```text
→ Validate
```

```text
→ Preview errors
```

```text
→ Confirm
```

```text
→ Domain-valid import
```

La importación MUST NOT saltarse reglas de dominio.

## 11.18 Invariantes OPS

> **INVARIANT:** OPS-INV-01

> **INVARIANT:** Every Edge MUST have immutable edge_id.

> **INVARIANT:** OPS-INV-02

> **INVARIANT:** ACTIVE Edge MUST belong to exactly one Tenant and Location.

> **INVARIANT:** OPS-INV-03

> **INVARIANT:** Provisioning credentials MUST NOT be permanent reusable secrets.

> **INVARIANT:** OPS-INV-04

> **INVARIANT:** Edge MUST restart without manual startup.

> **INVARIANT:** OPS-INV-05

> **INVARIANT:** Transactional state MUST survive restart.

> **INVARIANT:** OPS-INV-06

> **INVARIANT:** Backups MUST be consistent/restorable.

> **INVARIANT:** OPS-INV-07

> **INVARIANT:** Sync MUST NOT be treated as Backup.

> **INVARIANT:** OPS-INV-08

> **INVARIANT:** Backup integrity MUST be validated before restore.

> **INVARIANT:** OPS-INV-09

> **INVARIANT:** Every backup MUST identify schema version.

> **INVARIANT:** OPS-INV-10

> **INVARIANT:** Schema changes MUST use versioned migrations.

> **INVARIANT:** OPS-INV-11

> **INVARIANT:** Restore MUST NOT overwrite production silently.

> **INVARIANT:** OPS-INV-12

> **INVARIANT:** DB corruption MUST NOT initialize empty production state.

> **INVARIANT:** OPS-INV-13

> **INVARIANT:** One primary Edge per Location in V1.

> **INVARIANT:** OPS-INV-14

> **INVARIANT:** Edge replacement MUST preserve Tenant/Location transactional identity.

> **INVARIANT:** OPS-INV-15

> **INVARIANT:** Cloud backup failure MUST NOT stop restaurant operation.

> **INVARIANT:** OPS-INV-16

> **INVARIANT:** Backups/logs MUST NOT expose authentication secrets.

> **INVARIANT:** OPS-INV-17

> **INVARIANT:** Production readiness MUST be verifiable.

> **INVARIANT:** OPS-INV-18

> **INVARIANT:** Application rollback MUST NOT assume schema rollback safety.

# 12. Arquitectura Técnica e Implementación

## 12.1 Estrategia general

ComanView será TypeScript-first.

Stack principal:

Language:

TypeScript

Runtime:

Node.js 24 LTS

No se introducirá Go, Rust u otro lenguaje en V1 salvo necesidad técnica medida y documentada.

La reutilización de:

Domain types.

Contracts.

Validation.

Events.

Money.

Permissions.

Sync definitions.

tiene prioridad sobre optimizaciones prematuras.

## 12.2 Arquitectura global

```text
INTERNET
```

```text
│
```

```text
┌───────────▼───────────┐
```

```text
│    COMANVIEW CLOUD    │
```

```text
│                       │
```

```text
│ Cloud API             │
```

```text
│ Sync Engine           │
```

```text
│ Control Plane         │
```

```text
│ Cloud Workers         │
```

```text
│ Public Storefront     │
```

```text
│ PostgreSQL            │
```

```text
│ Object Storage        │
```

```text
└───────────┬───────────┘
```

```text
│
```

```text
TLS
```

```text
│
```

```text
┌───────────▼───────────┐
```

```text
│      EDGE RUNTIME     │
```

```text
│                       │
```

```text
│ Fastify API           │
```

```text
│ SQLite                │
```

```text
│ Domain Engine         │
```

```text
│ WebSocket             │
```

```text
│ Sync Worker           │
```

```text
│ Print Worker          │
```

```text
│ Backup Worker         │
```

```text
└───────────┬───────────┘
```

```text
│
```

```text
LAN
```

```text
┌─────────────┼─────────────┐
```

```text
│             │             │
```

```text
POS          WAITER          KDS
```

```text
Storefront:
```

```text
Public Browser
```

```text
↓
```

```text
Cloud Storefront
```

```text
↓
```

```text
Published Catalog Projection
```

MUST NOT conectarse directamente al Edge.

## 12.3 Edge Runtime

### Runtime

Node.js 24 LTS

TypeScript

Fastify

Edge será un modular monolith.

MUST NOT fragmentarse inicialmente en microservicios locales.

## 12.4 Edge Database

SQLite

WAL mode

SQLite será la autoridad local transaccional.

No se utilizará LibSQL replication como sustituto del Sync Engine.

## 12.5 SQLite Driver

V1 utilizará inicialmente:

better-sqlite3

node:sqlite podrá reevaluarse cuando alcance el nivel de estabilidad requerido.

## 12.6 Database Layer

Drizzle

para:

Schemas.

Queries.

Migrations.

**Regla:**

Domain MUST NOT depend directly on Drizzle.

## 12.7 Runtime Validation

Zod

Los tipos TypeScript MUST NOT sustituir validación runtime.

Se validarán:

API inputs.

Sync payloads.

Imports.

Config.

Recovery metadata.

Cloud messages.

## 12.8 Domain Architecture

```text
Flujo recomendado:
```

```text
Transport
```

```text
→ Contract Validation
```

```text
→ Command/Application Service
```

```text
→ Domain
```

```text
→ Repository
```

```text
→ Transaction
```

```text
→ Database
```

```text
→ Events
```

```text
MUST NOT utilizarse:
```

```text
HTTP Route
```

```text
→ direct table mutation
```

para lógica de negocio.

## 12.9 Packages

```text
packages/domain MUST NOT depender de:
```

```text
Fastify
```

```text
React
```

```text
Drizzle
```

```text
SQLite
```

```text
PostgreSQL
```

```text
AWS
```

```text
Next.js
```

Contendrá:

Entities.

Value Objects.

Invariants.

Domain services.

Commands.

Domain errors.

Domain events.

## 12.10 Money

Representación estándar:

integer minor units

Se utilizará bigint cuando corresponda.

## 12.11 Edge Workers

Módulos asíncronos:

Print Worker

Sync Worker

Backup Worker

Maintenance Worker

OTA Worker

Las tareas simples podrán ejecutarse como loops internos.

Procesos separados se utilizarán únicamente cuando el aislamiento justifique la complejidad.

## 12.12 Local Queues

Edge MUST NOT requerir:

Redis

RabbitMQ

Kafka

Las colas durables se almacenarán en SQLite.

```text
Ejemplos:
```

```text
event_log
```

```text
print_jobs
```

```text
background_jobs
```

## 12.13 Device ↔ Edge Protocol

```text
Se utilizará:
```

```text
REST
```

```text
+
```

```text
WebSocket
```

REST:

Commands.

Queries.

WebSocket:

Order updates.

KDS updates.

Table changes.

Catalog changes.

Connectivity state.

No se utilizará gRPC para clientes browser en V1.

WebSocket MUST utilizarse como mecanismo de notificación, no como prueba de persistencia. El orden correcto será: Command → Edge validation → persistence → COMMIT → WebSocket notification. Un mensaje WebSocket por sí solo MUST NOT establecer éxito transaccional.

## 12.14 Client Applications

Framework:

React

Vite

TypeScript

```text
Apps:
```

```text
POS
```

```text
Waiter
```

```text
KDS
```

## 12.15 POS

Será aplicación web local/PWA servida desde Edge.

MUST NOT requerir Electron/Tauri en V1 salvo necesidad nativa futura demostrada.

## 12.16 Waiter

Será PWA responsive.

No React Native en V1.

## 12.17 KDS

Será cliente React/Vite servido localmente.

Podrá ejecutarse en:

PC.

Tablet.

Browser kiosk.

Mini PC.

## 12.18 Client State

```text
Preferencia:
```

```text
TanStack Query
```

```text
+
```

```text
local UI state
```

Zustand MAY utilizarse cuando exista estado global real.

Redux MUST NOT introducirse por defecto sin necesidad.

## 12.19 Client Offline

Offline-First significa Cloud Offline.

Los dispositivos no serán autoridades transaccionales independientes.

Si un cliente pierde Edge:

NO authoritative transaction confirmation

Puede conservar UI/cache/drafts temporales, pero MUST NOT afirmar que la venta fue persistida.

## 12.20 Printer Architecture

```text
Print Manager
```

```text
→ PrinterAdapter
```

Adapters:

TcpEscPosAdapter

UsbEscPosAdapter

SystemDriverAdapter future

La lógica de Order MUST NOT depender de librerías específicas de hardware.

## 12.21 Cloud Runtime

Node.js 24 LTS

TypeScript

Fastify

```text
Cloud será inicialmente:
```

```text
Modular Monolith
```

```text
+
```

```text
Background Workers
```

No microservices-first.

## 12.22 Cloud Database

PostgreSQL 18

Se fijará una major soportada; patch/minor exactos vivirán en manifests/deployment.

PostgreSQL almacenará:

Tenants.

Locations.

Edge identities.

Licenses.

Entitlements.

Sync inbox.

Consolidated operational data.

Audit copies.

Telemetry metadata.

Storefront projections.

## 12.23 Transactional Outbox / Inbox

### Edge

Event Log actuará como Transactional Outbox.

Business mutation y evento sincronizable deberán persistirse atómicamente.

### Cloud

```text
Existirá una Inbox idempotente:
```

```text
event_id UNIQUE
```

```text
edge_id
```

```text
tenant_id
```

```text
location_id
```

```text
payload
```

```text
received_at
```

```text
processing_status
```

ACK podrá emitirse después de aceptación durable, antes del procesamiento completo de proyecciones.

## 12.24 Cloud Jobs

Inicialmente podrán utilizar almacenamiento PostgreSQL-backed.

Servicios externos como SQS MAY incorporarse cuando volumen/operación lo justifique.

Kafka no forma parte de V1.

## 12.25 Infraestructura Cloud

```text
Proveedor primario:
```

```text
AWS
```

```text
Arquitectura inicial:
```

```text
Route 53
```

```text
CloudFront
```

```text
ALB
```

```text
ECS Fargate
```

```text
RDS PostgreSQL
```

```text
S3
```

```text
CloudWatch
```

```text
Secrets Manager
```

Kubernetes MUST NOT ser requisito V1.

## 12.26 Object Storage

S3 almacenará:

Backups.

Catalog images.

Logos.

OTA packages.

Diagnostic packages.

Exports.

PostgreSQL MUST NOT utilizarse como almacenamiento arbitrario de blobs grandes.

## 12.27 Public Storefront

Stack:

Next.js 16

React

TypeScript

Objetivos:

SSR.

SEO.

Metadata.

Fast public rendering.

Public routing.

Caching.

## 12.28 Published Catalog Projection

El Storefront MUST consultar únicamente un read model público.

Ejemplo:

PublicLocation

PublicCategory

PublicProduct

```text
PublicProduct podrá contener:
```

```text
product_id
```

```text
location_id
```

```text
name
```

```text
description
```

```text
price
```

```text
image
```

```text
category
```

```text
available
```

```text
display_order
```

MUST NOT exponer:

Internal cost.

Margin.

Supplier data.

Audit information.

Internal station config.

Secrets.

## 12.29 Storefront Consistency

```text
Flujo:
```

```text
Edge catalog mutation
```

```text
→ Sync
```

```text
→ Cloud Inbox
```

```text
→ Projection Worker
```

```text
→ Public Projection
```

```text
→ Cache invalidation
```

```text
→ Storefront
```

Con Edge online, la propagación SHOULD ser rápida.

Con Edge offline:

Storefront =

last synchronized public state

El modelo es eventually consistent.

## 12.30 Storefront V1

Incluye:

Landing.

Business info.

Contact.

Location.

Hours.

Menu.

Categories.

Products.

Availability.

QR.

Public slug.

Dominios personalizados quedarán arquitectónicamente preparados.

## 12.31 Storefront V2

```text
Preparar futura entrada:
```

```text
ONLINE_WEB
```

pero V1 MUST NOT aceptar Orders públicas.

```text
Futuro flujo:
```

```text
Customer
```

```text
→ Storefront
```

```text
→ Online Order Gateway
```

```text
→ Cloud durable queue
```

```text
→ Edge
```

```text
→ Create Order
```

La web pública MUST NOT escribir directamente a la DB operacional ni comunicarse directamente con Edge.

## 12.32 order_channel

Separado formalmente de order_type.

```text
V1:
```

```text
POS
```

```text
WAITER
```

```text
Futuro:
```

```text
ONLINE_WEB
```

```text
DELIVERY_AGGREGATOR
```

```text
API
```

```text
Ejemplo futuro:
```

```text
order_type = TAKEOUT
```

```text
order_channel = ONLINE_WEB
```

## 12.33 UUID

Nuevas entidades utilizarán por defecto:

UUID v7

salvo necesidad documentada.

Sustituye la propuesta previa de UUID v4.

## 12.34 Monorepo

Herramientas:

pnpm workspaces

Turborepo

```text
Estructura:
```

```text
comanview/
```

```text
│
```

```text
├── apps/
```

```text
│   ├── edge/
```

```text
│   ├── cloud-api/
```

```text
│   ├── cloud-worker/
```

```text
│   ├── super-admin/
```

```text
│   ├── storefront/
```

```text
│   ├── pos/
```

```text
│   ├── waiter/
```

```text
│   └── kds/
```

```text
│
```

```text
├── packages/
```

```text
│   ├── domain/
```

```text
│   ├── contracts/
```

```text
│   ├── database/
```

```text
│   ├── auth/
```

```text
│   ├── money/
```

```text
│   ├── sync/
```

```text
│   ├── printing/
```

```text
│   ├── ui/
```

```text
│   ├── client-sdk/
```

```text
│   ├── config/
```

```text
│   └── testing/
```

```text
│
```

```text
├── migrations/
```

```text
│   ├── edge/
```

```text
│   └── cloud/
```

```text
│
```

```text
└── tooling/
```

## 12.35 Contracts

packages/contracts contendrá representaciones de frontera:

Requests

Responses

Commands

Sync envelopes

WebSocket messages

Schemas

Domain objects MUST NOT exponerse automáticamente como contratos públicos.

Los errores de dominio deberán exponerse mediante códigos semánticos estables y estructurados —por ejemplo ORDER_ALREADY_CLOSED, PRODUCT_UNAVAILABLE o PAYMENT_EXCEEDS_BALANCE—. Los clientes MUST NOT depender del texto humano de message para ejecutar lógica.

## 12.36 Testing

### Unit

Vitest

Especialmente:

Money.

Taxes.

Order invariants.

Payments.

Cash.

Permissions.

Sync conflicts.

### Integration

Contra bases reales:

SQLite

PostgreSQL

### E2E

Playwright

## 12.37 Escenarios críticos obligatorios

La suite deberá cubrir:

Duplicate Payment retry

Duplicate Sync Event

Concurrent Payment

Concurrent Order mutation

Edge restart with OPEN CashSession

Edge restart with Print Jobs

Internet disconnect/reconnect

Catalog mutation during OPEN Order

Failed Z printing

Failed migration

Backup restore

DB corruption detection

License suspension during active shift

Storefront stale state during Edge offline

## 12.38 Database Migrations

Se utilizarán migrations Drizzle + revisión explícita.

Separadas:

edge migrations

cloud migrations

Migrations productivas MUST revisarse antes de despliegue.

## 12.39 Edge OS V1

Primer sistema operativo oficialmente soportado:

Windows 11 x64

Linux MAY añadirse posteriormente para Edge dedicado.

No se intentará soportar simultáneamente Windows/Linux/macOS en V1.

## 12.40 Edge Packaging

Distribución autocontenida.

El cliente MUST NOT instalar Node manualmente.

```text
Paquete conceptual:
```

```text
Installer
```

```text
├── pinned Node runtime
```

```text
├── Edge application
```

```text
├── SQLite native dependency
```

```text
├── POS/Waiter/KDS assets
```

```text
├── Service registration
```

```text
└── Updater
```

No depender inicialmente de Node Single Executable Applications si su estabilidad no es suficiente.

## 12.41 Docker

```text
Cloud:
```

```text
Docker/OCI = YES
```

```text
Edge:
```

```text
Docker = NO
```

V1 MUST NOT requerir Docker Desktop/daemon en restaurantes.

## 12.42 CI/CD

Plataforma:

GitHub Actions

PR:

install

lint

typecheck

unit tests

integration tests

build

```text
Main/Staging:
```

```text
checks
```

```text
→ build images
```

```text
→ deploy staging
```

```text
→ migrations
```

```text
→ E2E
```

```text
Edge Release:
```

```text
build
```

```text
→ integration tests
```

```text
→ sign
```

```text
→ publish INTERNAL
```

```text
→ PILOT
```

```text
→ STABLE
```

Producción MUST NOT desplegarse manualmente desde estaciones de desarrollo.

## 12.43 Environments

local

test

staging

production

```text
Release channels Edge:
```

```text
INTERNAL
```

```text
PILOT
```

```text
STABLE
```

Environment y release channel son conceptos distintos.

## 12.44 Observabilidad

Cloud:

structured logs

metrics

traces

alerts

Edge:

structured local logs

health metrics

sanitized telemetry

OpenTelemetry será el estándar conceptual preferido para instrumentación cuando corresponda.

Requests y operaciones relevantes SHOULD incorporar correlation identifiers como request_id, command_id, event_id y print_job_id para reconstruir una operación entre componentes y logs.

El modelo temporal MUST distinguir UTC timestamp, Location timezone y business_date. Cada Location deberá disponer de una timezone explícita; business_date MUST NOT derivarse únicamente desde UTC ni desde el cambio de medianoche del servidor.

## 12.45 Versiones

El Documento Maestro fijará únicamente versiones arquitectónicamente relevantes:

Node.js 24 LTS

Next.js 16

PostgreSQL 18

MUST NOT fijar patch/minor específicos.

Versiones exactas vivirán en:

package.json.

Lockfile.

Docker images.

Infrastructure manifests.

Release metadata.

## 12.46 Tecnologías explícitamente excluidas de V1

No introducir sin una necesidad técnica validada:

Kubernetes

Kafka

Redis on Edge

RabbitMQ on Edge

Docker on Edge

Electron

React Native

Go services

Rust services

gRPC browser protocol

GraphQL local API

LibSQL replication as Sync Engine

Active-active Edge

Cloud-dependent POS

La exclusión responde a control de complejidad, no a incapacidad técnica.

# 13. Límites explícitos de V1

Aunque el Documento Maestro tiene 12 secciones funcionales/técnicas, el siguiente conjunto constituye el límite normativo del alcance V1.

## Incluido

Core.

POS.

Cash.

Catalog.

Tables.

Waiter.

KDS.

Printing.

Offline operation.

Edge/Cloud sync.

Super Admin.

Licensing.

OTA.

Security.

Audit.

Backups/recovery.

CSV/XLSX onboarding.

Public Storefront read-only.

QR menu.

## Fuera de V1

Inventory.

Recipes.

Suppliers.

Electronic invoicing.

Multi-location operation.

Online orders.

Delivery.

Integrated payment terminals.

Refund domain completo.

Customer accounts.

Loyalty.

Gift cards.

Promotions engine.

Happy Hour.

Dynamic pricing.

Complex combos.

Advanced product variants.

Employee payroll.

Tip distribution.

Banking reconciliation.

Active-active Edge.

Automatic failover.

Kubernetes.

Advanced fiscal engines.

El coding agent MUST NOT implementar estos elementos como parte de V1 salvo instrucción posterior explícita.

# 14. Reglas de Implementación para Coding Agents

## 14.1 Fuente de verdad

El agente MUST tratar este documento como especificación de dominio.

Si el código existente contradice una invariante:

La invariante tiene prioridad, salvo instrucción explícita de modificar la especificación.

## 14.2 No inferir comportamiento financiero

Nunca improvisar reglas para:

Money.

Payments.

Tips.

Discounts.

Cash.

Taxes.

Closing.

Si una regla no está definida, deberá marcarse como decisión pendiente antes de introducir comportamiento financiero nuevo.

## 14.3 No saltarse Domain Layer

Las rutas/API MUST NOT implementar directamente reglas de negocio complejas.

```text
Preferencia:
```

```text
Transport
```

```text
→ Application
```

```text
→ Domain
```

```text
→ Repository
```

## 14.4 No duplicar autoridad

Solo Edge es autoridad operacional local.

Clientes MUST NOT mantener una segunda verdad transaccional independiente.

Cloud MUST NOT participar en operaciones locales críticas.

## 14.5 No borrar historia

Operaciones financieras/transaccionales deben utilizar:

Estados.

Events.

Voids.

Compensating transactions.

No destructive overwrite/delete.

## 14.6 Idempotencia por defecto

Toda operación que pueda duplicarse por:

Retry.

Timeout.

Reconnection.

Double click.

Network failure.

SHOULD diseñarse idempotente.

Para operaciones financieras/transaccionales críticas, idempotencia es obligatoria.

## 14.7 Atomicidad

```text
Toda operación que modifique:
```

```text
Business state
```

```text
+
```

```text
Financial state
```

```text
+
```

```text
Event Log
```

deberá hacerlo dentro de una frontera transaccional consistente.

## 14.8 Seguridad

Nunca confiar únicamente en frontend.

Toda mutación deberá validarse en Edge/Cloud según autoridad correspondiente.

## 14.9 Exactitud monetaria

Está prohibido introducir float/double como fuente autoritativa de dinero.

## 14.10 No sobre-ingeniería preventiva

No introducir:

Servicios distribuidos.

Brokers.

Bases adicionales.

Lenguajes nuevos.

Frameworks redundantes.

sin un problema medido o requisito explícito.

# 15. Arquitectura V1 Resumida

```text
┌────────────────────────┐
```

```text
│    COMANVIEW CLOUD     │
```

```text
│                        │
```

```text
│ Node.js / Fastify      │
```

```text
│ PostgreSQL             │
```

```text
│ Sync Inbox             │
```

```text
│ Super Admin            │
```

```text
│ Licensing              │
```

```text
│ OTA                    │
```

```text
│ Telemetry              │
```

```text
│ Storefront Projection  │
```

```text
│ Next.js Storefront     │
```

```text
└───────────┬────────────┘
```

```text
│
```

```text
TLS
```

```text
│
```

```text
┌───────────▼────────────┐
```

```text
│     COMANVIEW EDGE     │
```

```text
│                        │
```

```text
│ Node.js / Fastify      │
```

```text
│ SQLite WAL             │
```

```text
│ Domain Engine          │
```

```text
│ Event/Outbox           │
```

```text
│ Audit                  │
```

```text
│ Sync Worker            │
```

```text
│ Print Manager          │
```

```text
│ Backup Engine          │
```

```text
│ License Manager        │
```

```text
└───────────┬────────────┘
```

```text
│
```

```text
LAN
```

```text
┌──────────────────────┼─────────────────────┐
```

```text
│                      │                     │
```

```text
┌───▼───┐             ┌────▼────┐           ┌────▼────┐
```

```text
│  POS  │             │ Waiter  │           │   KDS   │
```

```text
│ React │             │ React   │           │ React   │
```

```text
└───────┘             └─────────┘           └─────────┘
```

```text
│
```

```text
┌─────▼──────┐
```

```text
│ Print Jobs │
```

```text
│  ESC/POS   │
```

```text
└────────────┘
```

```text
Public:
```

```text
Customer Browser
```

```text
↓
```

```text
CloudFront
```

```text
↓
```

```text
Next.js Storefront
```

```text
↓
```

```text
Published Catalog Projection
```

```text
MUST NOT existir:
```

```text
Public Internet
```

```text
→ Restaurant Edge
```

# 16. Regla Maestra del Sistema

Toda la arquitectura de ComanView deberá preservar simultáneamente cuatro propiedades:

**El restaurante puede seguir operando cuando Internet falla.**

**Una operación confirmada nunca debe perderse o duplicarse silenciosamente.**

**El historial financiero y operacional nunca debe reescribirse para ocultar lo que ocurrió.**

**La complejidad Cloud o administrativa nunca debe convertirse en una dependencia crítica para vender, preparar, imprimir o cobrar localmente.**

Estas propiedades tienen prioridad sobre decisiones de implementación secundarias.

## 16.1 Device Pairing e Installation Readiness (Fase 1U)

La identidad operacional se valida como `Device proof + User PIN → local Session`; `deviceId` por sí
solo nunca autoriza. El primer Device requiere una autorización Ed25519 Cloud de tipo propio ligada
al pairing exacto, mientras los Devices posteriores se aprueban localmente mediante RBAC y LKG.
Revocation invalida credential y sesiones de forma atómica, sin borrar historia.

`REVOKED` es terminal. Un cliente que conserva la credential histórica solo puede obtener la señal
`DEVICE_REPAIR_REQUIRED` después de demostrar esa credential contra su hash revocado. La señal
autoriza exclusivamente una rotación local compare-and-replace hacia un nuevo `deviceId` UUIDv7 y
una nueva credential, seguida por el pairing normal con un único retry. El Device histórico nunca
se reactiva; conocer solo su `deviceId` o recibir `DEVICE_ALREADY_REGISTERED` no autoriza rotación.

Los límites firmados por tipo son `POS/WAITER/KDS: integer | null`. Un documento legacy sin límites
conserva Devices existentes pero bloquea nuevos pairings. La identidad browser vive en IndexedDB;
clonado de perfil y XSS same-origin son limitaciones conocidas de V1.

Installation Readiness se deriva del estado durable y se mantiene separado de `/health`. En 1U Backup
permanecía `PENDING_1V`; desde 1V se deriva de artifacts `VERIFIED`, antigüedad, destino off-device y
evidencia de exportación de Recovery Key. La ausencia de esas protecciones mantiene Production Readiness
en `NOT_READY`/degradado sin bloquear la operación. El procedimiento y threat model de Device Pairing
permanecen en `docs/Development_Device_Pairing.md`.
