<!--
ComanView Master PRD
Authoritative product and architecture specification for the repository.
Generated from the audited/corrected Master Technical Specification.
Do not replace domain rules with implementation convenience.
-->

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
Plan
+
Entitlements
+
Feature Flags
+
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
ENTITLEMENT:
KDS = enabled
```

```text
FEATURE FLAGS:
kds.enabled = true
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
Cloud
│
Internet
│
Edge
│
LAN
├── POS
├── Waiter
├── KDS
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
Current State
+
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
ITEM_ADDED
ITEM_VOIDED
PAYMENT_COMPLETED
```

Incorrecto como mecanismo principal:

"Replace entire Table 4 state"

## 2.6 Identidades

Las entidades sincronizables utilizarán identificadores globales.

```text
Como mínimo:
tenant_id
location_id
edge_id
device_id
user_id
order_id
order_item_id
payment_id
event_id
```

El estándar técnico será UUID v7 según Sección 12.

## 2.7 Secuencia temporal

El reloj del dispositivo no será autoridad.

```text
Edge deberá asignar:
edge_received_at
edge_committed_at
local_sequence
```

Los timestamps del cliente podrán conservarse únicamente como metadata.

## 2.8 Sync Queue / Transactional Outbox

Los eventos sincronizables deberán persistirse durablemente antes de intentar transmisión.

```text
Estados conceptuales:
PENDING
SYNCING
SYNCED
FAILED
```

Edge MUST conservar eventos pendientes tras reinicio.

## 2.9 Sincronización Edge → Cloud

```text
Flujo:
Pending Events
↓
Batch
↓
Cloud Sync API
↓
Validate
↓
Idempotency
↓
Durable Persist
↓
ACK
↓
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
Push
+
Periodic Pull
+
config_version
```

El Push MUST NOT ser el único mecanismo.

Toda configuración Cloud validada que sea necesaria para operar —incluyendo licencia, Entitlements, Feature Flags y políticas aplicables— MUST persistirse localmente. Durante una desconexión, Edge utilizará la última versión local válida y MUST NOT consultar Cloud para cada decisión operacional.

## 2.13 Heartbeat

```text
Edge enviará información como:
edge_id
version
last_sync
pending_events
health
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
license_id
tenant_id
location_id
plan
entitlements
device_limits
issued_at
expires_at
grace_until
license_status
config_version
signature
```

La clave privada de firma MUST permanecer únicamente en infraestructura ComanView.

Edge MUST poseer únicamente el material necesario para verificar la autenticidad de una licencia firmada. La capacidad de firmar, emitir o modificar criptográficamente licencias válidas MUST permanecer exclusivamente en infraestructura Cloud controlada por ComanView.

## 3.3 Estados

```text
ACTIVE
PAST_DUE
GRACE_PERIOD
SUSPENDED
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
License = SUSPENDED
CashSession = CLOSED
```

```text
MUST bloquearse:
OPEN_NEW_CASH_SESSION
```

hasta reactivación válida.

## 3.5 Reactivación temporal

Soporte podrá emitir una autorización temporal:

Firmada/verificable.

Limitada en tiempo.

Ligada a Tenant/Location.

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
REFRESH_LICENSE
REFRESH_CONFIG
RETRY_SYNC
RESTART_EDGE_SERVICE
RUN_HEALTH_CHECK
TEST_PRINTER
DOWNLOAD_DIAGNOSTIC_LOGS
CHECK_FOR_UPDATE
INSTALL_UPDATE
```

MUST NOT existir ejecución arbitraria de comandos del sistema operativo desde Super Admin.

## 3.9 OTA

```text
Canales:
INTERNAL
PILOT
STABLE
```

```text
Flujo:
Publish
→ INTERNAL
→ PILOT
→ gradual rollout
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
POS
Waiter
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
Products
→ Modifiers
→ Review
→ Pay
→ Payment Method
→ Tip
→ Confirm
→ Ticket
```

## 4.4 Tipos de Order

```text
COUNTER
TABLE
TAKEOUT
```

Se definen normativamente en Sección 7.

## 4.5 Mesas

```text
V1 utilizará:
Zones
+
Configurable Grid
```

No habrá editor arquitectónico drag-and-drop avanzado.

```text
Estados visuales podrán representar:
FREE
OPEN
READY
PAYMENT_REQUESTED
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
Categories
→ Products
→ Order
```

Misma funcionalidad, layout responsive.

## 4.7 Draft vs Sent

```text
Sección 7 define:
DRAFT
SENT
```

Un ítem SENT ya produjo consecuencias operativas y requiere flujo explícito para modificación/cancelación.

## 4.8 Rounds

Cada acción SEND genera una Round.

Una Order puede contener múltiples rondas.

## 4.9 KDS

```text
Estados:
PENDING
PREPARING
READY
```

Los tickets podrán dividirse por estación.

Los thresholds de tiempo serán configurables por estación.

## 4.10 Salida por estación

```text
KDS
PRINTER
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
OFFLINE
Operando localmente
```

```text
Edge caído:
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
→ Routing
→ PrintJob
→ Persistent Queue
→ Print Worker
→ PrinterAdapter
→ Printer
```

## 5.2 PrintJob

```text
Campos conceptuales:
print_job_id
station_id
printer_id
order_id
round_id
parent_job_id
job_type
payload
status
attempts
timestamps
last_error
```

## 5.3 Estados

```text
PENDING
SENDING
DELIVERED
CONFIRMED
FAILED
UNKNOWN
CANCELLED
```

DELIVERED MUST NOT implicar necesariamente impresión física confirmada.

## 5.4 Tipos

```text
KITCHEN_TICKET
BAR_TICKET
STATION_TICKET
CUSTOMER_RECEIPT
PRECHECK
CANCELLATION_TICKET
REPRINT
CASH_REPORT
```

## 5.5 Estaciones vs hardware

Productos se asignan a estaciones lógicas.

```text
COCINA
BARRA
POSTRES
CAJA
```

Las estaciones se asignan posteriormente a impresoras físicas.

## 5.6 ESC/POS

Estándar principal.

```text
V1 priorizará:
TCP/IP ESC/POS
```

La arquitectura utilizará:

PrinterAdapter

```text
para soportar:
TCP_ESC_POS
USB_ESC_POS
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
REPRINT
```

y respetar RBAC/Audit.

## 5.11 Cancelaciones

```text
Ítems enviados y posteriormente cancelados podrán generar:
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
PAYMENT_COMPLETED
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
User
+
Device
+
Session
+
Permission
```

cuando corresponda.

## 6.2 RBAC

```text
Modelo:
USER
→ ROLE
→ PERMISSIONS
```

La autorización MUST basarse en permisos concretos, no en condicionales rígidos por nombre del rol.

## 6.3 Roles V1

```text
OWNER
MANAGER
CASHIER
WAITER
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
Request
→ Authorization PIN
→ Verify authorizing user
→ Verify permission
→ Execute one operation
```

La sesión activa MUST permanecer perteneciendo al solicitante.

Una autorización será de un solo uso.

## 6.7 OWNER

OWNER podrá autorizar cualquier acción permitida por la plataforma.

```text
MUST NOT existir:
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
DISCOUNT
COMP
VOID
```

Los permisos de descuento podrán incorporar límites porcentuales.

## 6.9 Sesiones

```text
Cada sesión deberá registrar:
session_id
user_id
device_id
location_id
login_at
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
audit_id
tenant_id
location_id
device_id
session_id
requesting_user_id
authorizing_user_id
action
entity_type
entity_id
before
after
reason_code
reason_comment
amount_affected
timestamp
event_id
previous_hash
entry_hash
```

## 6.13 Append-only

```text
Audit Log MUST funcionar conceptualmente como:
INSERT
INSERT
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
Device
→ Pairing Request
→ Authorized Approval
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
├── OrderItems[]
├── Rounds[]
├── Payments[]
├── Adjustments[]
├── Tips
├── TableAssignments[]
└── Events[]
```

## 7.2 Identidad

```text
order_id      = UUID v7
order_number  = human-readable per Location
```

order_number será generado localmente por Edge dentro del Location y MUST funcionar sin Internet. No necesita ser globalmente único entre Locations porque order_id proporciona la identidad distribuida global.

## 7.3 order_type

```text
COUNTER
TABLE
TAKEOUT
```

## 7.4 order_channel

Separado de order_type.

```text
V1:
POS
WAITER
```

```text
Preparado para:
ONLINE_WEB
DELIVERY_AGGREGATOR
API
```

## 7.5 Estados

```text
OPEN
CLOSED
CANCELLED
```

Otros estados operativos deberán derivarse de componentes.

## 7.6 OrderItem

```text
MUST capturar snapshot al momento de creación:
product_id
product_name
unit_price
taxes
modifiers
modifier_prices
station
```

Cambios posteriores del catálogo MUST NOT modificar el snapshot.

Esto aplica incluso mientras el ítem continúe DRAFT.

Un operador MAY editar explícitamente la configuración de un `OrderItem` DRAFT. Esa acción MUST conservar la identidad del ítem y hacer que Edge valide el Product y modifiers actuales, resuelva precios autoritativos y reemplace el snapshot de ese DRAFT. Los cambios del catálogo por sí solos MUST NOT ejecutar este reemplazo ni actualizar DRAFTs automáticamente.

Cada `OrderItem` MAY mantener `special_instructions` como texto plano transaccional separado del `ProductSnapshot`, del catálogo y de los modificadores. Edge MUST normalizar whitespace exterior; texto vacío MUST persistirse como `null`; el máximo V1 será 500 caracteres. Este campo MUST NOT afectar precio, impuestos, subtotal ni total.

Mientras el ítem sea DRAFT, `special_instructions` MAY crearse, editarse o eliminarse explícitamente. Al pasar a SENT queda congelado junto con la historia operativa del ítem y MUST NOT modificarse mediante el flujo normal.

## 7.7 Estados de ítem

```text
send_status:
DRAFT
SENT
```

```text
prep_status:
PENDING
PREPARING
READY
```

## 7.8 Sent Finality

Un SENT OrderItem MUST NOT desaparecer ni modificarse silenciosamente.

Esto incluye sus `special_instructions`: el envío conserva el texto histórico exacto y cualquier cambio posterior requerirá un flujo explícito futuro, no una edición silenciosa.

## 7.9 Rounds

Todo ítem SENT pertenece a exactamente una Round.

Una ronda puede dividirse entre múltiples estaciones.

## 7.10 Mesas

Table es un recurso físico.

```text
Table
→ Active Order
```

Una mesa MUST NOT pertenecer a dos Orders activas en V1.

Una Order MAY ocupar múltiples mesas.

## 7.11 Merge

MERGE_ORDERS queda fuera de V1.

## 7.12 Transferencias

```text
V1 permitirá:
MOVE_ORDER
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
comps
taxes
tips
total
payments
change
closed_at
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
├── payment_id
├── order_id
├── cash_session_id
├── method
├── amount_applied
├── tip_amount
├── status
├── external_reference
└── metadata
```

## 8.2 Métodos V1

```text
CASH
CARD
OTHER
```

## 8.3 Estados

```text
PENDING
COMPLETED
VOIDED
```

Un Payment completado MUST NOT eliminarse físicamente.

## 8.4 Múltiples pagos

Una Order MAY contener múltiples Payments.

Pagos mixtos y parciales forman parte de V1.

## 8.5 Efectivo

```text
Separar:
cash_tendered
amount_applied
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
ComanView amount
→ terminal bank
→ voucher
→ confirm Payment in ComanView
```

external_reference será opcional.

## 8.7 Propina

```text
Configurable:
tips_enabled
```

```text
Métodos:
PERCENTAGE
FIXED_AMOUNT
REMAINDER
```

La propina MUST mantenerse separada del consumo.

`REMAINDER` representa la intención de conservar como propina el excedente de efectivo que
normalmente sería cambio. En V1 solo aplica a `CASH`, exige que `amount_applied` liquide el
`balance_due` autoritativo completo y MUST ser calculado por Edge:

```text
tip_amount = cash_tendered - amount_applied
change_given = 0
```

Si `cash_tendered = amount_applied`, `tip_amount = 0`. Si `cash_tendered < amount_applied`, el
Payment MUST ser rechazado. `REMAINDER` MUST NOT aplicarse a CARD ni a Payments parciales.

```text
amount_applied = sale
tip_amount = tip
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
COMPLETED
→ VOIDED
```

mediante flujo autorizado.

Full REFUND queda fuera de V1.

Para CARD en V1, cambiar un Payment a VOIDED dentro de ComanView MUST NOT interpretarse como una reversión bancaria automática. El operador deberá realizar o confirmar la operación correspondiente en la terminal externa cuando aplique.

## 8.10 Idempotencia y atomicidad

```text
Payment MUST ser:
IDEMPOTENT
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
└── CashSession
├── opening_float
├── Payments[]
├── CashMovements[]
└── ClosingSnapshot
```

## 9.2 Estados

```text
OPEN
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
expected_cash =
opening_float
+ cash_sales
+ cash_in
- cash_out
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
OPEN
→ validate
→ counted_cash
→ calculate difference
→ ClosingSnapshot
→ CLOSED
```

Una mesa u Order abierta MUST NOT bloquear automáticamente el Corte Z de una CashSession. Sí deberán bloquear el cierre las operaciones financieras incompletas o inconsistentes asociadas a esa sesión, como un Payment PENDING.

## 9.9 Blind Cash Count

```text
Configurable:
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
business_date = Aug 12
```

```text
opened_at = Aug 12 18:00
closed_at = Aug 13 03:00
```

MUST NOT existir cierre automático a medianoche.

## 9.12 ClosingSnapshot

```text
Deberá conservar:
opening_float
sales_by_method
tips_by_method
cash_in
cash_out
expected_cash
counted_cash
difference
voids
discounts
comps
opened_at
closed_at
opened_by
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
Product
├── product_id
├── category_id
├── name
├── description
├── product_type
├── base_price
├── tax_profile_id
├── station_id
├── active
├── available
├── display_order
├── sku
├── barcode
└── ModifierGroups[]
```

## 10.2 active vs available

```text
active = false
```

Producto comercialmente retirado.

```text
active = true
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
├── min_selections
├── max_selections
└── Modifiers[]
```

min/max serán la regla normativa.

## 10.9 Modifier

```text
modifier_id
name
default_price_delta
active
available
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
default_price_delta
+
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
├── tax_profile_id
├── name
├── rate
├── calculation_mode
└── active
```

```text
Modos:
TAX_INCLUDED
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
version
updated_at
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
ACTIVE
REVOKED
```

## 11.3 Provisionamiento

```text
Install
→ Generate temporary provisioning request
→ Super Admin approval
→ Assign Tenant + Location
→ Issue Edge credential
→ Download config/license
→ Bootstrap
→ Health Check
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
Automatic Local Backup
+
Protected Cloud/External Backup
```

**Regla:**

SYNC ≠ BACKUP

Los backups transferidos fuera del Edge MUST utilizar cifrado en tránsito, cifrado en almacenamiento e integridad verificable. Los backups locales SHOULD protegerse adicionalmente cuando sea viable. Las claves de protección MUST NOT incluirse dentro del propio backup de forma que anulen el cifrado.

## 11.7 Backup metadata

```text
backup_id
tenant_id
location_id
edge_id
created_at
edge_version
schema_version
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
Validate backup
→ Validate tenant/location
→ Validate schema
→ Safety backup
→ Stop transactional processing
→ Restore
→ Run migrations
→ Integrity check
→ Health check
→ Resume
```

La arquitectura SHOULD permitir recuperación Offline cuando exista un backup válido, pero MUST exigir una autorización de recuperación verificable localmente. Copiar un backup MUST NOT permitir clonar libremente una instalación productiva. Un Recovery Package MAY combinar Backup, Metadata, Integrity Proof y Recovery Authorization.

## 11.11 Migrations

Todos los cambios de DB utilizarán migrations versionadas.

Modificación manual productiva de tablas MUST NOT ser procedimiento normal.

## 11.12 OTA y migration

```text
Actualización sensible:
Pre-update backup
→ install
→ migrate
→ health check
```

Rollback de aplicación MUST NOT asumir rollback automático del schema.

## 11.13 Corrupción

```text
Ante corrupción:
DB INTEGRITY FAILURE
→ RECOVERY_REQUIRED
```

MUST NOT:

Create empty DB automatically

La información existente deberá preservarse.

## 11.14 Edge replacement

V1 tendrá un único Edge primario por Location.

```text
Reemplazo:
Old Edge → REVOKED
New Edge → ACTIVE
```

No habrá active-active.

## 11.15 Diagnóstico

```text
Edge deberá poder generar:
EXPORT_DIAGNOSTIC_PACKAGE
```

sin exponer secretos.

## 11.16 Installation Health Check

```text
Antes de Go Live:
Edge = OK
DB = OK
License = valid
Tenant/Location = assigned
Catalog = ready
Users = ready
CashRegisters = configured
Stations = configured
Printers = tested
Devices = paired
Backup = initialized
Sync = verified when available
```

Las operaciones de prueba deberán mantenerse separadas de producción. Un Test Mode o flujo equivalente MUST NOT contaminar ventas, Corte Z, analítica ni reportes financieros reales; pruebas específicas SHOULD preferir acciones como TEST_PRINTER o RUN_HEALTH_CHECK sin crear Orders comerciales.

## 11.17 Importación inicial

```text
V1 soportará:
CSV
XLSX
```

para catálogo.

```text
Flujo:
Upload
→ Parse
→ Validate
→ Preview errors
→ Confirm
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
│
┌───────────▼───────────┐
│    COMANVIEW CLOUD    │
│                       │
│ Cloud API             │
│ Sync Engine           │
│ Control Plane         │
│ Cloud Workers         │
│ Public Storefront     │
│ PostgreSQL            │
│ Object Storage        │
└───────────┬───────────┘
│
TLS
│
┌───────────▼───────────┐
│      EDGE RUNTIME     │
│                       │
│ Fastify API           │
│ SQLite                │
│ Domain Engine         │
│ WebSocket             │
│ Sync Worker           │
│ Print Worker          │
│ Backup Worker         │
└───────────┬───────────┘
│
LAN
┌─────────────┼─────────────┐
│             │             │
POS          WAITER          KDS
```

```text
Storefront:
Public Browser
↓
Cloud Storefront
↓
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
Transport
→ Contract Validation
→ Command/Application Service
→ Domain
→ Repository
→ Transaction
→ Database
→ Events
```

```text
MUST NOT utilizarse:
HTTP Route
→ direct table mutation
```

para lógica de negocio.

## 12.9 Packages

```text
packages/domain MUST NOT depender de:
Fastify
React
Drizzle
SQLite
PostgreSQL
AWS
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
event_log
print_jobs
background_jobs
```

## 12.13 Device ↔ Edge Protocol

```text
Se utilizará:
REST
+
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
POS
Waiter
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
TanStack Query
+
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
Modular Monolith
+
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
event_id UNIQUE
edge_id
tenant_id
location_id
payload
received_at
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
AWS
```

```text
Arquitectura inicial:
Route 53
CloudFront
ALB
ECS Fargate
RDS PostgreSQL
S3
CloudWatch
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
product_id
location_id
name
description
price
image
category
available
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
Edge catalog mutation
→ Sync
→ Cloud Inbox
→ Projection Worker
→ Public Projection
→ Cache invalidation
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
ONLINE_WEB
```

pero V1 MUST NOT aceptar Orders públicas.

```text
Futuro flujo:
Customer
→ Storefront
→ Online Order Gateway
→ Cloud durable queue
→ Edge
→ Create Order
```

La web pública MUST NOT escribir directamente a la DB operacional ni comunicarse directamente con Edge.

## 12.32 order_channel

Separado formalmente de order_type.

```text
V1:
POS
WAITER
```

```text
Futuro:
ONLINE_WEB
DELIVERY_AGGREGATOR
API
```

```text
Ejemplo futuro:
order_type = TAKEOUT
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
comanview/
│
├── apps/
│   ├── edge/
│   ├── cloud-api/
│   ├── cloud-worker/
│   ├── super-admin/
│   ├── storefront/
│   ├── pos/
│   ├── waiter/
│   └── kds/
│
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── database/
│   ├── auth/
│   ├── money/
│   ├── sync/
│   ├── printing/
│   ├── ui/
│   ├── client-sdk/
│   ├── config/
│   └── testing/
│
├── migrations/
│   ├── edge/
│   └── cloud/
│
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
Installer
├── pinned Node runtime
├── Edge application
├── SQLite native dependency
├── POS/Waiter/KDS assets
├── Service registration
└── Updater
```

No depender inicialmente de Node Single Executable Applications si su estabilidad no es suficiente.

## 12.41 Docker

```text
Cloud:
Docker/OCI = YES
```

```text
Edge:
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
checks
→ build images
→ deploy staging
→ migrations
→ E2E
```

```text
Edge Release:
build
→ integration tests
→ sign
→ publish INTERNAL
→ PILOT
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
INTERNAL
PILOT
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
Transport
→ Application
→ Domain
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
Business state
+
Financial state
+
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
│    COMANVIEW CLOUD     │
│                        │
│ Node.js / Fastify      │
│ PostgreSQL             │
│ Sync Inbox             │
│ Super Admin            │
│ Licensing              │
│ OTA                    │
│ Telemetry              │
│ Storefront Projection  │
│ Next.js Storefront     │
└───────────┬────────────┘
│
TLS
│
┌───────────▼────────────┐
│     COMANVIEW EDGE     │
│                        │
│ Node.js / Fastify      │
│ SQLite WAL             │
│ Domain Engine          │
│ Event/Outbox           │
│ Audit                  │
│ Sync Worker            │
│ Print Manager          │
│ Backup Engine          │
│ License Manager        │
└───────────┬────────────┘
│
LAN
┌──────────────────────┼─────────────────────┐
│                      │                     │
┌───▼───┐             ┌────▼────┐           ┌────▼────┐
│  POS  │             │ Waiter  │           │   KDS   │
│ React │             │ React   │           │ React   │
└───────┘             └─────────┘           └─────────┘
│
┌─────▼──────┐
│ Print Jobs │
│  ESC/POS   │
└────────────┘
```

```text
Public:
Customer Browser
↓
CloudFront
↓
Next.js Storefront
↓
Published Catalog Projection
```

```text
MUST NOT existir:
Public Internet
→ Restaurant Edge
```

# 16. Regla Maestra del Sistema

Toda la arquitectura de ComanView deberá preservar simultáneamente cuatro propiedades:

**El restaurante puede seguir operando cuando Internet falla.**

**Una operación confirmada nunca debe perderse o duplicarse silenciosamente.**

**El historial financiero y operacional nunca debe reescribirse para ocultar lo que ocurrió.**

La complejidad Cloud o administrativa nunca debe convertirse en una dependencia crítica para vender, preparar, imprimir o cobrar localmente.

Estas propiedades tienen prioridad sobre decisiones de implementación secundarias.
