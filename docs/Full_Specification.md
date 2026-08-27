**ComanView**

Full Specification — Detailed Product & Technical Specification

V1 · Versión completa, corregida y normalizada

# 1. Visión del Producto y Modelo de Negocio

### ComanView — Plataforma POS/KDS Híbrida B2B SaaS Modular

## 1.1 Concepto General

ComanView será una plataforma comercial B2B SaaS para la operación de restaurantes y establecimientos de alimentos, diseñada bajo una arquitectura modular.

La plataforma utilizará un único producto base capaz de adaptarse a distintos tipos y tamaños de establecimientos mediante la activación de módulos y capacidades específicas.

El objetivo de este modelo es permitir que ComanView pueda utilizarse tanto en establecimientos pequeños, como puestos de comida con una caja y una impresora, como en restaurantes medianos o grandes con múltiples meseros, mesas, cocina, barra y diferentes necesidades operativas.

La diferencia entre estos establecimientos no estará determinada por versiones distintas del software, sino por la combinación de módulos contratados y habilitados para cada cliente.

La plataforma deberá diseñarse desde V1 con capacidad de crecimiento hacia funcionalidades futuras como inventarios, recetas, facturación electrónica y operación multi-sucursal, sin requerir una reconstrucción completa del sistema.

## 1.2 Modelo Comercial Modular

ComanView utilizará un modelo de suscripción B2B SaaS compuesto por:

**1. Un Core obligatorio**

Constituye la base funcional de la plataforma y estará presente en todos los clientes.

**2. Módulos adicionales**

Permiten ampliar las capacidades del sistema de acuerdo con las necesidades del establecimiento.

Los módulos podrán activarse o desactivarse mediante la configuración de licencia correspondiente al cliente.

La activación de módulos no requerirá generar versiones independientes del software. Un mismo producto deberá poder operar con diferentes configuraciones funcionales dependiendo de los módulos contratados.

La arquitectura deberá separar correctamente:

Funcionalidades.

Permisos.

Licencias.

Configuración del establecimiento.

Capacidades disponibles para cada cliente.

Esto permitirá que un mismo sistema pueda atender diferentes segmentos comerciales.

## 1.3 Core — Módulo Base Obligatorio

El Core será la base mínima de operación de ComanView y deberá estar disponible para todos los establecimientos.

### Configuración del negocio

Nombre del establecimiento.

Logotipo.

Moneda.

Configuración de impuestos.

Información comercial.

Información fiscal necesaria para la operación del sistema.

### Catálogo

Categorías de productos.

Productos.

Precios.

Modificadores simples.

Configuración básica de productos.

### POS

El Core deberá proporcionar una interfaz de punto de venta que permita:

Seleccionar productos.

Modificar cantidades.

Aplicar modificadores disponibles.

Crear una venta.

Calcular subtotales.

Calcular impuestos.

Calcular total.

Registrar el cobro.

Emitir el comprobante/ticket correspondiente.

### Control de Caja

El sistema deberá permitir:

Apertura de caja.

Registro de operaciones de caja.

Consulta del estado de caja.

Corte X.

Corte Z.

Arqueo de caja.

El Core será la única dependencia obligatoria para que un establecimiento pueda utilizar ComanView como sistema POS básico.

## 1.4 Módulo de Mesas y Comandería

Este módulo estará destinado a establecimientos que requieran operación mediante mesas y personal de servicio.

El módulo podrá activarse independientemente del Core.

### Gestión de mesas

Deberá permitir:

Crear y configurar mesas.

Organizar mesas por zonas.

Visualizar el estado de las mesas.

Crear órdenes asociadas a una mesa.

Transferir mesas.

Unir mesas.

Dividir cuentas.

Gestionar el proceso de pago de una mesa.

Los estados visuales podrán contemplar, como mínimo:

Libre.

Ocupada.

Pagando.

Alerta.

### Comandería móvil

El módulo deberá proporcionar una interfaz optimizada para tablets y smartphones utilizados por meseros.

La interfaz estará orientada a una operación rápida mediante pantalla táctil y deberá permitir:

Seleccionar mesa.

Consultar orden activa.

Agregar productos.

Modificar cantidades.

Seleccionar modificadores.

Enviar productos a preparación.

Consultar el estado de la orden.

Los productos que requieran elecciones obligatorias deberán solicitar dichas opciones antes de poder agregarse a la orden.

**Ejemplo:**

**Hamburguesa**

Término de carne: obligatorio.

Extra queso: opcional.

Sin cebolla: opcional.

Salsa aparte: opcional.

El sistema no deberá permitir agregar el producto si no se han completado las selecciones obligatorias.

## 1.5 Sistema de Impresión Local

La impresión será una capacidad fundamental de la operación de ComanView y estará integrada desde V1.

El sistema deberá permitir trabajar con impresoras térmicas compatibles con ESC/POS dentro de la red local.

Las tablets y dispositivos de los meseros no deberán comunicarse directamente con las impresoras.

El Servidor Edge será responsable de gestionar el proceso de impresión.

### Enrutamiento

Cada producto podrá tener asociada una estación de preparación.

**Ejemplo:**

Tacos → Cocina.

Hamburguesas → Cocina.

Refrescos → Barra.

Cócteles → Barra.

Cuando una orden sea enviada:

El dispositivo envía la orden al Edge.

El Edge procesa la orden.

Divide los productos de acuerdo con su estación.

Genera los comandos de impresión correspondientes.

Envía cada ticket a la impresora configurada.

### Tolerancia a fallos

El sistema deberá contemplar mecanismos de respaldo para impresión.

Si una impresora configurada no responde, el Edge deberá poder detectar el fallo y, cuando exista una impresora de respaldo configurada, reenrutar el ticket.

El sistema deberá informar al usuario cuando ocurra un fallo de impresión.

El KDS podrá funcionar como respaldo operativo cuando las impresoras no estén disponibles.

## 1.6 Módulo KDS — Kitchen Display System

El KDS formará parte de la plataforma V1 y podrá activarse para establecimientos que requieran operación digital de cocina o estaciones de preparación.

El objetivo del KDS será sustituir o complementar los tickets impresos mediante pantallas de preparación.

### Estaciones

Las órdenes podrán dividirse por estaciones.

Ejemplos:

Cocina caliente.

Cocina fría.

Barra.

Postres.

Cada estación podrá visualizar únicamente los productos correspondientes a su área de preparación.

### Tickets

Cada ticket deberá mostrar como mínimo:

Mesa.

Mesero.

Identificador de orden.

Productos a preparar.

Modificadores relevantes.

Tiempo transcurrido.

### Control de tiempos

El KDS deberá mostrar el tiempo transcurrido de cada orden y proporcionar indicadores visuales de acuerdo con los tiempos configurados.

Como referencia inicial:

Verde: tiempo normal.

Naranja: tiempo próximo al límite.

Rojo: tiempo excedido.

Los límites deberán ser configurables posteriormente de acuerdo con las necesidades de cada establecimiento.

### Interacción

El personal de cocina deberá poder:

Marcar productos individuales como preparados.

Completar órdenes.

Retirar órdenes terminadas de la pantalla activa.

Consultar el historial correspondiente.

Cuando una orden sea completada, el sistema deberá poder notificar al personal correspondiente que la orden está lista para continuar con el servicio.

## 1.7 Módulos Futuros

Los siguientes módulos forman parte de la visión de ComanView, pero no serán necesarios para que el Core + Mesas/Comandería + Impresión + KDS constituyan la V1 operativa.

### Inventario y Recetas

Módulo destinado a:

Insumos.

Materias primas.

Unidades de medida.

Recetas técnicas.

Descuento automático de ingredientes.

Mermas.

Stock mínimo.

Proveedores.

Órdenes de compra.

Este módulo deberá poder integrarse posteriormente con las ventas realizadas por el POS.

### Facturación Electrónica

Módulo destinado a la generación y gestión de comprobantes fiscales electrónicos.

La facturación deberá mantenerse desacoplada de la lógica principal del POS.

El POS deberá ser capaz de finalizar una venta independientemente de que el cliente utilice o no el módulo de facturación.

La arquitectura futura deberá permitir que el módulo de facturación reciba la información necesaria de una venta completada y se encargue de su procesamiento fiscal mediante la infraestructura correspondiente.

### Multi-Sucursal

Módulo destinado a negocios que operen más de un establecimiento bajo una misma cuenta empresarial.

Deberá permitir posteriormente:

Administración de múltiples sucursales.

Consolidación de información.

Comparación de métricas.

Gestión independiente de cada establecimiento.

Inventarios por sucursal.

Traspasos entre sucursales.

Reportes consolidados.

La existencia de este módulo no deberá alterar la operación básica de una sucursal individual.

## 1.8 Principio de Modularidad

La V1 deberá diseñarse bajo el principio:

**Un solo producto, múltiples configuraciones.**

El software no deberá dividirse en versiones independientes para diferentes tipos de clientes.

En su lugar, cada establecimiento tendrá una configuración determinada por:

Plan contratado.

Módulos habilitados.

Permisos de usuarios.

Número de dispositivos.

Configuración operativa.

Configuración de hardware.

Ejemplos:

### Puesto de comida

```text
Core + Impresión
```

Puede operar con:

Una caja.

Una impresora.

POS.

Control de caja.

### Restaurante pequeño

```text
Core + Impresión + Mesas/Comandería
```

Puede operar con:

Caja.

Impresora.

Meseros.

Tablets.

Mesas.

### Restaurante mediano

```text
Core + Mesas/Comandería + Impresión + KDS
```

Puede operar con:

Caja.

Múltiples meseros.

Tablets.

Mesas.

Cocina.

Barra.

Pantallas KDS.

Impresoras por estación.

### Restaurante con necesidades administrativas

Podrá incorporar posteriormente:

```text
Core + Mesas + Impresión + KDS + Inventario + Facturación
```

### Cadena o grupo restaurantero

Podrá incorporar:

```text
Core + Mesas + Impresión + KDS + Inventario + Facturación + Multi-Sucursal
```

## 1.9 Definición de V1

La V1 de ComanView no será definida por una cantidad limitada de funcionalidades, sino por la existencia de una primera plataforma modular comercialmente operativa.

La V1 deberá permitir instalar ComanView en un establecimiento real y operar de manera confiable las funciones fundamentales de venta.

### Componentes funcionales de V1

**Core**

Configuración.

Catálogo.

POS.

Cobro.

Caja.

**Mesas y Comandería**

Gestión de mesas.

Órdenes.

Meseros.

Operación móvil.

**Impresión**

ESC/POS.

Enrutamiento por estación.

Impresión local.

Impresora de respaldo.

**KDS**

Estaciones.

Tickets.

Preparación.

Cronómetros.

Estados.

Los módulos de Inventario, Facturación y Multi-Sucursal quedarán como extensiones de la plataforma y deberán poder incorporarse posteriormente sin rediseñar completamente el Core.

### Public Storefront — V1

• Landing pública por Location.

• Menú digital con categorías, productos, precios e indicador de disponibilidad.

• Información pública de horarios, ubicación y contacto.

• QR y URL pública administrada desde Cloud.

• El Storefront será read-only en V1, utilizará una Published Catalog Projection y MUST NOT conectarse directamente al Edge.

## 1.10 Principio Comercial Fundamental

ComanView deberá permitir que un cliente pague únicamente por las capacidades que necesita, mientras que la plataforma conserva una arquitectura común capaz de crecer junto con el establecimiento.

Por lo tanto:

**El cliente pequeño no debe pagar por funcionalidades que no necesita, y el cliente grande no debe necesitar otro software para crecer.**

La V1 será la primera implementación comercial de esta plataforma modular, no una versión desechable o independiente del producto futuro.

# 2. Arquitectura de Red — Topología Híbrida / Offline-First

## 2.1 Principio Arquitectónico General

ComanView utilizará una arquitectura híbrida Edge-to-Cloud diseñada bajo el principio Offline-First.

La operación crítica del restaurante deberá depender de la infraestructura local del establecimiento y no de una conexión permanente a Internet.

El principio fundamental será:

**La pérdida de Internet no debe detener la operación del restaurante.**

Mientras el Servidor Edge Local permanezca operativo dentro de la red del establecimiento, ComanView deberá poder continuar funcionando normalmente.

La conexión con la nube será utilizada para sincronización, administración centralizada, licenciamiento, actualizaciones, analítica y funcionalidades futuras, pero no constituirá una dependencia directa para las operaciones críticas de venta.

## 2.2 Topología General

La arquitectura se dividirá en dos capas principales:

### Capa Local — Edge

Responsable de la operación diaria del establecimiento.

### Capa Cloud

Responsable de la administración centralizada de ComanView y de la información consolidada.

```text
La comunicación general seguirá el siguiente modelo:
```

```text
┌─────────────────────────┐
```

```text
│          CLOUD          │
```

```text
│                         │
```

```text
│ Super Admin             │
```

```text
│ Licencias               │
```

```text
│ Sync API                │
```

```text
│ Configuración remota    │
```

```text
│ Analítica               │
```

```text
│ Actualizaciones         │
```

```text
└────────────┬────────────┘
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
┌────────────▼────────────┐
```

```text
│      EDGE SERVER        │
```

```text
│                         │
```

```text
│ API Local               │
```

```text
│ Base de Datos Local     │
```

```text
│ Event Log               │
```

```text
│ Sync Engine             │
```

```text
│ Print Manager           │
```

```text
│ Autenticación Local     │
```

```text
└────────────┬────────────┘
```

```text
│
```

```text
LAN
```

```text
┌────────────┼─────────────┐
```

```text
│            │             │
```

```text
POS/Caja     Tablets         KDS
```

```text
│         Meseros        Cocina
```

```text
│
```

```text
Impresoras ESC/POS
```

Todos los dispositivos operativos del restaurante deberán comunicarse prioritariamente con el Servidor Edge mediante la red local.

## 2.3 Servidor Edge Local

El Servidor Edge será la autoridad operacional local del establecimiento.

No será definido como una computadora física específica, sino como un servicio de software que puede ejecutarse sobre diferentes tipos de hardware compatibles.

En instalaciones pequeñas podrá ejecutarse inicialmente sobre la misma computadora utilizada como caja principal.

En instalaciones mayores podrá ejecutarse sobre:

Mini PC dedicada.

Servidor local.

Computadora administrativa.

Hardware especializado futuro.

La arquitectura del sistema no deberá depender de que el Edge esté instalado específicamente en la caja.

## 2.4 Responsabilidades del Edge

El Servidor Edge deberá asumir, como mínimo, las siguientes responsabilidades:

### API Local

Proporcionar los servicios utilizados por:

POS.

Tablets de meseros.

KDS.

Terminales administrativas.

Otros dispositivos locales.

### Base de Datos Local

Mantener el estado operacional actual del establecimiento.

### Autenticación Local

Permitir que los usuarios existentes puedan autenticarse incluso cuando no exista conexión con Cloud.

### Gestión de Órdenes

Procesar:

Creación de órdenes.

Adición de productos.

Modificadores.

Cancelaciones.

Cambios de estado.

Envío a cocina.

Preparación.

Cobro.

Cierre.

### Gestión de Caja

Procesar operaciones de apertura, movimientos, cobros, arqueos y cortes.

### Print Manager

Controlar las impresoras locales y ejecutar el enrutamiento de tickets por estación.

### Motor de Eventos

Registrar las operaciones transaccionales relevantes como eventos inmutables.

### Motor de Sincronización

Transmitir eventos e información necesaria hacia la nube cuando exista conectividad.

### Heartbeat

Informar periódicamente a Cloud del estado del Edge cuando exista conexión.

## 2.5 Red Local

La comunicación crítica entre dispositivos deberá ocurrir mediante la red local del establecimiento.

Podrán utilizarse:

Ethernet.

Wi-Fi.

Combinaciones de ambos.

Los siguientes dispositivos podrán conectarse al Edge:

Terminal POS.

Computadoras de caja.

Tablets.

Smartphones.

Pantallas KDS.

Impresoras.

Terminales administrativas.

La operación local no deberá requerir acceso a Internet siempre que los dispositivos puedan comunicarse correctamente con el Edge.

## 2.6 Principio Offline-First

ComanView deberá diseñarse considerando que la pérdida de Internet es un estado operacional normal y no un error catastrófico.

Durante una desconexión a Internet, el establecimiento deberá poder continuar realizando, como mínimo:

Inicio de sesión de usuarios previamente registrados.

Apertura de caja.

Creación de ventas.

Creación de órdenes.

Gestión de mesas.

Adición y modificación de productos.

Uso de modificadores.

Envío de comandas.

Impresión.

Uso del KDS.

Registro de pagos.

Cierre de órdenes.

Cortes de caja.

Consulta de información local disponible.

La ausencia de Internet no deberá provocar automáticamente:

Bloqueo del POS.

Bloqueo de caja.

Bloqueo de comandas.

Bloqueo de impresión.

Bloqueo de KDS.

## 2.7 Dependencias de Cloud

La nube será utilizada principalmente para funciones administrativas y de consolidación.

Podrá ser requerida para:

Sincronización.

Gestión de licencias.

Administración de tenants.

Configuración remota.

Feature Flags.

Analítica centralizada.

Reportes consolidados.

Actualizaciones.

Monitoreo técnico.

Multi-sucursal.

Servicios futuros.

Sin embargo, ninguna operación crítica del restaurante deberá requerir una respuesta en tiempo real de Cloud.

## 2.8 Modelo de Datos Local

ComanView utilizará un modelo híbrido compuesto por:

### Estado Actual

Representa la situación operacional vigente.

Ejemplos:

Orden abierta.

Productos actuales de una orden.

Estado de una mesa.

Estado de un pago.

Estado actual de una caja.

Configuración vigente.

Este estado podrá mantenerse en tablas tradicionales para permitir consultas rápidas.

Ejemplos conceptuales:

orders

order_items

payments

tables

cash_sessions

users

products

devices

### Event Log

Representará la historia de las operaciones transaccionales.

Los eventos registrados deberán ser inmutables.

El estado actual podrá cambiar, pero el evento histórico no deberá modificarse.

Este enfoque se define como:

```text
Estado Actual + Event Log
```

```text
o
```

**Event Sourcing pragmático.**

No será necesario implementar Event Sourcing puro para todos los componentes del sistema.

## 2.9 Eventos Transaccionales

Las operaciones críticas deberán generar eventos independientes.

Ejemplos:

ORDER_CREATED

ORDER_UPDATED

ITEM_ADDED

ITEM_QUANTITY_CHANGED

ITEM_MODIFIER_ADDED

ITEM_REMOVED

ITEM_SENT_TO_KITCHEN

ITEM_PREPARED

ORDER_READY

PAYMENT_CREATED

PAYMENT_COMPLETED

ORDER_CLOSED

CASH_SESSION_OPENED

CASH_MOVEMENT_CREATED

CASH_SESSION_CLOSED

Los nombres definitivos podrán evolucionar durante el diseño técnico, pero el principio deberá mantenerse.

Cada evento deberá representar una acción específica ocurrida dentro del sistema.

## 2.10 Identificadores Únicos

Las entidades transaccionales deberán utilizar identificadores únicos globales.

No se deberán utilizar identificadores autoincrementales locales como mecanismo principal de identidad para operaciones que puedan sincronizarse.

Las nuevas entidades sincronizables utilizarán UUID v7 como estándar de identidad global, salvo una excepción técnica explícitamente documentada.

Entre las entidades que requerirán identificadores únicos se contemplan:

tenant_id

location_id

device_id

user_id

order_id

order_item_id

payment_id

cash_session_id

event_id

Esto permitirá identificar correctamente:

Qué ocurrió.

En qué establecimiento.

En qué sucursal.

Desde qué dispositivo.

Por qué usuario.

Sobre qué orden.

En qué momento.

## 2.11 Estructura Conceptual de un Evento

Cada evento deberá contener información suficiente para identificar y procesar la operación.

Ejemplo conceptual:

“event_id, event_type, tenant_id, location_id, device_id, user_id, entity_id, order_id, payload, created_at_local, sequence, sync_status”

El campo payload podrá contener la información específica requerida por cada tipo de evento.

**Ejemplo:**

event_type: ITEM_ADDED

payload:

{

product_id,

quantity,

unit_price,

modifiers

}

La estructura definitiva deberá definirse durante el diseño técnico de la API y del modelo de datos.

## 2.12 Orden de Eventos

El sistema no deberá depender exclusivamente de la hora del dispositivo para establecer el orden real de operaciones.

Los relojes de distintos dispositivos pueden presentar diferencias.

Por ello, el Edge deberá funcionar como autoridad temporal local para las operaciones recibidas.

Cuando un dispositivo envíe una operación:

El Edge recibe la solicitud.

Valida la operación.

Genera o valida el evento correspondiente.

Asigna el orden local correspondiente.

Actualiza el estado actual.

Registra el evento en el Event Log.

El sistema podrá conservar la hora del dispositivo como información complementaria, pero la secuencia operacional local deberá ser determinada por el Edge.

## 2.13 Flujo de Operación Local

**Ejemplo:**

Un mesero agrega dos tacos a una orden.

```text
Tablet
```

```text
↓
```

```text
POST /order/{id}/items
```

```text
↓
```

```text
Edge API
```

```text
↓
```

```text
Validación
```

```text
↓
```

```text
Evento ITEM_ADDED
```

```text
↓
```

```text
Event Log
```

```text
↓
```

```text
Actualización de order_items
```

```text
↓
```

```text
Respuesta a Tablet
```

```text
Si el producto debe enviarse a cocina:
```

```text
ORDER / ITEM
```

```text
↓
```

```text
Edge
```

```text
↓
```

```text
Routing Engine
```

```text
↓
```

```text
┌──────────────┬───────────────┐
```

```text
│              │               │
```

```text
Impresora    KDS Cocina     KDS Barra
```

Todo este flujo deberá poder ejecutarse sin conexión a Internet.

## 2.14 Cola de Sincronización

Los eventos que deban transmitirse a Cloud deberán mantener un estado de sincronización.

Conceptualmente podrá existir una estructura como:

event_log

con campos similares a:

event_id

event_type

payload

created_at

sync_status

sync_attempts

last_sync_attempt

Los estados podrán incluir:

PENDING

SYNCING

SYNCED

FAILED

No será obligatorio mantener una tabla sync_queue separada si el propio Event Log puede cumplir esta función.

La implementación definitiva deberá evitar duplicación innecesaria de información.

## 2.15 Flujo de Sincronización Edge-to-Cloud

Cuando exista conectividad:

El Edge identifica eventos pendientes.

Agrupa eventos en lotes.

Los envía a la API Cloud.

Cloud valida los eventos.

Cloud procesa únicamente eventos que no hayan sido procesados anteriormente.

Cloud devuelve una confirmación.

El Edge marca los eventos confirmados como sincronizados.

El proceso deberá ser tolerante a:

Reintentos.

Pérdida de conexión.

Respuestas duplicadas.

Eventos enviados más de una vez.

Reinicio del Edge.

## 2.16 Idempotencia

La sincronización deberá ser idempotente.

Esto significa que enviar el mismo evento múltiples veces no deberá ejecutar la operación múltiples veces.

El event_id será utilizado como mecanismo principal para detectar eventos ya procesados.

**Ejemplo:**

```text
event_id = 8c912...
```

```text
ITEM_ADDED
```

Si Cloud ya procesó ese event_id, un reintento deberá devolver una confirmación sin volver a añadir el producto.

## 2.17 Confirmación — ACK

Cloud deberá responder explícitamente qué eventos fueron procesados correctamente.

Ejemplo conceptual:

received:

[

event_1,

event_2,

event_3

]

failed:

[

event_4

]

El Edge únicamente marcará como sincronizados los eventos confirmados correctamente.

Los eventos fallidos deberán permanecer disponibles para reintento o revisión.

## 2.18 Batching

La sincronización deberá utilizar lotes para evitar realizar una solicitud HTTP independiente por cada operación.

Por ejemplo:

50

100

200

eventos por lote.

El tamaño definitivo deberá configurarse y ajustarse según rendimiento y estabilidad.

Los lotes no deberán comprometer la operación local.

La sincronización deberá ejecutarse en segundo plano.

## 2.19 Conflictos de Concurrencia

ComanView no deberá sincronizar objetos completos como mecanismo principal para datos transaccionales.

Por ejemplo, no deberá sincronizar:

"Mesa 4 ahora contiene..."

como única fuente de verdad.

Deberá sincronizar acciones individuales.

**Ejemplo:**

ITEM_ADDED

ITEM_REMOVED

PAYMENT_CREATED

Esto reduce el riesgo de que una modificación sobrescriba accidentalmente otra operación válida.

## 2.20 Resolución de Conflictos

No todos los conflictos podrán resolverse mediante el orden de llegada.

Cada tipo de operación deberá tener reglas específicas.

**Ejemplo:**

Dos meseros agregan productos diferentes:

ITEM_ADDED: Taco

ITEM_ADDED: Refresco

Ambos eventos son válidos.

**Ejemplo:**

Un usuario elimina un producto mientras otro intenta modificarlo.

ITEM_REMOVED

ITEM_QUANTITY_CHANGED

El sistema deberá evaluar el estado de la entidad y las reglas de negocio.

Los conflictos podrán resolverse mediante:

Validación contra estado actual.

Reglas de precedencia.

Bloqueos lógicos.

Versionado.

Rechazo controlado de eventos incompatibles.

Registro de auditoría.

Las reglas específicas se definirán posteriormente por tipo de operación.

## 2.21 Validación Local

La validación principal de una operación crítica deberá ocurrir en el Edge.

**Ejemplo:**

Antes de permitir eliminar un producto ya enviado a cocina, el Edge deberá validar:

Estado del producto.

Permisos del usuario.

Autorización por PIN si aplica.

Estado de la orden.

Estado del pago.

Cloud no deberá ser consultado para autorizar este tipo de operación.

## 2.22 Estado del Edge

El Edge deberá mantener información sobre su propia salud operacional.

Como mínimo:

Estado del servicio.

Versión instalada.

Última conexión con Cloud.

Última sincronización exitosa.

Eventos pendientes.

Eventos con error.

Uso de almacenamiento.

Estado de base de datos.

Estado de impresoras cuando sea posible.

Cuando exista Internet, esta información podrá transmitirse al Super Admin.

## 2.23 Heartbeat

El Edge deberá enviar periódicamente una señal de estado a Cloud.

El heartbeat podrá incluir:

tenant_id

location_id

edge_id

version

timestamp

last_sync

pending_events

storage_status

La frecuencia definitiva será configurable.

La ausencia de heartbeat no deberá provocar automáticamente un bloqueo de operación.

Su propósito será monitoreo y administración.

## 2.24 Fallo de Internet

Cuando se detecte pérdida de conectividad:

El Edge mantiene la operación local.

Los eventos continúan registrándose.

Los eventos permanecen pendientes de sincronización.

El sistema podrá mostrar un indicador de estado Offline.

Se continuará intentando reconectar en segundo plano.

Cuando Internet regrese:

Se detecta conectividad.

Se inicia la sincronización.

Se transmiten eventos pendientes.

Cloud confirma recepción.

Se actualiza el estado de sincronización.

## 2.25 Fallo del Edge

La pérdida del Edge será considerada un fallo crítico local, ya que el Edge representa la autoridad operacional del establecimiento.

Por ello, la arquitectura deberá contemplar posteriormente mecanismos como:

Inicio automático del servicio.

Recuperación tras reinicio.

Copias de seguridad.

Restauración de base local.

Monitoreo del proceso.

Persistencia durable de eventos.

Herramientas de diagnóstico.

En V1 deberá priorizarse como mínimo que el servicio Edge:

Se inicie automáticamente con el sistema.

Recupere correctamente la base local.

No pierda operaciones confirmadas.

Mantenga persistencia de eventos.

Pueda reanudar la sincronización después de un reinicio.

La alta disponibilidad con múltiples Edge simultáneos podrá evaluarse posteriormente y no será un requisito inicial.

## 2.26 Persistencia Local

Una operación no deberá considerarse confirmada ante el usuario hasta haber sido persistida correctamente por el Edge.

```text
Ejemplo:
```

```text
Tablet
```

```text
↓
```

```text
Edge
```

```text
↓
```

```text
Persistencia DB
```

```text
↓
```

```text
Evento registrado
```

```text
↓
```

```text
ACK local
```

```text
↓
```

```text
Tablet muestra operación completada
```

Esto reduce el riesgo de mostrar una operación como exitosa antes de haber sido almacenada.

## 2.27 Cloud como Réplica Administrativa y de Consolidación

Para las operaciones del restaurante, el Edge será la autoridad local inmediata.

Cloud recibirá y consolidará la información sincronizada.

Cloud será especialmente importante para:

Super Admin.

Analítica.

Reportes históricos.

Monitoreo.

Configuración de licencias.

Multi-sucursal futura.

Sin embargo:

**Cloud no será parte del camino crítico de una venta local.**

## 2.28 Configuración Cloud-to-Edge

No toda sincronización será Edge-to-Cloud.

Cloud también podrá enviar configuraciones hacia el Edge.

Ejemplos:

Feature Flags.

Información de licencia.

Configuración remota.

Nuevas versiones.

Parámetros administrativos.

Estas configuraciones deberán almacenarse localmente.

El Edge no deberá depender de consultar Cloud constantemente para conocer la configuración vigente.

## 2.29 Cache de Licencia

El estado de licencia deberá mantenerse localmente.

Cuando exista comunicación con Cloud:

Cloud envía el estado actualizado.

Edge almacena una copia local.

Edge utiliza esa información durante desconexiones.

La pérdida temporal de conexión no deberá provocar bloqueo inmediato.

La política completa de:

Periodos de gracia.

Suspensión.

Falta de pago.

Licencias expiradas.

se definirá en la sección correspondiente al Super Admin y licenciamiento.

## 2.30 Separación entre Identidad Comercial e Identidad Técnica

El sistema deberá diferenciar entre:

### Tenant

Empresa o cliente contractual.

### Location

Establecimiento físico.

### Edge

Instancia del servidor local.

### Device

Dispositivo conectado.

### User

Persona que opera el sistema.

**Ejemplo:**

Tenant:

Restaurantes Angel S.A.

Location:

Sucursal Centro

Edge:

EDGE-CENTRO-01

Devices:

POS-01

TABLET-01

TABLET-02

KDS-COCINA-01

Users:

Mesero 1

Mesero 2

Gerente

Cajero

Esta separación permitirá soportar posteriormente multi-sucursal sin reconstruir el modelo de identidad.

## 2.31 Preparación para Multi-Sucursal

Aunque Multi-Sucursal no forme parte funcional de la primera implementación completa, la arquitectura deberá contemplar desde V1 el concepto de location_id.

Ninguna operación crítica deberá asumir que un tenant posee únicamente una sucursal.

Esto permitirá que el módulo Multi-Sucursal sea incorporado posteriormente con menor impacto arquitectónico.

## 2.32 Seguridad de Red Local

El hecho de que la operación se realice en LAN no deberá implicar ausencia de seguridad.

La comunicación entre dispositivos y Edge deberá contemplar:

Autenticación.

Identificación de dispositivos.

Sesiones.

Tokens locales.

Control de permisos.

Protección contra dispositivos no autorizados.

Los mecanismos técnicos exactos se definirán en la sección de Seguridad.

## 2.33 Principios Arquitectónicos Definitivos

La arquitectura de ComanView deberá respetar los siguientes principios:

### 1. Offline-First

La pérdida de Internet no detiene el restaurante.

### 2. Edge como autoridad operacional

Las operaciones críticas se procesan localmente.

### 3. Cloud desacoplado del camino crítico

Cloud administra y consolida, pero no autoriza cada venta.

### 4. Estado Actual + Event Log

El sistema mantiene estado rápido para operación y eventos inmutables para historial y sincronización.

### 5. Sincronización por eventos

Las operaciones transaccionales no se sincronizan mediante sobrescritura de estados completos.

### 6. Idempotencia

Un evento duplicado no debe duplicar su efecto.

### 7. Identidad global

Las entidades sincronizables deberán tener identificadores globalmente únicos.

### 8. Edge independiente del hardware

El Edge es un servicio, no una computadora específica.

### 9. Persistencia antes de confirmación

Una operación solo se considera aceptada después de haberse almacenado correctamente.

### 10. Preparación para crecimiento

La arquitectura deberá permitir incorporar posteriormente inventarios, facturación, multi-sucursal y otras extensiones sin reemplazar la base operacional.

## 2.34 Alcance Arquitectónico de V1

Para V1 deberán estar operativos como mínimo:

Servidor Edge.

API local.

Base de datos local.

Autenticación local.

POS conectado al Edge.

Comandería conectada al Edge.

KDS conectado al Edge.

Impresión controlada por Edge.

Event Log.

Persistencia local.

Sincronización Edge-to-Cloud.

ACK.

Reintentos.

Idempotencia.

Heartbeat.

Estado Offline.

Recuperación tras reinicio.

Identificación de tenant, location, Edge, dispositivo y usuario.

Podrán quedar para iteraciones posteriores dentro de la misma arquitectura:

Alta disponibilidad con múltiples Edge.

Sincronización Edge-to-Edge.

Failover automático entre servidores.

Replicación local avanzada.

Clusterización.

Mecanismos distribuidos de consenso.

Estas capacidades no deberán complicar innecesariamente la primera implementación comercial.

# 3. Super Admin, Licenciamiento, Feature Flags, Monitoreo y Actualizaciones OTA

## 3.1 Objetivo de la Capa Administrativa

ComanView contará con un Super Admin centralizado en Cloud, destinado exclusivamente a la administración del servicio SaaS por parte del equipo operador de ComanView.

El Super Admin no será el panel administrativo del restaurante. Su función será gestionar la plataforma, clientes, licencias, módulos, servidores Edge, versiones de software y estado técnico de las instalaciones.

La arquitectura deberá mantener una separación clara entre:

Operación local del restaurante.

Administración comercial del SaaS.

Configuración remota.

Monitoreo técnico.

Actualizaciones de software.

Analítica comercial.

El Super Admin no formará parte del camino crítico de las ventas realizadas dentro del restaurante.

## 3.2 Alcance del Super Admin

El Super Admin deberá permitir administrar como mínimo las siguientes entidades:

### Clientes / Tenants

Alta de clientes.

Modificación de información comercial.

Estado contractual.

Plan contratado.

Estado de pago.

Módulos contratados.

Historial administrativo.

### Locations

Cada establecimiento físico deberá existir como una entidad independiente asociada a un tenant.

El Super Admin deberá permitir:

Crear locations.

Activarlas.

Suspenderlas.

Consultar su estado.

Asociar servidores Edge.

Consultar dispositivos registrados.

### Servidores Edge

Cada instancia Edge deberá poder identificarse y administrarse individualmente.

El Super Admin deberá mostrar:

Identificador.

Location correspondiente.

Versión instalada.

Último heartbeat.

Última sincronización.

Estado técnico.

Estado de licencia.

Eventos pendientes.

Información de diagnóstico.

### Dispositivos

El sistema deberá poder mantener un registro de dispositivos asociados a cada instalación.

Ejemplos:

POS.

Tablets.

Smartphones.

Pantallas KDS.

Terminales administrativas.

## 3.3 Separación entre Planes, Entitlements y Feature Flags

ComanView deberá separar claramente tres conceptos:

### Plan Comercial

Representa la estructura comercial contratada por el cliente.

Ejemplo conceptual:

Plan Restaurante

### Entitlements

Representan las capacidades comerciales que el cliente tiene derecho a utilizar.

**Ejemplo:**

```text
CORE = enabled
```

```text
TABLE_SERVICE = enabled
```

```text
KDS = enabled
```

```text
INVENTORY = disabled
```

```text
MULTI_LOCATION = disabled
```

Los Entitlements responderán a la pregunta:

**¿Qué funcionalidades compró el cliente?**

### Feature Flags

Representan controles técnicos internos utilizados para habilitar, deshabilitar o modificar comportamientos específicos del software.

**Ejemplo:**

```text
kds.enabled = true
```

```text
kds.multi_station = true
```

```text
kds.experimental_layout = false
```

Los Feature Flags responderán a la pregunta:

**¿Qué capacidades técnicas están activas dentro de esta instalación?**

No todos los Feature Flags deberán representar funcionalidades comercializables.

Esta separación permitirá realizar pruebas, despliegues progresivos y configuraciones internas sin modificar el plan comercial del cliente.

## 3.4 Licencia Local del Edge

Cada Edge deberá mantener una copia local válida del estado de licencia.

Cloud no deberá ser consultado para autorizar cada venta, orden o pago.

```text
El flujo normal será:
```

```text
Cloud
```

```text
↓
```

```text
Generación / actualización de licencia
```

```text
↓
```

```text
Edge descarga licencia
```

```text
↓
```

```text
Validación
```

```text
↓
```

```text
Persistencia local
```

```text
↓
```

```text
Operación utilizando licencia cacheada
```

La licencia deberá contener, como mínimo:

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

La estructura definitiva podrá ampliarse durante la implementación.

## 3.5 Firma y Validación de Licencia

Las licencias deberán estar firmadas criptográficamente.

El Edge deberá poder comprobar que una licencia:

Fue emitida legítimamente por ComanView.

No fue modificada localmente.

Corresponde al tenant correcto.

Corresponde a la location correcta.

Modificar archivos locales no deberá permitir:

Activar módulos.

Cambiar fechas.

Eliminar restricciones.

Alterar el estado de licencia.

La clave privada utilizada para emitir licencias deberá permanecer exclusivamente en infraestructura controlada por ComanView.

El Edge únicamente deberá disponer del mecanismo necesario para verificar la autenticidad.

## 3.6 Estados de Licencia

El sistema utilizará estados explícitos de licencia.

Como mínimo:

ACTIVE

PAST_DUE

GRACE_PERIOD

SUSPENDED

TERMINATED

### ACTIVE

La cuenta está vigente.

El sistema opera normalmente.

### PAST_DUE

Existe un pago vencido confirmado, pero el cliente todavía se encuentra dentro del período administrativo permitido.

La operación deberá continuar normalmente.

Podrán mostrarse advertencias administrativas a:

Dueño.

Gerente.

Usuarios administrativos autorizados.

Las advertencias no deberán interferir constantemente con el trabajo de meseros, cocineros o cajeros.

### GRACE_PERIOD

El Edge no ha podido validar recientemente su estado con Cloud o existe una condición administrativa que todavía no justifica una suspensión inmediata.

Durante este estado:

La operación continúa.

POS continúa.

Caja continúa.

Mesas continúan.

KDS continúa.

Impresión continúa.

Los administradores reciben advertencias.

La duración del Grace Period deberá ser configurable desde las políticas comerciales de ComanView.

### SUSPENDED

Cloud ha confirmado explícitamente que la licencia debe suspenderse.

Este estado estará sujeto a la política de Cierre de Turno Garantizado definida posteriormente.

### TERMINATED

Representa una relación comercial terminada o una licencia definitivamente cancelada.

Su comportamiento operativo deberá manejarse mediante políticas administrativas específicas y no deberá confundirse con una simple mora temporal.

## 3.7 Offline no equivale a Impago

ComanView deberá diferenciar estrictamente entre:

LICENCIA NO VALIDADA

y:

LICENCIA SUSPENDIDA

Si el Edge pierde conectividad y no puede consultar Cloud, no deberá asumir automáticamente que el cliente dejó de pagar.

Por lo tanto:

**La ausencia de conexión nunca será suficiente por sí sola para suspender la operación.**

El Edge utilizará:

Última licencia válida.

Último estado conocido.

Fecha de última validación.

Grace Period configurado.

La desconexión prolongada podrá generar alertas y restricciones administrativas, pero no deberá provocar un cierre operacional arbitrario.

## 3.8 Protección ante Offline Deliberado

La arquitectura Offline-First no deberá convertirse en un mecanismo para utilizar ComanView indefinidamente sin validar la licencia.

Para reducir este riesgo se podrán utilizar:

Licencias firmadas.

Fecha de última validación.

Grace Period limitado.

Registro de períodos largos sin conexión.

Validación eventual obligatoria.

Restricciones administrativas progresivas.

Alertas al Super Admin.

Auditoría cuando el Edge vuelva a conectarse.

Sin embargo:

**La protección comercial nunca deberá convertir una desconexión normal en un riesgo operacional para el restaurante.**

## 3.9 Política de Suspensión — Cierre de Turno Garantizado

ComanView utilizará una política de suspensión diseñada para evitar interrumpir una jornada activa.

El principio será:

**Una suspensión confirmada no deberá cortar una operación de restaurante que ya se encuentra en curso.**

### Fase 1 — Suspensión confirmada durante turno activo

Si Cloud transmite un estado SUSPENDED mientras existe una sesión de caja activa, ComanView deberá permitir terminar dicha jornada.

Durante este período podrán continuar:

Creación de comandas.

Adición de productos.

Envío a cocina.

Impresión.

KDS.

Cobros.

Cierre de mesas.

Cierre de órdenes.

Operaciones necesarias para terminar el turno.

Corte X.

Corte Z.

El objetivo será evitar dejar:

Mesas sin cobrar.

Órdenes abiertas.

Clientes esperando.

Pagos incompletos.

Cocina sin capacidad de terminar pedidos existentes.

## 3.10 Activación del Bloqueo Operativo

Una vez realizado el Corte Z correspondiente al turno activo, la suspensión quedará preparada para entrar en vigor.

Al intentar realizar una nueva:

**Apertura de Caja / Inicio de Turno**

el sistema deberá verificar el estado local de licencia.

Si continúa en:

SUSPENDED

no permitirá comenzar una nueva jornada operativa.

El sistema deberá mostrar claramente que la licencia necesita ser reactivada.

El bloqueo no deberá depender de que Cloud esté disponible exactamente en ese momento si el Edge ya recibió previamente una suspensión firmada y válida.

## 3.11 Código de Reactivación Temporal

ComanView podrá disponer de un mecanismo de reactivación temporal proporcionado por soporte.

El objetivo será resolver situaciones excepcionales como:

Pago realizado pero aún no conciliado.

Problemas bancarios.

Incidencias administrativas.

Fallos temporales de Cloud.

Situaciones comerciales autorizadas.

El código deberá:

Ser generado por ComanView.

Tener una vigencia limitada.

Estar asociado al tenant/location correspondiente.

Ser verificable de forma segura.

Tener un solo propósito claramente definido.

Quedar registrado en auditoría.

Una reactivación temporal no deberá modificar permanentemente el contrato del cliente.

## 3.12 Restricciones Administrativas durante Suspensión

Cuando una licencia se encuentre en estado SUSPENDED, los paneles de administración local deberán quedar restringidos.

No deberá permitirse realizar cambios como:

Modificar catálogo.

Cambiar precios.

Alterar configuración.

Registrar nuevos dispositivos.

Crear nuevos usuarios administrativos.

Modificar estaciones.

Cambiar impresoras.

Configurar KDS.

Cambiar parámetros de negocio.

Durante el cierre de turno garantizado únicamente deberán mantenerse disponibles las funciones necesarias para concluir correctamente la operación existente.

## 3.13 Sincronización de Configuración Cloud-to-Edge

La configuración administrativa deberá sincronizarse desde Cloud hacia el Edge.

Entre los elementos sincronizables podrán encontrarse:

Estado de licencia.

Entitlements.

Feature Flags.

Límites de dispositivos.

Parámetros administrativos.

Políticas.

Configuración remota.

Información sobre actualizaciones.

La estrategia deberá utilizar:

```text
Push + Pull de respaldo
```

## 3.14 Push de Configuración

Cuando el Edge se encuentre conectado, Cloud podrá enviar una señal inmediata indicando que existe una nueva configuración.

Tecnologías como:

WebSocket.

MQTT.

Mecanismos equivalentes.

podrán utilizarse para proporcionar actualización rápida.

El Push no deberá considerarse suficiente por sí solo.

## 3.15 Pull de Respaldo

El Edge deberá consultar periódicamente si existe una configuración más reciente.

Esto resolverá escenarios donde:

Edge estaba offline.

Se perdió un mensaje Push.

El servicio se reinició.

Existió una interrupción de red.

Cada configuración tendrá un identificador o versión.

**Ejemplo:**

```text
Cloud config_version = 52
```

```text
Edge config_version = 49
```

El Edge detectará que existe información pendiente y solicitará la actualización correspondiente.

## 3.16 Persistencia de Configuración

Una vez recibida y validada, la configuración deberá almacenarse localmente.

La operación no deberá depender de consultar continuamente Cloud para determinar:

Qué módulos están activos.

Qué dispositivos están autorizados.

Qué licencia posee el cliente.

Qué configuración debe utilizarse.

Esto mantendrá el principio Offline-First.

## 3.17 Monitoreo Técnico

El Super Admin deberá proporcionar información sobre la salud de cada instalación ComanView.

El objetivo será permitir soporte preventivo y diagnóstico remoto.

Por cada Edge se deberá poder consultar como mínimo:

### Identificación

Tenant.

Location.

Edge ID.

### Estado

Online.

Offline temporal.

Desconectado.

Último heartbeat.

### Software

Versión instalada.

Canal de actualización.

Última actualización.

Estado del proceso de actualización.

### Sincronización

Última sincronización exitosa.

Eventos pendientes.

Eventos fallidos.

Último error de sincronización.

### Sistema

Uptime.

Uso de almacenamiento.

Estado de base de datos.

Estado general del servicio.

### Dispositivos

Cuando sea técnicamente posible:

POS conectados.

Tablets conectadas.

KDS conectados.

Impresoras configuradas.

Estado de impresoras.

Última comunicación.

## 3.18 Estados Visuales de Salud

La interfaz podrá utilizar indicadores visuales como:

ONLINE

OFFLINE TEMPORAL

DESCONEXIÓN PROLONGADA

ERROR

Los tiempos exactos deberán ser configurables.

Ejemplo conceptual:

ONLINE

Heartbeat reciente.

OFFLINE TEMPORAL

Sin heartbeat reciente, pero dentro de un intervalo razonable.

DESCONEXIÓN PROLONGADA

Sin comunicación durante un período considerable.

ERROR

Edge conectado pero reportando una condición técnica importante.

Estos estados deberán representar salud técnica y no estado comercial de la licencia.

## 3.19 Separación entre Telemetría Técnica y Analítica Comercial

El sistema deberá distinguir:

### Telemetría técnica

Utilizada para soporte.

Ejemplos:

```text
printer_online = false
```

```text
pending_events = 23
```

```text
database_size = 900 MB
```

```text
last_sync = ...
```

### Analítica comercial

Utilizada para reportes del negocio.

Ejemplos:

Ventas.

Ticket promedio.

Productos vendidos.

Rendimiento.

Utilidad futura.

Ambas categorías deberán almacenarse y utilizarse con propósitos claramente diferenciados.

El Super Admin técnico no deberá recolectar información comercial innecesaria únicamente para diagnosticar infraestructura.

## 3.20 Acciones Remotas Permitidas

El Super Admin podrá solicitar determinadas operaciones remotas sobre el Edge.

Las acciones deberán estar predefinidas y controladas.

Ejemplos:

REFRESH_LICENSE

REFRESH_CONFIG

RETRY_SYNC

RESTART_EDGE_SERVICE

RUN_HEALTH_CHECK

TEST_PRINTER

DOWNLOAD_DIAGNOSTIC_LOGS

CHECK_FOR_UPDATE

INSTALL_UPDATE

Cada acción deberá:

Ser autenticada.

Estar autorizada.

Quedar registrada.

Ser validada por el Edge.

Tener un alcance definido.

## 3.21 Prohibición de Ejecución Arbitraria

El Super Admin no deberá proporcionar una consola genérica que permita ejecutar comandos arbitrarios sobre el sistema operativo del cliente.

No deberá existir una capacidad equivalente a:

EXECUTE_ANY_COMMAND

como parte normal de administración.

Esto reducirá el impacto potencial de:

Credenciales comprometidas.

Vulnerabilidades del Super Admin.

Errores administrativos.

Abuso de privilegios.

Si en el futuro fueran necesarias herramientas avanzadas de soporte remoto, deberán diseñarse como un componente de seguridad independiente.

## 3.22 Actualizaciones OTA

ComanView deberá permitir actualizar remotamente los Servidores Edge.

La actualización deberá ser controlada desde Cloud, pero ejecutada localmente por el Edge.

El sistema deberá permitir:

Consultar versiones.

Descargar nuevas versiones.

Validar paquetes.

Programar instalación.

Verificar resultado.

Realizar rollback.

## 3.23 Canales de Despliegue

Las versiones no deberán enviarse necesariamente a todos los clientes simultáneamente.

Se utilizarán canales de actualización.

Como mínimo:

INTERNAL

PILOT

STABLE

### INTERNAL

Entornos internos de desarrollo, QA o pruebas.

### PILOT

Clientes seleccionados o instalaciones controladas utilizadas para validar una versión antes de distribución general.

### STABLE

Versión considerada apta para producción general.

## 3.24 Despliegue Progresivo

El sistema deberá permitir estrategias de despliegue gradual.

```text
Ejemplo:
```

```text
Nueva versión
```

```text
↓
```

```text
INTERNAL
```

```text
↓
```

```text
PILOT
```

```text
↓
```

```text
Grupo reducido de clientes
```

```text
↓
```

```text
Despliegue porcentual
```

```text
↓
```

```text
STABLE general
```

Esto permitirá detectar problemas antes de afectar toda la base instalada.

## 3.25 Flujo Seguro de Actualización

```text
Una actualización deberá seguir un proceso similar a:
```

```text
Nueva versión disponible
```

```text
↓
```

```text
Edge recibe aviso
```

```text
↓
```

```text
Descarga paquete
```

```text
↓
```

```text
Verifica firma / integridad
```

```text
↓
```

```text
Conserva versión actual
```

```text
↓
```

```text
Espera ventana segura
```

```text
↓
```

```text
Instala actualización
```

```text
↓
```

```text
Inicia nueva versión
```

```text
↓
```

```text
Health Check
```

```text
↓
```

```text
SUCCESS
```

Si el Health Check falla:

ROLLBACK

El rollback será una capacidad obligatoria del sistema de actualizaciones.

## 3.26 Integridad de Actualizaciones

Los paquetes deberán ser verificables mediante mecanismos de integridad y autenticidad.

El Edge no deberá instalar una versión cuando:

La firma sea inválida.

El paquete esté corrupto.

La descarga esté incompleta.

La versión no corresponda al canal autorizado.

## 3.27 Ventanas Seguras de Actualización

ComanView no deberá reiniciar automáticamente componentes críticos durante operación activa.

Una actualización automática deberá evitar ejecutarse mientras existan condiciones como:

Órdenes abiertas.

Mesas activas.

Pagos en proceso.

Impresiones pendientes.

Operaciones críticas de caja.

El momento recomendado será después del cierre operacional.

Como referencia principal:

**Después del Corte Z.**

También podrán existir:

Ventanas horarias configurables.

Instalación manual autorizada.

Actualizaciones urgentes bajo reglas especiales.

## 3.28 Recuperación ante Fallos de Actualización

El Edge deberá preservar una versión funcional previa durante el proceso de actualización.

Si la nueva versión:

No inicia.

No puede conectarse a la base.

Falla su Health Check.

Presenta un error crítico de inicialización.

el sistema deberá intentar restaurar la versión anterior.

La actualización no deberá dejar al restaurante en un estado inutilizable sin mecanismo de recuperación.

## 3.29 Auditoría del Super Admin

Toda acción administrativa sensible deberá generar un registro de auditoría.

El registro podrá incluir:

audit_id

admin_user_id

tenant_id

location_id

edge_id

action

previous_value

new_value

timestamp

session_id

source_ip

result

Entre las acciones auditables deberán incluirse:

TENANT_CREATED

TENANT_DISABLED

LOCATION_CREATED

LICENSE_CHANGED

LICENSE_SUSPENDED

TEMPORARY_REACTIVATION_CREATED

ENTITLEMENT_ENABLED

ENTITLEMENT_DISABLED

DEVICE_LIMIT_CHANGED

FEATURE_FLAG_CHANGED

UPDATE_DEPLOYED

REMOTE_ACTION_REQUESTED

Los registros de auditoría deberán considerarse inmutables desde las interfaces administrativas normales.

## 3.30 Seguridad del Super Admin

Debido al nivel de privilegio del Super Admin, deberá tratarse como uno de los componentes de mayor sensibilidad de toda la plataforma.

La arquitectura deberá contemplar posteriormente:

Autenticación fuerte.

MFA.

RBAC administrativo.

Gestión de sesiones.

Auditoría.

Limitación de acciones.

Protección de claves.

Alertas ante actividad anómala.

Los detalles se desarrollarán en la sección específica de Seguridad.

## 3.31 Alcance de V1

Para la primera versión comercial, el Super Admin deberá contar como mínimo con:

### Gestión comercial

Crear tenants.

Crear locations.

Consultar clientes.

Definir estado de licencia.

Administrar Entitlements.

Configurar límites básicos.

### Licenciamiento

Generación de licencia.

Firma.

Validación.

Cache local.

Estados de licencia.

Grace Period.

Suspensión.

Cierre de Turno Garantizado.

Reactivación temporal.

### Configuración

Feature Flags.

Versionado.

Sincronización Cloud-to-Edge.

Push.

Pull de respaldo.

### Monitoreo

Heartbeat.

Estado Edge.

Última sincronización.

Versión.

Eventos pendientes/fallidos.

Estado general de infraestructura.

### Actualizaciones

Publicar versiones.

Canales.

Descarga.

Verificación.

Instalación.

Health Check.

Rollback.

### Auditoría

Registro de acciones del Super Admin.

## 3.32 Capacidades Posteriores

Podrán incorporarse después sin modificar los principios anteriores:

Automatización avanzada de cobros.

Integración con gateways de pago SaaS.

Provisionamiento automático de hardware.

Gestión avanzada de flotas Edge.

Políticas OTA por región.

Despliegues Canary avanzados.

Telemetría histórica avanzada.

Alertas automáticas.

Diagnóstico predictivo.

Gestión central de backups.

Herramientas avanzadas de soporte.

## 3.33 Principios Definitivos de Administración SaaS

La administración de ComanView deberá respetar los siguientes principios:

### 1. Cloud administra; Edge opera

El Super Admin controla el servicio, pero no participa en cada venta.

### 2. Offline no equivale a impago

La falta de comunicación no puede producir una suspensión automática.

### 3. Licencias verificables localmente

El Edge debe poder validar de forma segura su licencia sin consultar Cloud constantemente.

### 4. Entitlements y Feature Flags son conceptos distintos

Una función técnica no constituye necesariamente un producto comercial.

### 5. Suspensión controlada

Una deuda confirmada podrá limitar el servicio, pero nunca deberá interrumpir arbitrariamente una jornada activa.

### 6. Cierre de Turno Garantizado

Una suspensión recibida durante operación activa entra plenamente en vigor después del cierre del turno correspondiente.

### 7. Bloqueo en nueva Apertura de Caja

Una licencia suspendida no podrá iniciar una nueva jornada salvo reactivación válida.

### 8. Administración restringida durante suspensión

Los paneles de configuración permanecerán bloqueados.

### 9. Push no es suficiente

Toda configuración remota deberá poder recuperarse también mediante Pull y versionado.

### 10. Monitoreo y analítica son capas diferentes

El diagnóstico técnico no debe mezclarse innecesariamente con información comercial.

### 11. OTA debe ser reversible

Toda actualización deberá contemplar Health Check y rollback.

### 12. Actualizaciones fuera del camino crítico

El software no deberá actualizarse automáticamente durante servicio activo.

### 13. Acceso remoto limitado

El Super Admin deberá ejecutar únicamente operaciones remotas predefinidas.

### 14. Administración auditada

Toda modificación sensible deberá dejar trazabilidad.

## 3.34 Regla Arquitectónica Central

El Super Admin tendrá autoridad sobre la administración del servicio, pero deberá respetar la continuidad operacional del establecimiento.

La regla central será:

ComanView puede controlar quién tiene derecho a utilizar el servicio, pero ese control nunca debe transformar una incidencia de Internet, sincronización, cobro o actualización en una interrupción inesperada de una jornada activa.

Esta separación entre control comercial y continuidad operacional será uno de los principios fundamentales de la plataforma.

# 4. Flujos Visuales, UX/UI y Experiencia Operativa

## 4.1 Objetivo General de UX

ComanView deberá diseñarse para operar en ambientes de alta velocidad, ruido, presión y atención simultánea a múltiples tareas.

La experiencia de usuario deberá priorizar:

Rapidez de operación.

Claridad visual.

Reducción de pasos innecesarios.

Interacción táctil.

Baja dependencia del teclado.

Confirmaciones únicamente en acciones sensibles.

Información crítica siempre visible.

Interfaces adaptadas al rol y dispositivo.

El principio general será:

**Cada usuario deberá ver únicamente la información y acciones necesarias para realizar su trabajo con la menor fricción posible.**

ComanView no utilizará una única interfaz universal para todos los roles.

## 4.2 Superficies Operativas de V1

La V1 contará con tres interfaces operativas principales:

### POS / Caja

Destinada principalmente a:

Cajeros.

Gerentes.

Dueños.

Personal autorizado para cobrar.

### Comandería Móvil

Destinada principalmente a:

Meseros.

Personal de piso.

Personal autorizado para tomar órdenes.

### KDS — Kitchen Display System

Destinada principalmente a:

Cocina.

Barra.

Postres.

Otras estaciones de preparación.

Las tres interfaces compartirán el mismo estado operacional a través del Edge, pero deberán presentar flujos específicos para cada contexto.

## 4.3 Principios Visuales

Las interfaces operativas deberán utilizar:

Botones de tamaño adecuado para interacción táctil.

Tipografía claramente legible.

Alto contraste.

Jerarquías visuales claras.

Estados fácilmente identificables.

Distribución consistente de acciones principales.

Navegación mínima durante tareas críticas.

Las acciones frecuentes deberán requerir la menor cantidad posible de pasos.

Las acciones sensibles deberán distinguirse claramente de las acciones normales.

## 4.4 Estados Visuales y Accesibilidad

Los estados no deberán comunicarse únicamente mediante color.

Cada estado importante deberá utilizar una combinación de:

Color.

Texto.

Icono cuando aplique.

**Ejemplo:**

Mesa 12

LISTA

en lugar de mostrar únicamente una mesa de determinado color.

Esta regla deberá aplicarse especialmente a:

Estados de mesa.

Estados de órdenes.

Estados del KDS.

Estado de conectividad.

Alertas.

Estados de pago.

Esto mejorará la accesibilidad y reducirá errores de interpretación.

## 4.5 POS — Pantalla de Venta Rápida

El POS deberá estar optimizado para ventas directas de mostrador y operaciones de caja rápidas.

La estructura base podrá utilizar una distribución de tres áreas principales:

```text
┌────────────┬──────────────────────┬─────────────────────┐
```

```text
│ Categorías │      Productos       │    Venta actual     │
```

```text
│            │                      │                     │
```

```text
│ Tacos      │ [Taco] [Quesadilla] │ 2 Taco      $40     │
```

```text
│ Bebidas    │ [Agua] [Refresco]   │ 1 Refresco  $25     │
```

```text
│ Postres    │                      │                     │
```

```text
│            │                      │ Total        $65    │
```

```text
│            │                      │                     │
```

```text
│            │                      │     [ COBRAR ]      │
```

```text
└────────────┴──────────────────────┴─────────────────────┘
```

La interfaz deberá funcionar correctamente mediante:

Pantalla táctil.

Mouse.

Teclado cuando aplique.

## 4.6 Flujo de Venta de Mostrador

```text
El flujo estándar será:
```

```text
Nueva venta
```

```text
↓
```

```text
Seleccionar productos
```

```text
↓
```

```text
Completar modificadores
```

```text
↓
```

```text
Revisar orden
```

```text
↓
```

```text
COBRAR
```

```text
↓
```

```text
Seleccionar método(s) de pago
```

```text
↓
```

```text
Agregar propina si aplica
```

```text
↓
```

```text
Confirmar
```

```text
↓
```

```text
Registrar pago
```

```text
↓
```

```text
Imprimir / generar ticket
```

```text
↓
```

```text
Cerrar orden
```

```text
↓
```

```text
Nueva venta
```

El sistema no deberá obligar al cajero a navegar entre múltiples pantallas innecesarias para completar una venta.

## 4.7 Tipos de Orden

El modelo deberá contemplar desde V1 distintos tipos de orden.

Como mínimo:

COUNTER

TABLE

TAKEOUT

### COUNTER

Venta directa de mostrador.

```text
Flujo típico:
```

```text
Orden
```

```text
→ Productos
```

```text
→ Pago
```

```text
→ Cierre
```

### TABLE

Orden asociada a una mesa.

```text
Flujo típico:
```

```text
Mesa
```

```text
→ Orden
```

```text
→ Comandas
```

```text
→ Preparación
```

```text
→ Precuenta
```

```text
→ Pago
```

```text
→ Cierre
```

### TAKEOUT

Orden para llevar.

Podrá compartir inicialmente gran parte del flujo de mostrador, pero deberá mantenerse como tipo independiente para permitir futuras extensiones.

### Canal de origen

La interfaz MAY mostrar o utilizar order_channel cuando sea relevante, pero MUST NOT confundirlo con order_type. En V1 los canales operativos son POS y WAITER; los canales públicos quedan preparados para versiones posteriores.

## 4.8 Catálogo y Navegación de Productos

Los productos deberán organizarse principalmente mediante categorías.

**Ejemplo:**

Entradas

Platos fuertes

Tacos

Bebidas

Postres

La selección deberá requerir pocos pasos.

El diseño deberá soportar:

Texto.

Imágenes opcionales.

Precios.

Estados de disponibilidad.

Modificadores.

La ausencia de imágenes no deberá afectar la usabilidad del catálogo.

## 4.9 Modelo de Modificadores

Los productos podrán utilizar grupos de modificadores.

Cada grupo deberá permitir definir reglas como:

Selección obligatoria.

Selección opcional.

Cantidad mínima.

Cantidad máxima.

Selección única.

Selección múltiple.

Cambio de precio.

**Ejemplo:**

TÉRMINO DE CARNE

Selecciona exactamente 1

○ Medio

○ 3/4

○ Bien cocido

Otro ejemplo:

EXTRAS

Selecciona máximo 3

□ Queso +$15

□ Aguacate +$20

□ Tocino +$25

Cuando un grupo sea obligatorio, el producto no deberá poder agregarse correctamente a la orden hasta completar las selecciones requeridas.

## 4.10 Gestión de Mesas

El módulo de mesas utilizará inicialmente un modelo basado en:

```text
Zonas + Grid configurable
```

**Ejemplo:**

SALÓN

[M1] [M2] [M3] [M4]

[M5] [M6] [M7] [M8]

TERRAZA

[T1] [T2] [T3]

Las zonas podrán representar:

Salón.

Terraza.

Barra.

Patio.

Piso superior.

Otras áreas.

V1 no requerirá un editor gráfico libre de plano arquitectónico.

Un editor avanzado mediante drag-and-drop podrá incorporarse posteriormente.

## 4.11 Estados de Mesa

Como mínimo deberán existir estados conceptuales equivalentes a:

FREE

OPEN

READY

PAYMENT_REQUESTED

ALERT

### FREE

Mesa disponible.

### OPEN

Mesa con una orden activa.

### READY

Existe preparación lista para servir.

### PAYMENT_REQUESTED

La mesa solicitó cuenta o se encuentra en proceso de pago.

### ALERT

Existe una condición que requiere atención.

Los nombres mostrados al usuario podrán adaptarse al idioma y contexto.

## 4.12 Flujo de Mesa

```text
El flujo general será:
```

```text
Mesa libre
```

```text
↓
```

```text
Abrir mesa
```

```text
↓
```

```text
Crear orden
```

```text
↓
```

```text
Agregar productos
```

```text
↓
```

```text
Enviar comanda
```

```text
↓
```

```text
Agregar nuevas rondas cuando sea necesario
```

```text
↓
```

```text
Preparación
```

```text
↓
```

```text
Servicio
```

```text
↓
```

```text
Precuenta
```

```text
↓
```

```text
Pago
```

```text
↓
```

```text
Cerrar orden
```

```text
↓
```

```text
Liberar mesa
```

La mesa no deberá quedar disponible nuevamente hasta que la orden haya finalizado correctamente.

## 4.13 Comandería Móvil — Tablet

En tablets se utilizará preferentemente una distribución de tres columnas:

```text
┌───────────┬────────────────┬────────────────┐
```

```text
│ Categorías│   Productos    │    Comanda     │
```

```text
│           │                │                │
```

```text
│ Entradas  │ [Producto]     │ Taco x2        │
```

```text
│ Fuertes   │ [Producto]     │ Agua x1        │
```

```text
│ Bebidas   │ [Producto]     │                │
```

```text
│           │                │ [ ENVIAR ]     │
```

```text
└───────────┴────────────────┴────────────────┘
```

La interfaz deberá permitir al mesero:

Seleccionar mesa.

Consultar orden abierta.

Agregar productos.

Modificar cantidades.

Completar modificadores.

Consultar subtotal.

Enviar productos a preparación.

Consultar productos enviados.

Ver estado de preparación.

Solicitar precuenta.

## 4.14 Comandería Móvil — Smartphone

En smartphones no se deberá intentar replicar el layout de tres columnas.

La interfaz deberá adaptarse a navegación vertical o por vistas.

```text
Ejemplo:
```

```text
Categorías
```

```text
↓
```

```text
Productos
```

```text
↓
```

```text
Comanda
```

La comanda deberá permanecer accesible mediante un botón persistente o elemento equivalente.

La funcionalidad deberá mantenerse, aunque la distribución visual cambie.

## 4.15 Estado Draft vs. Sent

Los productos de una orden deberán diferenciarse claramente entre:

### DRAFT

Producto agregado a la orden pero todavía no enviado a preparación.

Mientras se encuentre en Draft, el usuario autorizado podrá normalmente:

Cambiar cantidad.

Modificar opciones.

Eliminarlo.

### SENT

Producto que ya fue enviado a cocina, barra u otra estación.

Una vez enviado, cualquier modificación deberá considerarse una operación sensible.

Modificar o eliminar un ítem SENT deberá poder requerir:

Motivo.

Permiso.

PIN de autorización.

Evento de auditoría.

Notificación o cancelación hacia la estación correspondiente.

## 4.16 Rondas / Comandas

Una orden podrá generar múltiples envíos de productos a preparación.

**Ejemplo:**

Mesa 4

Ronda 1 — 20:10

2 Tacos

1 Agua

Ronda 2 — 20:28

2 Cervezas

Ronda 3 — 20:46

1 Pastel

El sistema deberá conservar qué productos fueron enviados juntos y en qué momento.

Esto será importante para:

KDS.

Impresión.

Auditoría.

Reimpresiones.

Control de tiempos.

Cancelaciones.

La implementación técnica podrá utilizar una entidad específica de ronda/comanda o un mecanismo equivalente, siempre que preserve esta relación.

## 4.17 Envío a Preparación

La acción:

ENVIAR A COCINA

representará una transición operacional formal.

```text
El flujo será:
```

```text
Ítems DRAFT
```

```text
↓
```

```text
Validación
```

```text
↓
```

```text
Creación de ronda/comanda
```

```text
↓
```

```text
Ítems pasan a SENT
```

```text
↓
```

```text
Enrutamiento por estación
```

```text
↓
```

```text
KDS / Impresora
```

```text
↓
```

```text
Evento registrado
```

Una vez confirmado el envío, no deberá ser tratado como una simple edición local del carrito.

## 4.18 Enrutamiento por Estación

Cada producto deberá poder asociarse a una estación.

```text
Ejemplo:
```

```text
Hamburguesa → Cocina
```

```text
Margarita → Barra
```

```text
Pastel → Postres
```

Una misma orden podrá dividirse automáticamente entre múltiples estaciones.

**Ejemplo:**

Mesa 8

2 Hamburguesas

2 Margaritas

1 Pastel

se transformará en:

COCINA

2 Hamburguesas

BARRA

2 Margaritas

POSTRES

1 Pastel

Todos los elementos seguirán perteneciendo a la misma orden principal.

## 4.19 Configuración de Salida por Estación

Cada estación podrá definir cómo recibe sus comandas.

Como mínimo:

```text
KDS
```

```text
PRINTER
```

```text
KDS + PRINTER
```

Esto permitirá distintas configuraciones comerciales y operativas.

Ejemplos:

### Puesto pequeño

```text
Cocina → PRINTER
```

### Restaurante digital

```text
Cocina → KDS
```

### Restaurante con redundancia

```text
Cocina → KDS + PRINTER
```

KDS e impresión no serán mutuamente excluyentes.

## 4.20 KDS — Estructura General

El KDS utilizará un formato de carril de tickets o estructura equivalente optimizada para pantallas de preparación.

Cada ticket podrá mostrar:

Mesa o tipo de orden.

Identificador de orden.

Mesero.

Hora de envío.

Tiempo transcurrido.

Productos correspondientes a la estación.

Modificadores.

Prioridad.

Estado.

La presentación deberá priorizar legibilidad a distancia.

## 4.21 Estados de Preparación

Cada ítem del KDS deberá manejar como mínimo:

PENDING

PREPARING

READY

### PENDING

El ítem se encuentra esperando preparación.

### PREPARING

La estación ha iniciado su preparación.

### READY

El ítem está terminado.

El estado de una ronda u orden podrá derivarse del estado de sus productos.

## 4.22 Interacción del KDS

El personal autorizado deberá poder:

Iniciar preparación.

Marcar ítems como listos.

Completar todos los elementos correspondientes.

Consultar tickets activos.

Consultar historial operativo básico.

La interacción deberá estar optimizada para pantalla táctil.

## 4.23 Control de Tiempos

Cada ticket deberá mostrar el tiempo transcurrido desde su envío.

Los umbrales no deberán estar hardcoded de forma universal.

Deberán poder configurarse por estación.

**Ejemplo:**

COCINA

Normal:

0–10 min

Advertencia:

10–15 min

Crítico:

>15 min

Otro ejemplo:

BARRA

Normal:

0–5 min

Advertencia:

5–8 min

Crítico:

>8 min

La configuración futura podrá ampliarse por categoría o producto.

## 4.24 Prioridad

El KDS deberá contemplar como mínimo:

NORMAL

HIGH

El acceso a prioridad elevada deberá estar restringido mediante permisos.

No todos los usuarios deberán poder convertir arbitrariamente una orden en prioritaria.

El uso deberá quedar sujeto a auditoría cuando sea necesario.

## 4.25 Notificación de Orden Lista

Cuando todos los elementos relevantes de una orden o ronda estén preparados, el Edge deberá poder emitir una actualización en tiempo real a los dispositivos correspondientes.

**Ejemplo:**

Mesa 12

PEDIDO LISTO

La comunicación dentro de LAN podrá utilizar mecanismos como WebSocket.

V1 no requerirá necesariamente servicios Push externos para smartphones.

## 4.26 Precuenta

La precuenta deberá ser una acción independiente del pago.

```text
El flujo será:
```

```text
Orden abierta
```

```text
↓
```

```text
Generar / solicitar precuenta
```

```text
↓
```

```text
Mesa → PAYMENT_REQUESTED
```

```text
↓
```

```text
Orden continúa abierta
```

La generación de precuenta no deberá cerrar la orden.

La intención operacional `Solicitar cuenta` y la impresión `PRECHECK` se mantendrán separadas. Una
impresión de precuenta aislada no activará necesariamente `PAYMENT_REQUESTED`; ese estado derivado
requiere registrar explícitamente `payment_requested_at`.

## 4.27 Flujo de Pago

Cuando el usuario seleccione COBRAR, deberá mostrarse una interfaz clara con:

Total pendiente.

Métodos de pago.

Cantidades.

Propina cuando esté habilitada.

Saldo restante.

La orden deberá poder recibir múltiples pagos.

## 4.28 Múltiples Pagos

Una orden no deberá estar limitada a un único método de pago.

```text
El modelo deberá permitir:
```

```text
ORDER
```

```text
└── PAYMENTS
```

```text
├── Payment 1
```

```text
├── Payment 2
```

```text
└── Payment N
```

**Ejemplo:**

Total: $1,000

```text
$500 → Efectivo
```

```text
$500 → Tarjeta
```

La orden se considerará pagada cuando la suma válida de pagos cubra el total requerido.

## 4.29 Pagos Mixtos

V1 deberá soportar pagos mixtos.

Ejemplos:

$300 Efectivo

$700 Tarjeta

o:

$250 Tarjeta 1

$250 Tarjeta 2

$500 Efectivo

Cada pago deberá registrarse individualmente para efectos de:

Corte de caja.

Auditoría.

Reportes.

Conciliación.

## 4.30 División de Cuenta

V1 soportará al menos dos modalidades.

### División por productos

El usuario podrá asignar productos específicos a pagos separados.

**Ejemplo:**

Persona A

2 Tacos

1 Cerveza

Persona B

1 Hamburguesa

1 Refresco

### División en partes iguales

El total podrá dividirse entre un número definido de personas.

**Ejemplo:**

Total: $1,200

```text
4 personas
```

```text
→ $300 cada una
```

Las reglas avanzadas de reparto podrán incorporarse posteriormente.

## 4.31 Propinas

La propina formará parte de V1 a nivel transaccional de cobro.

La funcionalidad deberá ser activable o desactivable por establecimiento mediante configuración.

Cuando esté desactivada:

La pantalla de pago no deberá mostrar controles de propina.

El flujo de cobro continuará normalmente.

Cuando esté habilitada, el usuario autorizado podrá agregar propina mediante:

### Porcentaje

Como referencia inicial:

10%

15%

20%

Los porcentajes podrán definirse como opciones configurables.

### Monto manual

El usuario podrá introducir un importe específico.

**Ejemplo:**

Subtotal / consumo: $800

Propina:             $120

Total cobrado:       $920

## 4.32 Propina y Registro Transaccional

La propina deberá registrarse separadamente del importe de consumo.

**Conceptualmente:**

SALE_AMOUNT

TIP_AMOUNT

TOTAL_PAID

Esto será especialmente importante para conciliación con pagos mediante terminal bancaria.

**Ejemplo:**

Consumo: $850

Propina: $150

Voucher terminal:

$1,000

ComanView deberá registrar exactamente:

Venta:    $850

Propina:  $150

Tarjeta: $1,000

Esto permitirá que el Corte Z cuadre con los importes reales cobrados.

## 4.33 Propina en Pagos Mixtos

La arquitectura deberá permitir relacionar correctamente la propina con los pagos correspondientes.

**Ejemplo:**

Consumo:

$1,000

Propina:

$150

Pagos:

$500 Efectivo

$650 Tarjeta

El total recibido será:

$1,150

La estructura definitiva deberá conservar la separación entre:

Consumo.

Propina.

Método de pago.

## 4.34 Distribución de Propinas

V1 no incluirá:

Reparto entre meseros.

Pool de propinas.

Distribución por turnos.

Porcentajes para cocina.

Liquidación individual.

Estas capacidades quedan definidas para una versión posterior.

V1 únicamente deberá registrar correctamente la propina transaccional.

## 4.35 Cierre de Orden

Una orden deberá cerrarse únicamente cuando:

Los pagos correspondientes hayan sido registrados.

El saldo pendiente sea cero o se cumpla la regla de cierre permitida.

Las validaciones operativas necesarias hayan sido completadas.

```text
Para mesas:
```

```text
PAYMENT_COMPLETED
```

```text
↓
```

```text
ORDER_CLOSED
```

```text
↓
```

```text
TABLE_FREE
```

El cierre deberá generar los eventos y registros correspondientes.

## 4.36 Cancelaciones y Modificaciones

El comportamiento dependerá del estado del elemento.

### Producto Draft

Podrá modificarse o eliminarse normalmente por un usuario autorizado.

### Producto Sent

Su cancelación deberá poder requerir:

Motivo.

Autorización.

PIN.

Audit Log.

Aviso a cocina/barra.

Ticket de cancelación cuando aplique.

### Orden pagada

No deberá modificarse mediante el flujo normal de operación.

Correcciones posteriores deberán gestionarse mediante procedimientos administrativos independientes y auditables.

## 4.37 Confirmaciones de Seguridad

Las confirmaciones no deberán utilizarse indiscriminadamente.

No se deberá mostrar:

“¿Está seguro?”

para acciones rutinarias.

Las confirmaciones deberán reservarse para operaciones como:

Eliminar un ítem enviado.

Cancelar una orden.

Aplicar determinadas cortesías.

Ejecutar acciones protegidas.

Cerrar caja.

Corte Z.

Operaciones administrativas sensibles.

Esto reducirá la fatiga de confirmación.

## 4.38 Estado de Conectividad

La interfaz deberá diferenciar claramente entre dos situaciones.

### Internet Offline

Cuando el Edge funcione correctamente pero no exista Internet:

OFFLINE

Operando localmente

Este estado deberá comunicarse de forma informativa y no alarmante.

La operación podrá continuar normalmente.

### Edge No Disponible

Cuando el dispositivo no pueda comunicarse con el Edge:

CONEXIÓN LOCAL PERDIDA

Este estado será crítico, ya que el dispositivo no podrá completar operaciones normales.

La interfaz deberá evitar confundir ambos escenarios.

## 4.39 Respuesta ante Pérdida del Edge

Cuando una interfaz pierda conexión con el Edge deberá:

Informar claramente el problema.

Evitar confirmar operaciones no persistidas.

Intentar reconexión.

Conservar temporalmente estado visual cuando sea seguro.

No asumir que una operación fue completada si no recibió ACK del Edge.

La recuperación detallada se definirá técnicamente durante la implementación.

## 4.40 Tiempo Real dentro de LAN

Las interfaces operativas deberán poder recibir cambios relevantes en tiempo real desde el Edge.

Ejemplos:

Nueva comanda en KDS.

Producto preparado.

Orden lista.

Mesa actualizada.

Orden modificada.

Cancelación autorizada.

La implementación podrá utilizar WebSocket o tecnología equivalente dentro de la LAN.

La operación básica no deberá depender de servicios Push externos de Internet.

## 4.41 Persistencia y Feedback Visual

La UI solo deberá mostrar una operación como confirmada después de recibir la confirmación correspondiente del Edge.

```text
Ejemplo:
```

```text
Usuario presiona ENVIAR
```

```text
↓
```

```text
Edge persiste
```

```text
↓
```

```text
Edge registra evento
```

```text
↓
```

```text
Edge responde ACK
```

```text
↓
```

```text
UI marca la comanda como SENT
```

Esto evitará inconsistencias entre lo que el usuario ve y lo que realmente quedó almacenado.

## 4.42 Estados de Procesamiento

Cuando una operación tarde más de lo esperado, la UI deberá mostrar estados claros.

**Ejemplo:**

ENVIANDO...

seguido de:

ENVIADO

o:

ERROR — REINTENTAR

La interfaz no deberá permitir múltiples envíos accidentales por presión repetida del mismo botón.

## 4.43 Diseño por Rol

La interfaz deberá respetar los permisos definidos por RBAC.

**Ejemplo:**

### Mesero

Podrá ver principalmente:

Mesas.

Comandas.

Productos.

Estado de preparación.

### Cajero

Podrá ver principalmente:

POS.

Cobros.

Caja.

Tickets.

### Cocinero

Podrá ver principalmente:

KDS.

Tickets.

Estados de preparación.

### Gerente

Podrá acceder a:

Operación.

Autorizaciones.

Acciones sensibles.

Determinados reportes/configuraciones.

### Dueño

Podrá acceder a:

Administración.

Reportes.

Configuración autorizada.

El detalle definitivo de permisos se consolidará en la sección de Seguridad y RBAC.

## 4.44 Responsividad

Las interfaces deberán diseñarse por contexto de dispositivo.

No deberá asumirse que una misma composición visual funciona correctamente en:

PC.

Terminal táctil.

Tablet.

Smartphone.

Pantalla KDS.

La funcionalidad podrá compartirse, pero cada interfaz deberá adaptarse al tamaño y tipo de interacción.

## 4.45 Alcance UX/UI de V1

V1 deberá incluir como mínimo:

### POS

Venta rápida.

Categorías.

Productos.

Modificadores.

Carrito/orden.

Cobro.

Múltiples pagos.

Pagos mixtos.

Propina configurable.

Ticket.

Integración con caja.

### Mesas

Zonas.

Grid.

Estados.

Apertura.

Orden activa.

Precuenta.

Cierre.

### Comandería

Tablet.

Smartphone.

Selección de productos.

Modificadores.

Draft/Sent.

Rondas.

Envío a preparación.

Estado de órdenes.

### KDS

Estaciones.

Tickets.

PENDING.

PREPARING.

READY.

Cronómetros.

Prioridad.

Historial básico.

Aviso de orden lista.

### Pagos

División por productos.

División en partes iguales.

Múltiples pagos.

Métodos mixtos.

Propinas.

### Estado Técnico

Indicador Offline.

Estado del Edge.

Feedback de persistencia.

Reconexión.

## 4.46 Capacidades UX Posteriores

Podrán incorporarse en versiones futuras:

Editor visual avanzado de planos.

Reservaciones.

Lista de espera.

Pedidos QR desde mesa.

Customer Display.

Delivery.

Integraciones con agregadores.

Loyalty.

Gestión avanzada de propinas.

Distribución de propinas.

Personalización visual avanzada.

Atajos por comportamiento de usuario.

Analítica operacional del KDS.

## 4.47 Principios Definitivos de Experiencia Operativa

La experiencia de ComanView deberá respetar los siguientes principios:

### 1. Cada rol tiene una interfaz apropiada

No todos los usuarios necesitan acceder al mismo sistema visual.

### 2. Las tareas frecuentes deben ser rápidas

Tomar una orden o cobrar no deberá requerir navegación innecesaria.

### 3. Draft y Sent son estados diferentes

Enviar un producto a preparación cambia su naturaleza operacional.

### 4. Una orden puede tener múltiples rondas

El sistema deberá representar cómo funciona realmente el servicio de restaurante.

### 5. KDS opera por ítems y estaciones

No toda la orden se prepara simultáneamente ni en el mismo lugar.

### 6. KDS e impresión son complementarios

Cada establecimiento podrá configurar la combinación adecuada.

### 7. Precuenta no significa pago

La orden continúa abierta hasta que la transacción haya concluido.

### 8. Una orden puede tener múltiples pagos

Los pagos parciales y mixtos forman parte del modelo desde V1.

### 9. La propina es una entidad transaccional separada

Debe poder conciliarse con los pagos y con el Corte Z.

### 10. La propina es configurable

Cada establecimiento podrá activar o desactivar esta capacidad.

### 11. Color no es suficiente

Los estados deberán comunicar también texto o iconografía.

### 12. Internet Offline es un estado normal

La interfaz deberá comunicarlo sin generar una falsa percepción de fallo.

### 13. Edge Offline es un problema crítico

Debe diferenciarse claramente de la falta de Internet.

### 14. El usuario solo ve éxito después de persistencia

La interfaz deberá esperar confirmación del Edge antes de considerar completada una operación.

### 15. Las acciones sensibles requieren contexto y control

Cancelaciones, modificaciones posteriores al envío y operaciones administrativas deberán quedar protegidas y auditadas.

## 4.48 Regla Central de UX

Toda decisión visual u operativa deberá evaluarse mediante una pregunta:

**¿Esta interfaz permite que la persona complete correctamente su tarea con rapidez, bajo presión y con la menor posibilidad de cometer un error?**

Si una función agrega complejidad visual sin mejorar significativamente la operación, deberá reconsiderarse o mantenerse fuera del flujo principal.

# 5. Arquitectura de Impresión Local — ESC/POS, Print Queues y Fallback

## 5.1 Objetivo General

La arquitectura de impresión de ComanView deberá garantizar que comandas, precuentas, recibos, cancelaciones y reportes puedan imprimirse de forma local, confiable y trazable, sin depender de Internet.

El Servidor Edge será la autoridad responsable de administrar toda la impresión dentro del establecimiento.

Los dispositivos operativos, como tablets, smartphones, terminales POS y pantallas KDS, no deberán comunicarse directamente con las impresoras.

El principio central será:

**Toda impresión será tratada como un trabajo persistente, trazable y recuperable, no como un simple envío de datos hacia una impresora.**

Esto permitirá manejar correctamente fallos de hardware, problemas de red, reinicios, reintentos y mecanismos de respaldo.

## 5.2 Arquitectura General de Impresión

```text
El flujo conceptual será:
```

```text
POS / Tablet / Sistema
```

```text
↓
```

```text
Edge API
```

```text
↓
```

```text
Routing Engine
```

```text
↓
```

```text
Print Job
```

```text
↓
```

```text
Persistent Print Queue
```

```text
↓
```

```text
Print Worker
```

```text
↓
```

```text
Printer Adapter
```

```text
↓
```

```text
Impresora ESC/POS
```

Cada impresión deberá generarse, persistirse y procesarse dentro del Edge antes de intentar comunicarse con el hardware.

## 5.3 Responsabilidades del Print Manager

El Edge contará con un componente denominado conceptualmente Print Manager, responsable de:

Crear Print Jobs.

Mantener la cola de impresión.

Determinar la estación correspondiente.

Seleccionar la impresora física.

Aplicar plantillas.

Generar comandos ESC/POS.

Gestionar conexiones.

Ejecutar reintentos seguros.

Gestionar fallback.

Registrar errores.

Procesar reimpresiones.

Ejecutar comandos de corte.

Ejecutar apertura de cajón cuando corresponda.

Recuperar trabajos después de reinicios.

El Print Manager será independiente de las interfaces POS, Comandería y KDS.

## 5.4 Print Jobs Persistentes

Cada solicitud de impresión deberá convertirse en un Print Job identificado de forma única.

Un Print Job deberá persistirse en la base local antes de comenzar la transmisión.

Estructura conceptual:

print_job_id

tenant_id

location_id

station_id

printer_id

order_id

round_id

parent_job_id

job_type

payload

template_id

status

attempts

created_at

sent_at

completed_at

last_error

No todos los campos serán obligatorios para todos los tipos de trabajo.

La definición técnica definitiva se realizará durante el diseño de datos.

## 5.5 Estados de un Print Job

Los trabajos deberán manejar un ciclo de vida explícito.

Como mínimo:

PENDING

SENDING

DELIVERED

CONFIRMED

FAILED

UNKNOWN

CANCELLED

### PENDING

El trabajo existe y está esperando procesamiento.

### SENDING

El Print Worker está intentando transmitirlo.

### DELIVERED

Los datos fueron entregados satisfactoriamente al canal de comunicación correspondiente.

Esto no implica necesariamente que el papel haya salido físicamente.

### CONFIRMED

El hardware o protocolo proporcionó suficiente información para considerar confirmada la impresión.

Este estado solo podrá utilizarse cuando el modelo de impresora permita realizar dicha validación.

### FAILED

El sistema determinó que la transmisión no pudo completarse.

### UNKNOWN

El resultado físico es incierto.

**Ejemplo:**

Los datos pudieron haber llegado a la impresora, pero la conexión se perdió antes de obtener una confirmación suficiente.

### CANCELLED

El trabajo fue cancelado antes de su ejecución por una operación válida del sistema.

## 5.6 Persistencia Antes de Transmisión

```text
El sistema deberá respetar el siguiente orden:
```

```text
Operación confirmada
```

```text
↓
```

```text
Persistencia en DB
```

```text
↓
```

```text
Creación de Print Job
```

```text
↓
```

```text
Commit
```

```text
↓
```

```text
Print Queue
```

```text
↓
```

```text
Transmisión
```

```text
Nunca deberá utilizarse:
```

```text
Imprimir
```

```text
↓
```

```text
Guardar posteriormente
```

porque una falla entre ambas operaciones podría producir una comanda física sin que ComanView posea registro de ella.

La persistencia local será siempre anterior al intento de impresión.

## 5.7 Tipos de Print Job

Desde V1 deberán contemplarse diferentes tipos de trabajo.

Como mínimo:

KITCHEN_TICKET

BAR_TICKET

STATION_TICKET

CUSTOMER_RECEIPT

PRECHECK

CANCELLATION_TICKET

REPRINT

CASH_REPORT

Otros tipos podrán agregarse posteriormente sin modificar la arquitectura general.

## 5.8 Estaciones Lógicas

ComanView deberá separar el concepto de estación operacional del dispositivo físico de impresión.

Ejemplos:

COCINA

BARRA

POSTRES

CAJA

Una estación representa un destino lógico dentro del flujo del restaurante.

Los productos deberán asociarse a una estación, no directamente a una dirección IP o impresora específica.

```text
Ejemplo:
```

```text
Hamburguesa → COCINA
```

```text
Margarita   → BARRA
```

```text
Pastel      → POSTRES
```

## 5.9 Impresoras Físicas

Una impresora será un dispositivo concreto registrado en el establecimiento.

**Ejemplo:**

printer_id:

PRINTER-KITCHEN-01

name:

Epson Cocina

protocol:

TCP_ESC_POS

ip:

192.168.1.200

port:

9100

paper_width:

80mm

La estación podrá cambiar de impresora sin necesidad de modificar la configuración de cada producto.

## 5.10 Asignación Estación → Hardware

Cada estación deberá poder definir:

Impresora principal.

Impresora de respaldo.

Método de salida.

Plantilla.

Ancho de papel.

Configuración específica.

**Ejemplo:**

COCINA

Output:

```text
KDS + PRINTER
```

Primary Printer:

PRINTER-KITCHEN-01

Fallback Printer:

PRINTER-CASH-01

Esto desacoplará la lógica de negocio del hardware instalado.

## 5.11 Modalidades de Salida

Cada estación podrá utilizar:

```text
KDS
```

```text
PRINTER
```

```text
KDS + PRINTER
```

Ejemplos:

### Puesto pequeño

```text
COCINA → PRINTER
```

### Restaurante digital

```text
COCINA → KDS
```

### Restaurante con redundancia

```text
COCINA → KDS + PRINTER
```

La falla de una de estas salidas no deberá eliminar la orden del sistema.

## 5.12 Compatibilidad ESC/POS

ComanView utilizará ESC/POS como estándar principal para impresoras térmicas compatibles.

El objetivo será permitir reutilizar, siempre que sea técnicamente compatible, hardware existente del restaurante.

Esto incluye potencialmente impresoras de fabricantes como:

Epson.

Bixolon.

Star y otros fabricantes con modos compatibles.

Equipos genéricos que implementen comandos ESC/POS equivalentes.

Sin embargo, ComanView no asumirá que todos los dispositivos que anuncian compatibilidad ESC/POS implementan exactamente los mismos comandos.

Por ello se utilizarán:

Perfiles de impresora.

Printer Adapters.

Configuraciones específicas de encoding.

Capacidades detectadas o configuradas.

La compatibilidad deberá validarse por modelo y tipo de conexión cuando sea necesario.

## 5.13 Printer Adapters

La arquitectura deberá desacoplar el Print Manager del método físico de conexión mediante adaptadores.

Como mínimo se contemplarán conceptualmente:

TCP_ESC_POS

USB_ESC_POS

SYSTEM_DRIVER

V1 deberá priorizar oficialmente:

**TCP/IP mediante ESC/POS**

por su estabilidad, facilidad de administración y disponibilidad dentro de LAN.

La arquitectura deberá permitir incorporar USB sin modificar la lógica central del Print Manager.

## 5.14 Impresión TCP/IP

Para impresoras de red, el Edge podrá establecer comunicación mediante sockets TCP.

El puerto habitual podrá ser:

9100

pero deberá ser configurable.

**Ejemplo:**

192.168.1.200:9100

El Edge generará los comandos ESC/POS correspondientes y los enviará mediante el Printer Adapter.

## 5.15 Impresión USB

ComanView deberá contemplar compatibilidad con impresoras ESC/POS conectadas mediante USB cuando el sistema operativo y el modelo permitan una integración confiable.

USB no deberá implementarse mediante lógica duplicada.

El Printer Adapter correspondiente deberá presentar al Print Manager una interfaz común equivalente a la utilizada por impresoras TCP/IP.

Esto permitirá reutilizar impresoras existentes sin modificar el flujo funcional del sistema.

## 5.16 Limitaciones de Confirmación Física

Una comunicación exitosa con una impresora no siempre implica que el documento fue impreso físicamente.

Pueden existir situaciones como:

Falta de papel.

Tapa abierta.

Atasco.

Corte incompleto.

Buffer interno.

Pérdida de conexión posterior.

Modelos sin reporte avanzado de estado.

Por esta razón:

**ComanView no deberá considerar automáticamente que transmisión exitosa equivale a impresión física confirmada.**

El nivel de certeza dependerá de las capacidades del hardware utilizado.

## 5.17 Estado de Impresora

Cuando el hardware lo permita, el sistema podrá representar estados como:

ONLINE

OFFLINE

PAPER_OUT

COVER_OPEN

ERROR

UNKNOWN

No todos los modelos proporcionarán todos los estados.

La arquitectura deberá funcionar incluso con impresoras que solo permitan conocer si la conexión está disponible.

## 5.18 Política de Reintentos

Los reintentos deberán diseñarse para evitar duplicados físicos.

El Print Manager deberá diferenciar entre:

### Fallo antes de transmisión

**Ejemplo:**

La conexión no pudo establecerse.

En este caso, un reintento automático suele ser seguro.

### Fallo durante o después de transmisión

**Ejemplo:**

Parte o totalidad de los bytes pudieron haber llegado a la impresora, pero la respuesta final es incierta.

En este caso, un reintento automático podría generar una segunda impresión.

El sistema deberá poder clasificar el trabajo como:

UNKNOWN

y aplicar la política configurada correspondiente.

## 5.19 Número de Intentos

Los trabajos podrán manejar una cantidad limitada de intentos automáticos.

```text
Ejemplo conceptual:
```

```text
Attempt 1
```

```text
→ FAILED
```

```text
Attempt 2
```

```text
→ FAILED
```

```text
Attempt 3
```

```text
→ FAILED
```

Status:

FAILED

El número y los intervalos deberán ser configurables.

La cola no deberá bloquearse completamente debido a un único trabajo fallido.

## 5.20 Fallback de Impresoras

Cada estación podrá tener una impresora secundaria.

Si la impresora principal presenta un fallo confirmado antes de transmisión efectiva:

```text
Primary Printer
```

```text
↓
```

```text
FAILED
```

```text
↓
```

```text
Fallback Printer
```

El Print Job lógico deberá conservar su identidad y registrar el cambio de destino.

**Ejemplo:**

JOB-123

Primary:

PRINTER-KITCHEN-01

FAILED

Fallback:

PRINTER-CASH-01

DELIVERED

El fallback no deberá crear una impresión sin relación con el trabajo original.

## 5.21 Alertas de Fallback

Cuando una comanda sea reenrutada, ComanView deberá informar al personal correspondiente.

**Ejemplo:**

Impresora de Cocina no disponible.

La comanda fue enviada a:

Impresora de Caja.

La alerta deberá identificar claramente:

Estación afectada.

Impresora con falla.

Destino alternativo.

## 5.22 Fallo Total de Impresión

Si ninguna impresora válida puede procesar un trabajo:

NO SE PUDO IMPRIMIR LA COMANDA

deberá mostrarse una alerta persistente.

El sistema deberá:

Mantener el Print Job.

Registrar el error.

Permitir intervención.

Permitir reintento.

Utilizar KDS cuando esté disponible.

La comanda no deberá desaparecer del sistema.

## 5.23 KDS como Respaldo Operacional

Cuando una estación tenga configurado:

```text
KDS + PRINTER
```

una falla física de impresión no deberá provocar pérdida de visibilidad de la orden.

```text
Ejemplo:
```

```text
Printer → FAILED
```

```text
KDS → ACTIVE
```

La preparación puede continuar mediante KDS mientras se informa del problema de impresión.

Esto constituye redundancia operacional, no equivalencia universal.

Un establecimiento configurado únicamente con impresoras continuará dependiendo de que exista al menos un destino físico funcional.

## 5.24 Recuperación tras Reinicio del Edge

La Print Queue deberá persistir en la base local.

Después de un reinicio, el Edge deberá recuperar trabajos no finalizados.

```text
Ejemplo:
```

```text
PENDING
```

```text
→ puede reanudarse
```

Sin embargo:

SENDING

encontrado después de un reinicio deberá considerarse potencialmente incierto.

El sistema podrá transformarlo en:

UNKNOWN

o un estado equivalente de revisión.

No deberá reenviarlo silenciosamente si existe riesgo de duplicado físico.

## 5.25 Idempotencia

Cada Print Job deberá utilizar un identificador único.

Si una misma solicitud lógica vuelve a llegar debido a:

Doble click.

Timeout del cliente.

Reconexión.

Reintento de API.

el Edge deberá detectar la operación y evitar crear duplicados no deseados.

**Ejemplo:**

```text
print_job_id = JOB-123
```

El mismo trabajo lógico no deberá ejecutarse dos veces únicamente porque la petición fue recibida nuevamente.

## 5.26 Reimpresiones

Una reimpresión será un Print Job nuevo relacionado con el original.

**Ejemplo:**

Original:

JOB-123

Reprint:

JOB-827

parent_job_id:

JOB-123

La reimpresión deberá poder incluir una leyenda visible:

*** REIMPRESIÓN ***

Esto permitirá distinguirla de la impresión original.

## 5.27 Permisos y Auditoría de Reimpresión

La reimpresión deberá estar sujeta a RBAC.

El Audit Log deberá registrar:

Usuario solicitante.

Documento.

Print Job original.

Motivo cuando aplique.

Fecha.

Hora.

Terminal utilizada.

Esto reducirá riesgos de fraude y confusión operacional.

## 5.28 Cancelaciones Posteriores al Envío

Cuando un producto ya enviado a preparación sea cancelado mediante una operación autorizada, el sistema deberá comunicarlo a la estación correspondiente.

Si la estación utiliza impresora, podrá generarse:

CANCELLATION_TICKET

**Ejemplo:**

*** CANCELACIÓN ***

MESA 8

1x HAMBURGUESA

Motivo:

Error de captura

Autorizó:

Gerente

Si existe KDS, el estado también deberá actualizarse digitalmente.

La cancelación deberá generar su correspondiente evento operacional y registro de auditoría.

## 5.29 Plantillas de Impresión

ComanView utilizará plantillas según el tipo de documento.

Como mínimo:

KITCHEN_TEMPLATE

BAR_TEMPLATE

STATION_TEMPLATE

RECEIPT_TEMPLATE

PRECHECK_TEMPLATE

CANCELLATION_TEMPLATE

CASH_REPORT_TEMPLATE

V1 deberá permitir configuración básica, pero no requerirá un diseñador visual completo.

## 5.30 Configuración Básica de Plantillas

Los parámetros configurables podrán incluir:

Nombre comercial.

Logo cuando la impresora lo soporte.

Encabezado.

Pie.

Datos fiscales/comerciales.

Campos visibles.

Ancho de papel.

Tamaño relativo de texto.

Información de mesa.

Mesero.

Orden.

Fecha/hora.

Las plantillas de cocina deberán priorizar legibilidad sobre estética.

## 5.31 Ticket de Cocina

Ejemplo conceptual:

MESA 08

RONDA 3

20:42

MESERO: ÁNGEL

2x HAMBURGUESA

SIN CEBOLLA

EXTRA QUESO

1x PAPAS

Los modificadores relevantes deberán resaltarse utilizando las capacidades soportadas por la impresora, como:

Negritas.

Doble ancho.

Subrayado.

Mayúsculas.

## 5.32 Formatos de Papel

V1 deberá soportar como mínimo:

58 mm

80 mm

La plantilla deberá adaptarse automáticamente o mediante configuración al ancho utilizado.

No deberá asumirse un número fijo de caracteres universal para todos los modelos.

## 5.33 Encoding y Caracteres

El Printer Adapter deberá manejar correctamente las capacidades de codificación de cada impresora.

Deberán contemplarse como mínimo:

Acentos.

Ñ.

Símbolos monetarios.

Caracteres especiales habituales.

No se deberá asumir que todas las impresoras ESC/POS aceptan UTF-8 directamente.

Cada perfil podrá definir:

Code page.

Encoding.

Mapeos específicos.

## 5.34 Corte de Papel

Cuando el modelo lo permita, el Print Manager podrá incluir comandos ESC/POS para:

Corte total.

Corte parcial.

El comportamiento deberá definirse por plantilla o tipo de trabajo.

```text
Ejemplo:
```

```text
KITCHEN_TICKET
```

```text
→ CUT
```

## 5.35 Apertura de Cajón

La apertura del cajón deberá considerarse una operación independiente de la impresión.

```text
Ejemplo válido:
```

```text
Pago efectivo confirmado
```

```text
↓
```

```text
OPEN_CASH_DRAWER
```

```text
Ejemplo no válido:
```

```text
PRECHECK
```

```text
→ no abre cajón
```

La apertura deberá estar sujeta a:

Permisos.

Eventos.

Auditoría cuando aplique.

Esto deberá coordinarse con la Sección 6 de Seguridad y RBAC.

## 5.36 Recibo de Cliente y Pago

El registro de un pago y la impresión del recibo deberán considerarse operaciones diferentes.

La regla será:

**Un fallo de impresión no deberá revertir un pago que ya fue persistido y confirmado.**

```text
Ejemplo:
```

```text
PAYMENT_COMPLETED
```

```text
↓
```

```text
RECEIPT PRINT JOB
```

```text
↓
```

```text
FAILED
```

La venta seguirá estando correctamente pagada.

El recibo podrá reimprimirse posteriormente.

## 5.37 Precuenta

La precuenta será procesada por el Print Manager de ComanView.

Su impresión no deberá:

Cerrar la orden.

Registrar un pago.

Abrir automáticamente el cajón.

La precuenta representa únicamente información provisional de consumo.

## 5.38 Terminales Bancarias / Datáfonos en V1

V1 no requerirá integración directa con terminales bancarias.

```text
El flujo será:
```

```text
ComanView
```

```text
→ calcula monto de pago
```

```text
Usuario
```

```text
→ captura monto en terminal bancaria
```

```text
Terminal bancaria
```

```text
→ procesa pago
```

```text
Terminal bancaria
```

```text
→ imprime voucher
```

```text
ComanView
```

```text
→ registra pago confirmado por el operador
```

El voucher bancario continuará siendo generado directamente por la terminal proporcionada por el banco o adquirente.

ComanView será responsable de imprimir:

Precuenta.

Ticket de venta.

Comandas.

Cancelaciones.

Reportes.

No será responsable en V1 de imprimir el voucher bancario.

## 5.39 Conciliación con Terminal Bancaria

Aunque no exista integración directa con la terminal en V1, ComanView deberá registrar correctamente el importe procesado.

**Ejemplo:**

Consumo:

$850

Propina:

$150

Total tarjeta:

$1,000

La terminal bancaria imprimirá un voucher por:

$1,000

y ComanView deberá registrar:

```text
SALE_AMOUNT = 850
```

```text
TIP_AMOUNT = 150
```

```text
PAYMENT_CARD = 1000
```

Esto permitirá que el Corte Z pueda conciliarse con los vouchers físicos de la terminal.

## 5.40 Impresión de Reportes de Caja

El Print Manager deberá poder imprimir documentos como:

CASH_REPORT

incluyendo posteriormente:

Corte X.

Corte Z.

Totales por forma de pago.

Propinas.

Movimientos.

Diferencias cuando aplique.

El contenido definitivo se establecerá en la sección correspondiente a Caja y reportes operativos.

## 5.41 Configuración de Impresoras

Los usuarios administrativos autorizados deberán poder registrar una impresora proporcionando información como:

Nombre

Protocolo

Dirección IP / USB

Puerto

Perfil ESC/POS

Ancho de papel

Estación

Impresora fallback

Estado

La configuración deberá realizarse localmente o mediante mecanismos administrativos autorizados.

## 5.42 Prueba de Impresora

Cada impresora configurada deberá permitir ejecutar una prueba.

**Ejemplo:**

[ IMPRIMIR PRUEBA ]

El ticket de prueba podrá mostrar:

Nombre de ComanView.

Printer ID.

Estación.

Fecha/hora.

Dirección.

Ancho.

Caracteres especiales.

Comandos básicos.

Esto facilitará instalación y soporte.

## 5.43 Compatibilidad de Hardware

ComanView deberá mantener una estrategia de compatibilidad basada en:

Protocolo.

Conexión.

Perfil.

Capacidades conocidas.

Podrá existir posteriormente una lista de:

SUPPORTED

PARTIALLY_SUPPORTED

UNVERIFIED

UNSUPPORTED

Esto será preferible a asumir compatibilidad universal con cualquier modelo ESC/POS.

La arquitectura buscará maximizar la reutilización de hardware existente de los clientes.

## 5.44 Telemetría de Impresión

El Edge podrá recopilar métricas técnicas como:

jobs_created

jobs_delivered

jobs_failed

jobs_unknown

fallbacks_used

reprints

average_delivery_time

Estas métricas podrán enviarse al Super Admin como información de diagnóstico.

No será necesario transmitir el contenido completo de cada ticket para realizar monitoreo técnico.

## 5.45 Seguridad de Impresión

Las operaciones sensibles deberán integrarse con RBAC.

Ejemplos:

Reimpresión.

Cancelación.

Apertura manual de cajón.

Cambio de impresora.

Cambio de fallback.

Modificación de templates.

Prueba administrativa.

Las acciones relevantes deberán generar Audit Log.

## 5.46 Alcance de V1

La arquitectura de impresión de V1 deberá incluir como mínimo:

### Print Manager

Creación de jobs.

Persistencia.

Queue.

Worker.

Estados.

Reintentos.

### Routing

Estaciones lógicas.

Impresora principal.

Fallback.

Enrutamiento por productos.

### ESC/POS

TCP/IP como método principal.

Arquitectura preparada para USB.

Perfiles básicos.

Encoding.

Corte.

Cajón.

### Documentos

Comanda.

Precuenta.

Recibo.

Cancelación.

Reimpresión.

Reportes de caja.

### Confiabilidad

Recuperación tras reinicio.

Idempotencia.

Manejo de estados inciertos.

Alertas.

Fallback.

### Configuración

Registro de impresoras.

Estación.

Ancho.

Perfil.

Prueba.

Fallback.

## 5.47 Capacidades Posteriores

Podrán agregarse posteriormente:

Diseñador visual avanzado de tickets.

Balanceo entre múltiples impresoras de la misma estación.

Impresión Bluetooth.

Descubrimiento automático avanzado.

Gestión remota de firmware.

Integraciones específicas con fabricantes.

Integración directa con terminales bancarias.

Impresión coordinada con Customer Display.

Telemetría avanzada de consumibles.

Administración centralizada de perfiles de hardware.

## 5.48 Principios Definitivos de Impresión

La arquitectura deberá respetar los siguientes principios:

### 1. Toda impresión es un Print Job

Nunca será simplemente un envío aislado de bytes.

### 2. Persistencia antes de transmisión

El trabajo deberá existir en la base antes de intentar imprimir.

### 3. Edge controla la impresión

Los dispositivos operativos no deberán conectarse directamente a impresoras.

### 4. Estación e impresora son conceptos separados

Los productos se enrutan hacia destinos lógicos.

### 5. ESC/POS será el estándar principal

La implementación deberá contemplar variaciones reales de hardware.

### 6. TCP/IP será el método preferido en V1

La arquitectura deberá permitir otros adapters.

### 7. Enviar datos no equivale necesariamente a impresión física

El estado deberá reflejar el nivel real de certeza disponible.

### 8. Los reintentos no deberán generar duplicados silenciosos

Los estados inciertos deberán manejarse explícitamente.

### 9. El fallback deberá ser trazable

Toda desviación hacia otra impresora deberá quedar registrada.

### 10. Reiniciar el Edge no debe perder la cola

Los Print Jobs deberán ser durables.

### 11. Reimpresión no es repetición invisible

Será un nuevo trabajo relacionado con el original.

### 12. Cancelaciones deberán comunicarse a preparación

Digitalmente, físicamente o por ambos medios.

### 13. KDS e impresión pueden actuar simultáneamente

La arquitectura permitirá redundancia.

### 14. Un fallo de recibo no anula un pago

Venta e impresión tendrán ciclos de vida independientes.

### 15. Los vouchers bancarios permanecen externos en V1

La terminal bancaria continuará procesándolos e imprimiéndolos.

### 16. ComanView debe maximizar reutilización de hardware existente

Sin prometer compatibilidad universal no verificada.

### 17. Las operaciones sensibles de impresión estarán protegidas por RBAC

Y deberán ser auditables.

## 5.49 Regla Arquitectónica Central

Toda impresión deberá considerarse una operación distribuida entre software y hardware potencialmente imperfecto.

Por tanto:

ComanView deberá asumir que una impresora puede fallar en cualquier momento y diseñar el flujo de manera que una falla de impresión nunca implique pérdida de la orden, pérdida del pago o pérdida de trazabilidad.

# 6. Seguridad, RBAC, PINs y Audit Log

## 6.1 Objetivo General de Seguridad

ComanView deberá proteger la operación del restaurante frente a:

Accesos no autorizados.

Fraude interno.

Uso indebido de descuentos.

Cancelaciones fraudulentas.

Aperturas indebidas de cajón.

Manipulación de pagos.

Uso de dispositivos no autorizados.

Alteración de registros.

Suplantación de usuarios.

Abuso de privilegios.

El principio general será:

Toda acción deberá ejecutarse bajo una identidad conocida, con permisos explícitos y trazabilidad suficiente para reconstruir qué ocurrió, quién lo hizo, desde qué dispositivo y bajo qué autorización.

La seguridad deberá aplicarse tanto en la interfaz como en el Servidor Edge.

Ocultar una opción visual no será considerado un mecanismo suficiente de seguridad.

## 6.2 Modelo RBAC

ComanView utilizará Role-Based Access Control (RBAC).

Los usuarios tendrán asignado un rol y cada rol estará asociado a un conjunto de permisos.

```text
La arquitectura deberá seguir:
```

```text
USER
```

```text
↓
```

```text
ROLE
```

```text
↓
```

```text
PERMISSIONS
```

La autorización no deberá depender de condicionales rígidos como:

```text
if user.role == "MANAGER"
```

para cada función.

Las operaciones deberán validar permisos específicos.

**Ejemplo:**

ORDER_CANCEL_SENT_ITEM

APPLY_DISCOUNT

OPEN_DRAWER_MANUALLY

REPRINT_RECEIPT

CLOSE_CASH_SESSION

Esto permitirá modificar posteriormente la matriz de permisos sin rediseñar la lógica completa del sistema.

## 6.3 Roles Base de V1

V1 contará inicialmente con cinco roles base:

### OWNER — Dueño

Máxima autoridad administrativa local.

Podrá:

Administrar configuración autorizada.

Gestionar usuarios.

Consultar reportes.

Autorizar operaciones sensibles.

Ejecutar operaciones administrativas.

Supervisar caja.

Administrar catálogo.

Consultar auditoría según permisos.

El OWNER tendrá la capacidad de autorizar cualquier operación local permitida por el sistema.

Sin embargo:

**Máxima autoridad no significa ausencia de auditoría.**

Toda acción sensible ejecutada o autorizada por un OWNER deberá quedar registrada.

### MANAGER — Gerente

Responsable de supervisión operativa.

Podrá, según permisos:

Autorizar cancelaciones.

Autorizar descuentos.

Autorizar cortesías.

Gestionar determinadas operaciones de caja.

Reimprimir documentos.

Supervisar mesas.

Ejecutar acciones administrativas limitadas.

### CASHIER — Cajero

Responsable principalmente de:

POS.

Cobros.

Pagos.

Caja.

Tickets.

Precuentas.

Operaciones permitidas de corte.

No tendrá acceso automático a configuración administrativa o reportes sensibles.

### WAITER — Mesero

Responsable principalmente de:

Mesas.

Apertura de órdenes permitidas.

Comandas.

Productos.

Modificadores.

Envío a preparación.

Consulta del estado de la orden.

Las acciones sensibles requerirán permisos superiores.

### KITCHEN — Cocina

Responsable principalmente de:

KDS.

Inicio de preparación.

Cambio de estado de ítems.

Marcado de productos listos.

Consulta de tickets de preparación.

No tendrá acceso a caja, pagos o configuración.

## 6.4 Roles Personalizados

La arquitectura deberá permitir incorporar roles personalizados posteriormente.

Ejemplos futuros:

CAPTAIN

BAR_MANAGER

SUPERVISOR

HOST

ACCOUNTANT

Sin embargo, V1 no requerirá un constructor completo de roles personalizados.

Los cinco roles base deberán cubrir la operación inicial.

## 6.5 Usuarios Individuales

Cada trabajador deberá disponer de una identidad individual.

No deberá utilizarse como práctica operativa normal una cuenta compartida como:

Usuario: MESEROS

PIN: 1234

Cada persona deberá tener:

user_id

name

role_id

status

credentials

**Ejemplo:**

Ángel

Role: WAITER

Laura

Role: MANAGER

Carlos

Role: CASHIER

Esto será obligatorio para mantener una auditoría confiable.

## 6.6 Estado de Usuario

Cada usuario deberá poder manejar como mínimo estados como:

ACTIVE

DISABLED

Una cuenta deshabilitada no deberá poder iniciar nuevas sesiones.

La desactivación deberá conservar el historial del usuario.

No deberán eliminarse físicamente usuarios que ya tengan operaciones asociadas.

## 6.7 Credencial Principal y PIN Operativo

ComanView distinguirá entre:

### Credencial Principal

Utilizada para operaciones como:

Alta inicial.

Cambio de contraseña.

Recuperación de cuenta.

Acciones administrativas sensibles.

Gestión de credenciales.

### PIN Operativo

Utilizado para acceso rápido dentro de la operación diaria.

**Ejemplo:**

Usuario:

Ángel

PIN:

••••

El objetivo será equilibrar:

Seguridad.

Velocidad.

Trazabilidad.

## 6.8 Almacenamiento de Credenciales

Contraseñas y PINs nunca deberán almacenarse en texto plano.

No deberá existir:

```text
pin = "4821"
```

La base local deberá almacenar únicamente representaciones derivadas mediante mecanismos criptográficos adecuados de hashing.

La validación deberá realizarse contra dichos hashes.

## 6.9 PIN de Autorización

Cuando un usuario intente realizar una acción para la cual no posee permiso suficiente, ComanView podrá solicitar autorización de un usuario superior.

```text
Ejemplo:
```

```text
WAITER
```

```text
↓
```

```text
Cancelar ítem SENT
```

```text
↓
```

```text
Permiso insuficiente
```

```text
↓
```

```text
AUTORIZACIÓN REQUERIDA
```

La interfaz solicitará:

Ingrese PIN de usuario autorizado

El Edge deberá identificar qué usuario introdujo el PIN y verificar que posee específicamente el permiso requerido.

No será suficiente comprobar que:

“el PIN pertenece a algún gerente”.

## 6.10 Solicitante y Autorizador

Toda autorización protegida deberá distinguir:

REQUESTING_USER

AUTHORIZING_USER

**Ejemplo:**

Solicitante:

Ángel — WAITER

Autorizador:

Laura — MANAGER

Esto deberá quedar registrado tanto en la operación como en Audit Log cuando corresponda.

## 6.11 Autorización sin Cambio de Sesión

Una autorización mediante PIN no deberá cambiar el usuario activo del dispositivo.

**Ejemplo:**

Sesión actual:

Ángel

Laura autoriza cancelación.

**Resultado:**

La sesión continúa siendo de Ángel.

La autorización únicamente concede permiso para ejecutar la operación solicitada.

## 6.12 Autorizaciones de Un Solo Uso

Las autorizaciones deberán ser específicas y temporales.

**Conceptualmente:**

authorization_id

requesting_user_id

authorizing_user_id

permission

entity_type

entity_id

created_at

expires_at

used_at

Una autorización no deberá permitir ejecutar múltiples operaciones posteriores.

El principio será:

```text
Una autorización = una operación concreta.
```

## 6.13 Operaciones Sensibles

Entre las acciones que deberán considerarse sensibles se incluyen:

Cancelar ítems enviados.

Cancelar órdenes.

Aplicar descuentos restringidos.

Aplicar cortesías.

Realizar voids.

Abrir cajón manualmente.

Modificar o cancelar determinados pagos.

Reimprimir documentos protegidos.

Ejecutar acciones sensibles de caja.

Ejecutar futuras operaciones de reapertura únicamente en dominios que las incorporen; una CLOSED Order no se reabre en V1.

Ejecutar ciertos ajustes administrativos.

La matriz concreta de permisos deberá configurarse por operación.

## 6.14 Descuentos

Los descuentos no deberán manejarse únicamente como:

```text
CAN_DISCOUNT = true/false
```

La arquitectura deberá permitir límites.

Ejemplo conceptual:

```text
WAITER
```

```text
max_discount = 0%
```

```text
CASHIER
```

```text
max_discount = 5%
```

```text
MANAGER
```

```text
max_discount = 20%
```

```text
OWNER
```

```text
max_discount = 100%
```

También podrán existir permisos específicos:

DISCOUNT_FIXED

DISCOUNT_PERCENT

CUSTOM_DISCOUNT

La política final podrá configurarse por establecimiento.

## 6.15 Descuentos, Cortesías y Voids

ComanView deberá distinguir entre:

DISCOUNT

COMP

VOID

### DISCOUNT

Reducción del precio de una venta válida.

### COMP — Cortesía

Producto o consumo absorbido deliberadamente por el establecimiento.

### VOID

Anulación de una operación o ítem.

Aunque los resultados financieros puedan parecer similares, deberán mantenerse separados para:

Reportes.

Auditoría.

Análisis.

Control antifraude.

## 6.16 Regla de Auditoría para OWNER

El OWNER podrá autorizar cualquier operación permitida por la plataforma.

Sin embargo, las acciones sensibles ejecutadas por OWNER deberán cumplir las mismas reglas de trazabilidad.

Como mínimo deberán registrar:

Acción.

Motivo.

Usuario.

Dispositivo.

Fecha/hora.

Entidad afectada.

Monto cuando aplique.

Ejemplos:

Descuento del 100%.

Cortesía.

Cancelación.

Apertura manual de cajón.

Modificación sensible de caja.

El OWNER nunca tendrá una capacidad equivalente a:

BYPASS_AUDIT

No existirá un modo invisible de operación.

## 6.17 Apertura de Cajón

La apertura del cajón tendrá dos flujos claramente diferenciados.

### Apertura Automática por Pago

```text
Ejemplo:
```

```text
Pago efectivo confirmado
```

```text
↓
```

```text
OPEN_CASH_DRAWER
```

No requerirá una segunda autorización si forma parte de un pago válido.

### Apertura Manual

**Ejemplo:**

OPEN_DRAWER_WITHOUT_SALE

Deberá requerir:

Permiso específico.

Motivo.

Autorización superior cuando corresponda.

Audit Log.

## 6.18 Sesiones de Usuario

Cada acceso operativo deberá estar asociado a una sesión.

Estructura conceptual:

session_id

user_id

device_id

location_id

login_at

last_activity

expires_at

status

Esto permitirá conocer:

Quién operó.

Desde qué dispositivo.

En qué establecimiento.

Durante qué sesión.

## 6.19 Bloqueo por Inactividad

Las sesiones deberán poder bloquearse automáticamente después de cierto período de inactividad.

El tiempo será configurable según tipo de dispositivo.

```text
Ejemplo conceptual:
```

```text
WAITER TABLET
```

```text
→ timeout corto
```

```text
POS
```

```text
→ timeout intermedio
```

```text
KDS
```

```text
→ sesión persistente controlada
```

Los tiempos definitivos se configurarán posteriormente.

## 6.20 Seguridad de KDS

El KDS deberá funcionar como una estación operativa autorizada.

No será práctico exigir autenticación repetida en cada interacción.

La arquitectura podrá utilizar una sesión persistente de estación, manteniendo:

Dispositivo identificado.

Sesión autorizada.

Permisos limitados.

Acciones restringidas exclusivamente a preparación.

Las operaciones sensibles podrán requerir identificación adicional cuando sea necesario.

## 6.21 Autenticación Offline

La autenticación de usuarios existentes deberá funcionar sin conexión a Internet.

El Edge mantendrá localmente la información necesaria para validar:

Usuario.

Estado.

Rol.

Permisos.

Credenciales.

PIN.

Configuración aplicable.

Cloud no deberá participar en cada login.

## 6.22 Administración de Usuarios Offline

Los usuarios autorizados podrán realizar determinadas operaciones de gestión aun sin Internet.

Ejemplos:

Crear usuario operativo.

Cambiar PIN.

Deshabilitar usuario.

Cambiar determinados roles permitidos.

Estas operaciones deberán:

Persistirse localmente.

Generar eventos.

Generar Audit Log cuando corresponda.

Sincronizarse con Cloud posteriormente.

## 6.23 Operaciones que Permanecen en Cloud

Algunas acciones no deberán poder resolverse localmente.

Ejemplos:

Cambiar propietario contractual.

Transferir tenant.

Alterar licencia.

Activar módulos comerciales.

Modificar Entitlements desde administración local.

Cambiar identidad jurídica del cliente.

Estas operaciones permanecerán bajo control del Super Admin.

## 6.24 Audit Log

ComanView contará con un Audit Log independiente destinado a registrar operaciones relevantes desde la perspectiva de seguridad y responsabilidad.

Estructura conceptual:

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

No todos los campos serán obligatorios en cada registro.

## 6.25 Event Log vs. Audit Log

Ambos conceptos deberán mantenerse separados.

### Event Log

Representa lo que ocurrió operacionalmente.

Ejemplos:

ITEM_ADDED

ITEM_REMOVED

PAYMENT_CREATED

ORDER_CLOSED

Su propósito principal será:

Estado.

Historia operacional.

Sincronización.

Reconstrucción de eventos.

### Audit Log

Representa la responsabilidad y contexto de una operación.

Ejemplos:

Quién solicitó

Quién autorizó

Por qué

Qué cambió

Qué monto fue afectado

Desde qué dispositivo

Ambos registros podrán relacionarse mediante:

event_id

## 6.26 Registro Before / After

Cuando una acción modifique información relevante, Audit Log deberá poder almacenar:

before

after

**Ejemplo:**

ACTION:

ITEM_QUANTITY_CHANGED

before:

```text
quantity = 3
```

after:

```text
quantity = 1
```

Esto permitirá reconstruir claramente modificaciones posteriores.

## 6.27 Motivos Estructurados

Las operaciones sensibles deberán utilizar motivos estructurados cuando sea posible.

**Ejemplo:**

CUSTOMER_CHANGED_MIND

WAITER_ERROR

KITCHEN_ERROR

PRODUCT_UNAVAILABLE

MANAGER_COMP

PAYMENT_ERROR

OTHER

Si se selecciona:

OTHER

el sistema podrá exigir un comentario adicional.

Esto permitirá generar reportes y detectar patrones.

## 6.28 Audit Log Append-Only

Los registros de auditoría deberán tratarse como información append-only.

El flujo permitido será:

INSERT

INSERT

INSERT

No deberán utilizarse operaciones normales:

UPDATE

DELETE

sobre registros históricos.

Ni siquiera OWNER deberá poder editar o eliminar estos registros desde la aplicación.

## 6.29 Inmutabilidad desde Interfaces

Los usuarios podrán consultar Audit Logs únicamente cuando tengan permiso.

No deberán existir controles normales para:

Editar registros.

Eliminar registros.

Reescribir motivos.

Cambiar usuario autorizador.

Cambiar montos históricos.

La corrección de una operación deberá generar una nueva operación y nueva auditoría, no alterar el historial.

## 6.30 Cadena de Integridad

Para detectar manipulación directa de la base local, los registros de auditoría podrán utilizar una cadena criptográfica.

**Conceptualmente:**

```text
AUDIT 1
```

```text
hash = H(data_1)
```

```text
AUDIT 2
```

```text
previous_hash = hash_1
```

```text
hash = H(data_2 + hash_1)
```

```text
AUDIT 3
```

```text
previous_hash = hash_2
```

```text
hash = H(data_3 + hash_2)
```

Modificar un registro histórico rompería la cadena posterior.

Esto no constituye una blockchain y no requerirá infraestructura distribuida.

Su función será:

**Detección de manipulación.**

## 6.31 Sincronización de Auditoría

Los Audit Logs deberán sincronizarse con Cloud cuando exista conexión.

La sincronización deberá mantener:

Identificador.

Secuencia.

Integridad.

Relación con eventos.

Hashes cuando aplique.

Una vez almacenados centralmente, el restaurante no deberá poder eliminarlos mediante herramientas locales.

Esto proporcionará una segunda capa de conservación histórica.

## 6.32 Consulta de Auditoría

Los usuarios autorizados podrán consultar auditoría utilizando filtros como:

Fecha.

Usuario.

Autorizador.

Acción.

Mesa.

Orden.

Caja.

Monto.

Motivo.

Dispositivo.

**Ejemplo:**

Todas las aperturas manuales de cajón

durante los últimos 30 días.

Esto deberá permitir investigaciones operativas rápidas.

## 6.33 Identidad de Dispositivos

Cada dispositivo autorizado deberá tener una identidad independiente.

Estructura conceptual:

device_id

tenant_id

location_id

device_type

device_name

status

paired_at

revoked_at

Ejemplos:

POS-01

TABLET-01

TABLET-02

KDS-KITCHEN-01

Un dispositivo conectado a la red local no deberá obtener acceso automáticamente a ComanView.

## 6.34 Pairing de Dispositivos

Los dispositivos nuevos deberán atravesar un proceso explícito de vinculación.

```text
Flujo conceptual:
```

```text
Nuevo dispositivo
```

```text
↓
```

```text
Localiza / configura Edge
```

```text
↓
```

```text
Solicita Pairing
```

```text
↓
```

```text
Administrador autorizado valida
```

```text
↓
```

```text
Edge registra dispositivo
```

```text
↓
```

```text
Se generan credenciales locales
```

```text
↓
```

```text
Dispositivo queda autorizado
```

La autorización podrá utilizar:

Código.

PIN administrativo.

QR.

Mecanismo equivalente.

El diseño exacto se determinará posteriormente.

## 6.35 Credencial del Dispositivo

Después del pairing, el dispositivo deberá recibir una identidad o token local que permita demostrar que está autorizado.

La credencial:

No deberá equivaler a la credencial de un usuario.

Deberá poder revocarse.

Deberá estar asociada a un location.

Deberá almacenarse de forma segura.

La autenticación completa será:

DEVICE AUTHORIZATION

+

USER AUTHENTICATION

cuando el contexto requiera ambas.

## 6.36 Revocación de Dispositivos

Los administradores autorizados deberán poder revocar dispositivos.

**Ejemplo:**

REVOKE DEVICE

TABLET-03

Casos de uso:

Tablet robada.

Tablet perdida.

Equipo reemplazado.

Dispositivo comprometido.

Equipo retirado.

Después de revocado, el Edge deberá rechazar nuevas solicitudes autenticadas con esa identidad.

## 6.37 Seguridad de Red Local

La LAN no deberá considerarse un entorno inherentemente confiable.

El hecho de conocer:

192.168.x.x

del Edge no deberá otorgar acceso.

La comunicación deberá contemplar:

Autenticación de dispositivo.

Autenticación de usuario.

Tokens.

Sesiones.

Validación de permisos.

Cifrado cuando sea técnicamente viable.

## 6.38 Comunicación Cifrada Device ↔ Edge

La arquitectura deberá tener como objetivo utilizar comunicación cifrada entre dispositivos y Edge.

Podrán evaluarse mecanismos como:

TLS local.

Certificados.

Credenciales de dispositivo.

Infraestructura equivalente.

El diseño exacto deberá equilibrar:

Seguridad.

Instalación.

Renovación de certificados.

Operación Offline.

Facilidad de soporte.

Pero la arquitectura no deberá depender de tráfico local permanentemente en texto plano.

## 6.39 Protección contra Fuerza Bruta de PIN

El Edge deberá controlar intentos repetidos de autenticación.

No deberá permitir intentos ilimitados de PIN.

La protección podrá incluir:

Rate limiting.

Retrasos progresivos.

Bloqueos temporales.

Alertas.

Registro de intentos anómalos.

```text
Ejemplo conceptual:
```

```text
5 intentos fallidos
```

```text
↓
```

```text
Retraso temporal
```

```text
↓
```

```text
Nuevo intento
```

Las reglas definitivas podrán configurarse posteriormente.

## 6.40 Seguridad de API

Todas las operaciones sensibles deberán validarse en el Edge.

**Ejemplo:**

Aunque el frontend no muestre:

[ CANCELAR PRODUCTO ]

a un mesero, el Edge deberá rechazar igualmente una solicitud API directa si el usuario no posee el permiso.

La regla será:

**La UI comunica permisos; el servidor los impone.**

## 6.41 Validación de Operaciones

Antes de ejecutar una operación, el Edge deberá validar según corresponda:

Dispositivo autorizado.

Sesión válida.

Usuario activo.

Permiso.

Estado de entidad.

Autorización adicional.

Motivo requerido.

Reglas de negocio.

```text
Ejemplo:
```

```text
Cancelar ítem SENT
```

```text
↓
```

```text
Device autorizado
```

```text
↓
```

```text
Sesión válida
```

```text
↓
```

```text
Ítem realmente SENT
```

```text
↓
```

```text
Usuario sin permiso directo
```

```text
↓
```

```text
Autorización MANAGER
```

```text
↓
```

```text
Motivo
```

```text
↓
```

```text
Operación
```

```text
↓
```

```text
Event Log
```

```text
↓
```

```text
Audit Log
```

## 6.42 Seguridad de Sincronización con Cloud

Cloud no deberá confiar automáticamente en cualquier información recibida del Edge.

Los eventos sincronizados deberán validar:

Identidad del Edge.

Tenant.

Location.

Firma/token correspondiente.

Formato.

Event ID.

Idempotencia.

Integridad.

Un Edge no deberá poder enviar operaciones válidas para otro tenant o location.

## 6.43 Separación de Privilegios

ComanView deberá aplicar el principio de mínimo privilegio.

**Ejemplo:**

Un mesero no necesita acceso a:

Costos.

Utilidad.

Reportes globales.

Administración de usuarios.

Configuración técnica.

Audit Logs.

Licencias.

Un cocinero no necesita acceso a:

Pagos.

Caja.

Datos financieros.

Cada rol deberá recibir solo lo necesario.

## 6.44 Información Sensible

La interfaz y las APIs deberán proteger información como:

Costos.

Utilidades.

Configuración.

Auditoría.

Datos administrativos.

Credenciales.

Tokens.

Secretos.

Los permisos deberán controlar tanto visualización como modificación.

## 6.45 Gestión de Secretos

Los secretos críticos no deberán quedar embebidos en:

Frontend.

JavaScript distribuido.

Código fuente público.

Repositorios.

Configuraciones inseguras.

Especialmente:

Claves privadas de firma.

Credenciales Cloud.

Tokens administrativos.

Secretos de infraestructura.

La gestión definitiva de secretos se determinará durante implementación.

## 6.46 Acciones Auditables de V1

Como mínimo deberán auditarse:

### Órdenes

Cancelación de ítems SENT.

Cancelación de orden.

Cambios sensibles.

Reaperturas futuras cuando el dominio correspondiente las contemple; REOPEN_CLOSED_ORDER permanece fuera de V1.

### Precios

Descuentos.

Cortesías.

Voids.

Cambios manuales autorizados.

### Pagos

Cancelación de pago.

Ajustes.

Reversiones.

Cambios sensibles.

### Caja

Apertura manual de cajón.

Movimientos manuales.

Corte X.

Corte Z.

Ajustes.

### Impresión

Reimpresiones sensibles.

Cancelaciones impresas.

### Usuarios

Alta.

Cambio de rol.

Desactivación.

Cambio de PIN.

### Dispositivos

Pairing.

Revocación.

### Configuración

Cambios relevantes de operación.

## 6.47 Matriz Conceptual de Permisos V1

La matriz definitiva podrá evolucionar, pero como punto inicial:

| Operación | OWNER | MANAGER | CASHIER | WAITER | KITCHEN |
| --- | --- | --- | --- | --- | --- |
| Crear comanda | Sí | Sí | Sí | Sí | No |
| Enviar a preparación | Sí | Sí | Sí | Sí | No |
| Operar KDS | Sí | Sí | No | No | Sí |
| Cobrar | Sí | Sí | Sí | No | No |
| Cerrar orden | Sí | Sí | Sí | No | No |
| Eliminar Draft | Sí | Sí | Sí | Sí | No |
| Cancelar Sent | Sí | Sí | Según permiso | Requiere autorización | No |
| Aplicar descuento | Sí | Según límite | Según límite | Según límite | No |
| Aplicar cortesía | Sí | Según permiso | No | No | No |
| Abrir cajón manual | Sí | Según permiso | Según permiso | No | No |
| Reimprimir recibo | Sí | Sí | Sí | No | No |
| Corte X | Sí | Sí | Sí | No | No |
| Corte Z | Sí | Sí | Según configuración | No | No |
| Modificar catálogo | Sí | Según configuración | No | No | No |
| Gestionar usuarios | Sí | Según configuración | No | No | No |
| Consultar auditoría | Sí | Según permiso | No | No | No |

Esta tabla representa la política inicial, no una implementación rígida.

Los permisos específicos serán la fuente real de autorización.

## 6.48 Alcance de Seguridad V1

La primera versión deberá incluir como mínimo:

### Identidad

Usuarios individuales.

Roles.

Permisos.

Estado de usuario.

### Autenticación

Credencial principal.

PIN operativo.

Hashing.

Login Offline.

### Autorización

RBAC.

Permisos por operación.

Límites de descuento.

Autorización por PIN.

Autorizaciones de un solo uso.

### Sesiones

User + Device.

Bloqueo por inactividad.

Revocación.

### Dispositivos

Identidad.

Pairing.

Tokens.

Revocación.

### Auditoría

Audit Log.

Before/After.

Motivos.

Solicitante.

Autorizador.

Append-only.

Sincronización Cloud.

Preparación para hash chain.

### API

Validación server-side.

Rate limiting.

Validación de identidad.

Validación de permisos.

## 6.49 Capacidades Posteriores

Podrán incorporarse posteriormente:

Roles personalizados completos.

SSO empresarial.

Biometría.

NFC para empleados.

Tarjetas de identificación.

Políticas avanzadas de contraseñas.

Risk scoring.

Detección automática de fraude.

Alertas de comportamiento anómalo.

Geofencing.

Certificados por dispositivo más avanzados.

Administración central de identidades multi-sucursal.

Integraciones con proveedores externos de identidad.

## 6.50 Principios Definitivos de Seguridad

La seguridad de ComanView deberá respetar los siguientes principios:

### 1. Identidad individual

Cada usuario debe ser identificable.

### 2. Mínimo privilegio

Cada rol recibe únicamente las capacidades necesarias.

### 3. Roles y permisos están separados

El permiso específico, no el nombre del rol, determina la autorización.

### 4. Offline no elimina seguridad

El Edge deberá continuar autenticando y autorizando localmente.

### 5. Autorización superior es específica

Un PIN superior concede permiso únicamente para una operación concreta.

### 6. OWNER no es invisible

Máxima autoridad no elimina auditoría.

### 7. Acciones sensibles requieren motivo

Especialmente cancelaciones, cortesías, descuentos extremos y aperturas manuales de cajón.

### 8. Event Log y Audit Log son diferentes

Uno describe la operación; el otro la responsabilidad y contexto.

### 9. Audit Log es append-only

Los registros históricos no se editan.

### 10. La manipulación debe ser detectable

La arquitectura contemplará mecanismos de integridad como hash chaining.

### 11. Usuario y dispositivo son identidades diferentes

Ambos deberán validarse cuando corresponda.

### 12. Conocer la LAN no significa tener acceso

Los dispositivos deberán vincularse explícitamente.

### 13. La UI no es la autoridad de seguridad

Toda autorización se valida en Edge.

### 14. Cloud tampoco confía ciegamente

La sincronización deberá autenticar y validar cada origen.

### 15. Los secretos críticos se protegen

No deberán distribuirse innecesariamente a clientes o frontends.

## 6.51 Regla Central de Seguridad

La seguridad de ComanView no deberá diseñarse únicamente para impedir accesos externos.

El sistema deberá asumir que gran parte del riesgo operacional puede originarse dentro del propio establecimiento.

Por ello:

Toda operación que pueda afectar dinero, inventario, órdenes, caja o responsabilidad deberá ser identificable, autorizable y auditable, sin importar el nivel jerárquico de quien la ejecute.

# 7. Modelo de Órdenes y Ciclo de Vida de la Venta

## 7.1 Propósito y alcance

Order es la raíz transaccional central de la operación comercial de ComanView.

Representa una venta completa desde su creación hasta su cierre o cancelación. Mesas, comandas, rondas, KDS, impresión y pagos participan en el ciclo de vida de una Order, pero ninguno de ellos sustituye a la entidad principal.

```text
Modelo conceptual:
```

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
├── Discounts / Comps[]
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

Una Order:

MUST pertenecer a un Tenant.

MUST pertenecer a un Location.

MAY estar asociada a una o varias mesas.

MAY contener múltiples rondas.

MAY recibir múltiples pagos.

MUST conservar su historia transaccional.

MUST poder operar completamente sin conexión a Cloud.

## 7.2 Identidad

Cada Order tendrá dos identificadores conceptualmente diferentes:

| Campo | Propósito |
| --- | --- |
| order_id | Identificador interno global, único e inmutable. |
| order_number | Identificador corto y legible para operación humana. |

### order_id

MUST ser globalmente único e inmutable; V1 utilizará UUID v7 como estándar para order_id.

Se utilizará para:

Relaciones internas.

Sincronización.

Event Log.

Idempotencia.

Cloud.

Integridad referencial.

MUST NOT cambiar durante la vida de la orden.

### order_number

Será generado localmente por Edge dentro del Location.

**Ejemplo:**

order_id: 0198c8...

order_number: 1842

Dos sucursales MAY utilizar simultáneamente el mismo order_number porque sus order_id serán diferentes.

Internet MUST NOT ser necesario para generar una nueva orden o su número operacional.

## 7.3 Tipos de orden

V1 soportará:

COUNTER

TABLE

TAKEOUT

No existirán entidades independientes como TableOrder o CounterOrder.

```text
Todas utilizarán:
```

```text
Order
```

```text
└── order_type
```

### COUNTER

Venta directa de mostrador.

### TABLE

Servicio asociado a una o varias mesas físicas.

### TAKEOUT

Venta para llevar.

La arquitectura MUST permitir incorporar posteriormente nuevos tipos o canales sin duplicar el dominio transaccional principal.

### Canal de origen — order_channel

order_channel será independiente de order_type.

V1: POS, WAITER.

Preparado para: ONLINE_WEB, DELIVERY_AGGREGATOR, API.

```text
Ejemplo futuro válido: order_type = TAKEOUT + order_channel = ONLINE_WEB.
```

## 7.4 Estados principales

Order.status tendrá únicamente:

OPEN

CLOSED

CANCELLED

Estos estados representan el ciclo de vida comercial de la venta, no todos sus estados operativos.

Estados como:

PREPARING

READY

PAYMENT_REQUESTED

PARTIALLY_PAID

MUST NOT utilizarse como estados principales de Order.

Serán estados independientes o derivados de:

OrderItems.

Rounds.

Payments.

Información operacional relacionada.

Esto permite que una misma orden tenga simultáneamente productos READY, otros PREPARING y un pago parcial.

## 7.5 Estado OPEN

Una Order permanece OPEN mientras la venta continúe activa.

Según permisos y reglas del dominio, podrá:

Agregar productos.

Modificar ítems DRAFT.

Crear rondas.

Enviar productos a preparación.

Recibir pagos.

Recibir pagos parciales.

Aplicar descuentos.

Aplicar cortesías.

Solicitar/imprimir precuenta.

Dividir cuenta.

Cambiar de mesa.

Transferirse entre meseros.

Recibir nuevas rondas después de pagos parciales.

Una orden parcialmente pagada continúa siendo:

```text
status = OPEN
```

**Ejemplo:**

Total actual: $1,000

Pagado:         $500

Saldo:          $500

```text
status = OPEN
```

## 7.6 Estado CLOSED

Una Order podrá pasar a CLOSED únicamente cuando cumpla las reglas de cierre.

Como condición financiera mínima:

```text
balance_due = 0
```

Además, MUST satisfacer cualquier otra validación operacional aplicable.

```text
El cierre deberá ser una operación explícita:
```

```text
OPEN
```

```text
↓
```

```text
validaciones
```

```text
↓
```

```text
ORDER_CLOSED
```

```text
↓
```

```text
CLOSED
```

Una vez cerrada:

**El estado comercial de la venta queda congelado.**

Una CLOSED Order MUST NOT modificarse mediante operaciones normales.

Cambios posteriores deberán resolverse mediante operaciones compensatorias explícitas, como futuras implementaciones de:

VOID

REFUND

REVERSAL

ADJUSTMENT

MUST NOT modificarse directamente la venta histórica para simular estas operaciones.

## 7.7 Estado CANCELLED

Una orden podrá pasar a CANCELLED mediante una operación explícita y autorizada.

Cancelar MUST NOT eliminar físicamente la orden.

Una cancelación deberá conservar:

Order.

OrderItems.

Rondas existentes.

Eventos.

Usuario solicitante.

Autorizador cuando aplique.

Motivo.

Audit Log correspondiente.

Una orden transaccional real MUST NOT eliminarse mediante un DELETE como mecanismo normal de cancelación.

## 7.8 OrderItem

Cada producto incorporado a una venta será representado mediante un OrderItem.

```text
Modelo conceptual:
```

```text
OrderItem
```

```text
├── order_item_id
```

```text
├── order_id
```

```text
├── product_id
```

```text
├── product_name_snapshot
```

```text
├── quantity
```

```text
├── unit_price_snapshot
```

```text
├── tax_snapshot
```

```text
├── modifier_snapshots[]
```

```text
├── station_snapshot
```

```text
├── send_status
```

```text
├── prep_status
```

```text
└── calculated_totals
```

El modelo físico definitivo podrá variar durante el diseño de base de datos, pero MUST preservar estas responsabilidades.

## 7.9 Snapshots transaccionales

Una venta histórica MUST NOT depender del estado actual del catálogo.

Al agregar un producto, ComanView deberá conservar un snapshot suficiente para reconstruir qué se vendió y bajo qué condiciones.

Como mínimo:

product_id

product_name

unit_price

taxes

selected_modifiers

modifier_prices

station

**Ejemplo:**

Lunes:

```text
Hamburguesa = $150
```

Martes:

Catálogo actualizado

```text
Hamburguesa = $170
```

Una venta del lunes MUST continuar registrando:

```text
Hamburguesa = $150
```

El product_id mantiene la relación con catálogo.

El snapshot mantiene la verdad histórica de la transacción.

**Regla:**

CURRENT CATALOG CHANGES

≠

HISTORICAL SALE CHANGES

## 7.10 Estado de envío vs. preparación

El estado de envío de un producto y su estado de preparación serán conceptos independientes.

### Estado de envío

DRAFT

SENT

### Estado de preparación

Como mínimo:

PENDING

PREPARING

READY

Por ejemplo:

```text
send_status = SENT
```

```text
prep_status = PREPARING
```

es un estado perfectamente válido.

## 7.11 Ítems DRAFT

Un ítem DRAFT todavía no ha producido consecuencias en una estación de preparación.

Según permisos, MAY:

Cambiar cantidad.

Cambiar modificadores.

Eliminarse del carrito.

Modificarse antes del envío.

Eliminar un DRAFT no equivale a cancelar un producto que cocina ya recibió.

## 7.12 Ítems SENT

Un ítem pasa a SENT cuando forma parte de una ronda enviada a preparación.

Un ítem SENT ya puede haber generado:

Aparición en KDS.

Print Job.

Comanda física.

Trabajo en cocina/barra.

Por tanto:

Un ítem SENT MUST NOT desaparecer ni modificarse silenciosamente.

Cualquier reducción, cancelación o modificación posterior deberá ser una operación explícita.

**Ejemplo:**

2x Hamburguesa SENT

no deberá convertirse silenciosamente en:

1x Hamburguesa SENT

Deberá existir una acción/evento que represente el cambio, con RBAC, motivo, Audit Log y comunicación a preparación cuando corresponda.

## 7.13 Round

Round será una entidad explícita dentro del dominio.

Representa un conjunto de ítems enviados conjuntamente a preparación.

```text
Modelo conceptual:
```

```text
Round
```

```text
├── round_id
```

```text
├── order_id
```

```text
├── sequence
```

```text
├── created_by
```

```text
├── sent_at
```

```text
└── OrderItems[]
```

**Ejemplo:**

Order #1842

```text
Round 1 — 20:10
```

```text
├── 2 Tacos
```

```text
└── 1 Agua
```

```text
Round 2 — 20:28
```

```text
└── 2 Cervezas
```

```text
Draft
```

```text
└── 1 Pastel
```

Cuando el usuario ejecuta SEND, los ítems DRAFT seleccionados forman una nueva Round y pasan a SENT.

Todo ítem SENT MUST pertenecer a una Round.

## 7.14 Round y estaciones

Una Round no representa una impresora ni una estación.

```text
Una misma ronda puede contener:
```

```text
Round 3
```

```text
├── 2 Hamburguesas → COCINA
```

```text
├── 2 Cervezas     → BARRA
```

```text
└── 1 Pastel       → POSTRES
```

El Routing Engine será responsable de dividir operacionalmente la ronda según estación.

No deberán crearse rondas independientes únicamente porque los productos tengan destinos diferentes.

## 7.15 Modelo de mesas

Table representa un recurso físico del establecimiento.

MUST NOT contener directamente la venta.

```text
La relación será:
```

```text
Table
```

```text
↓
```

```text
Active Order
```

```text
y no:
```

```text
Table
```

```text
├── Products
```

```text
├── Payments
```

```text
└── Rounds
```

La información transaccional pertenece a Order.

## 7.16 Restricción de orden activa por mesa

En V1:

Una mesa física MUST NOT pertenecer simultáneamente a dos Orders activas.

Esto evita ambigüedad operacional en:

Comandería.

KDS.

Pagos.

Cambio de mesa.

Sincronización.

Estado visual.

La división de cuenta deberá resolverse dentro de una misma Order, no creando automáticamente varias órdenes.

## 7.17 Una Order con múltiples mesas

Una TABLE Order MAY estar asociada a varias mesas físicas.

**Ejemplo:**

Order #1842

Tables:

M4

M5

M6

Esto representa mesas físicas unidas para atender a un mismo grupo.

Todas continúan perteneciendo a una sola transacción comercial.

## 7.18 Cambio de mesa

V1 soportará una operación explícita equivalente a:

MOVE_ORDER

**Ejemplo:**

Order #1842

```text
TABLE 4
```

```text
↓
```

```text
TABLE 12
```

Cambiar de mesa:

MUST NOT crear una nueva Order.

MUST NOT copiar los productos.

MUST NOT reiniciar rondas.

MUST conservar pagos existentes.

MUST conservar historia.

Deberá generar Event Log y Audit Log cuando las reglas de seguridad lo requieran.

## 7.19 Merge de Orders

V1 MUST NOT implementar MERGE_ORDERS.

Combinar físicamente mesas no equivale a fusionar transacciones.

Una familia que ocupe varias mesas utilizará:

One Order

+

Multiple Tables

en lugar de crear varias Orders para fusionarlas posteriormente.

El merge transaccional podrá evaluarse en versiones posteriores.

## 7.20 Transferencia entre meseros

V1 soportará:

TRANSFER_ORDER

```text
Ejemplo:
```

```text
assigned_waiter:
```

```text
Carlos → Ángel
```

La operación:

MUST conservar order_id.

MUST conservar ítems.

MUST conservar rondas.

MUST conservar pagos.

MUST conservar historia.

MUST generar evento.

La autorización adicional podrá depender de la configuración RBAC.

## 7.21 Precuenta

Solicitar o imprimir una precuenta MUST NOT cerrar la orden.

La Order permanecerá:

```text
status = OPEN
```

El sistema podrá registrar información operacional como:

payment_requested_at

precheck_printed_at

o derivar un estado visual equivalente.

Pero PRECHECK_PRINTED MUST NOT ser un estado principal de Order.

## 7.22 Relación con pagos

Una Order MAY contener múltiples Payments.

```text
Conceptualmente:
```

```text
Order
```

```text
└── Payments[]
```

Los detalles completos del dominio de pagos se definen en la Sección 8.

Desde el dominio de órdenes deberán poder determinarse conceptos financieros como:

gross_total

discount_total

tax_total

net_total

tip_total

paid_amount

balance_due

La implementación decidirá cuáles se persisten y cuáles se derivan.

## 7.23 Pagos parciales

V1 permitirá pagos parciales sin cerrar la Order.

**Ejemplo:**

Order #1842

```text
status = OPEN
```

Total:  $1,200

Paid:     $600

Balance:  $600

La orden MAY:

Permanecer abierta.

Recibir nuevas rondas.

Recibir productos adicionales.

Recibir pagos adicionales.

Los $600 previamente pagados MUST conservarse.

La orden solo podrá cerrarse cuando las condiciones finales de cierre sean satisfechas.

## 7.24 Pago y cierre son eventos diferentes

ComanView MUST distinguir conceptualmente:

PAYMENT_COMPLETED

de:

ORDER_CLOSED

Aunque normalmente ambos ocurran dentro del mismo flujo operacional, representan hechos diferentes.

Un pago registra movimiento financiero.

El cierre congela la transacción comercial.

## 7.25 Efectivo entregado y pago aplicado

El efectivo recibido físicamente y el importe aplicado a la venta deberán distinguirse.

**Ejemplo:**

Amount due:      $470

Cash tendered:   $500

Change given:     $30

Payment applied: $470

MUST NOT interpretarse:

```text
Sale revenue = $500
```

El tratamiento completo se definirá en la Sección 8.

## 7.26 Autoridad financiera

El Servidor Edge será la autoridad financiera local.

Los clientes podrán enviar intención operacional:

product_id

quantity

modifier selections

discount request

payment request

pero MUST NOT ser considerados autoridad sobre:

unit_price

tax

discount_amount

subtotal

total

balance_due

change

Edge deberá validar y calcular los importes aplicables.

**Regla:**

**Clients express intent; Edge determines authoritative financial results.**

Esto deberá aplicarse a POS, tablets y cualquier otro cliente local.

## 7.27 Cancelar vs. eliminar

El comportamiento dependerá del estado de la transacción.

### DRAFT

Puede eliminarse del carrito operacional según permisos.

### SENT

MUST NOT eliminarse silenciosamente.

Debe utilizar una operación explícita de cancelación/modificación.

### CLOSED

MUST NOT modificarse directamente.

Las correcciones posteriores deberán utilizar operaciones compensatorias.

## 7.28 Idempotencia de comandos

Toda mutación relevante deberá ser idempotente.

Cada comando deberá poder incorporar un identificador único:

```text
command_id = UUID
```

**Ejemplo:**

```text
ADD_ITEM
```

```text
command_id = abc-123
```

```text
quantity = 2
```

```text
product = BEER
```

Si una tablet pierde conexión después de enviar el comando y posteriormente lo reenvía:

same command_id

Edge MUST reconocer que ya fue procesado y MUST NOT repetir el efecto comercial.

Por tanto:

Same command

retried N times

```text
=
```

One business effect

Esta regla aplica especialmente a:

Agregar productos.

Enviar rondas.

Pagos.

Cancelaciones.

Cierre.

Transferencias.

## 7.29 Concurrencia

Una Order podrá ser observada y modificada por múltiples dispositivos autorizados.

ComanView MUST NOT depender de bloquear toda la orden durante su uso normal.

```text
Ejemplo válido:
```

```text
Tablet A
```

```text
→ ADD beer
```

```text
Tablet B
```

```text
→ ADD dessert
```

Ambas operaciones podrán coexistir.

Sin embargo, Edge deberá validar cada comando contra el estado autoritativo actual.

```text
Ejemplo:
```

```text
Tablet A → CLOSE_ORDER
```

```text
Tablet B → acaba de agregar productos
```

Edge deberá detectar que las condiciones utilizadas por Tablet A pueden estar obsoletas y rechazar o recalcular la operación según corresponda.

## 7.30 Versionado

Cada Order deberá mantener una versión lógica:

version

**Ejemplo:**

```text
version = 17
```

```text
Una mutación válida produce:
```

```text
17 → 18
```

Los comandos que requieran control de concurrencia podrán incluir:

```text
expected_version = 17
```

Si el estado autoritativo ya es:

```text
version = 18
```

Edge podrá detectar el conflicto antes de ejecutar una operación incompatible.

Los timestamps MUST NOT utilizarse como único mecanismo de concurrencia.

## 7.31 Autoridad temporal

Los dispositivos clientes podrán proporcionar:

client_timestamp

para contexto.

Sin embargo, Edge será la referencia temporal autoritativa de la operación local.

Deberá registrar información equivalente a:

edge_received_at

edge_committed_at

Esto evita depender del reloj potencialmente incorrecto de una tablet, smartphone o terminal.

## 7.32 Política de eliminación

Las entidades transaccionales MUST conservar su historia.

Como regla general:

Orders

Payments

Sent Items

Rounds

Audit Records

MUST NOT utilizar eliminación destructiva como mecanismo normal del dominio.

Las correcciones deberán representarse mediante:

Estados.

Eventos.

Operaciones compensatorias.

Registros adicionales.

Entidades administrativas no transaccionales podrán utilizar desactivación o soft delete según corresponda.

## 7.33 Reapertura de Orders

V1 MUST NOT soportar reapertura directa de una CLOSED Order.

```text
No existirá un flujo normal:
```

```text
CLOSED
```

```text
↓
```

```text
OPEN
```

Si posteriormente se detecta un error, deberá resolverse mediante operaciones explícitas como:

VOID

REFUND

REVERSAL

ADJUSTMENT

según el dominio correspondiente.

Esto protege:

Caja.

Corte Z.

Auditoría.

Sincronización.

Reportes.

Integridad histórica.

## 7.34 Cierre y snapshot financiero

Cuando una Order pase a CLOSED, ComanView deberá generar o conservar una representación financiera final estable.

```text
Conceptualmente:
```

```text
ClosedOrderSnapshot
```

```text
├── subtotal
```

```text
├── discounts
```

```text
├── comps
```

```text
├── taxes
```

```text
├── tips
```

```text
├── total
```

```text
├── payments
```

```text
├── change
```

```text
├── closed_at
```

```text
└── closed_by
```

Este snapshot MUST NOT reemplazar las entidades originales.

Su objetivo será disponer de una representación inmutable del resultado final de la venta para:

Corte Z.

Reportes.

Cloud.

Auditoría.

Consultas históricas.

Recuperación.

Los cambios posteriores del catálogo o configuración MUST NOT modificarlo.

## 7.35 Event Log del dominio

Las mutaciones importantes deberán representarse mediante eventos explícitos.

Taxonomía inicial:

### Order

ORDER_CREATED

ORDER_TYPE_CHANGED

ORDER_ASSIGNED_TO_TABLE

ORDER_MOVED

ORDER_WAITER_TRANSFERRED

### Items

ITEM_ADDED

ITEM_UPDATED

ITEM_REMOVED

ITEM_SENT

ITEM_VOIDED

### Rounds

ROUND_CREATED

ROUND_SENT

### Precuenta

PRECHECK_REQUESTED

PRECHECK_PRINTED

### Ajustes comerciales

DISCOUNT_APPLIED

COMP_APPLIED

### Payments

PAYMENT_ADDED

PAYMENT_VOIDED

### Lifecycle

ORDER_PAID

ORDER_CLOSED

ORDER_CANCELLED

Los nombres definitivos podrán refinarse durante la implementación, pero su semántica deberá permanecer explícita.

El Event Log MUST registrar hechos ocurridos, no estados completos enviados para sobrescribir información existente.

## 7.36 Relación con Audit Log

No todo Event requiere necesariamente una autorización especial.

Cuando una operación sea sensible, el Event correspondiente deberá relacionarse con el Audit Log definido en la Sección 6.

```text
Ejemplo:
```

```text
ITEM_VOIDED
```

```text
│
```

```text
└── event_id
```

```text
↓
```

```text
Audit Entry
```

```text
├── requesting_user
```

```text
├── authorizing_user
```

```text
├── reason
```

```text
└── affected_amount
```

Event Log describe qué ocurrió.

Audit Log describe quién fue responsable, bajo qué autorización y por qué.

## 7.37 Offline-First

Todo el ciclo operativo principal de Order deberá funcionar sin Cloud.

Sin Internet, el restaurante MUST poder:

CREATE ORDER

ADD ITEM

CREATE ROUND

SEND TO KITCHEN

MODIFY ACTIVE ORDER

TAKE PAYMENT

CLOSE ORDER

siempre que Edge esté disponible y las reglas locales de seguridad/licenciamiento lo permitan.

Cloud MUST NOT ser necesario para validar precios, generar órdenes, enviar comandas, registrar pagos o cerrar ventas.

La sincronización ocurre posteriormente.

## 7.38 Invariantes del Dominio

Las siguientes reglas son invariantes obligatorias. La implementación MUST impedir cualquier operación que las viole.

> **INVARIANT:** INV-01 — Ownership

> **INVARIANT:** Every Order MUST belong to exactly one Tenant and one Location.

> **INVARIANT:** INV-02 — Identity

> **INVARIANT:** Every Order MUST have one globally unique and immutable order_id.

> **INVARIANT:** INV-03 — Finality

> **INVARIANT:** CLOSED and CANCELLED Orders MUST NOT be edited through normal operational flows.

> **INVARIANT:** INV-04 — Historical Pricing

> **INVARIANT:** Historical prices MUST NOT be recalculated from the current catalog.

> **INVARIANT:** INV-05 — Sent Item Integrity

> **INVARIANT:** A SENT item MUST NOT disappear or be overwritten silently.

> **INVARIANT:** INV-06 — Round Membership

> **INVARIANT:** Every SENT item MUST belong to exactly one Round.

> **INVARIANT:** INV-07 — Payment Ownership

> **INVARIANT:** Every Payment MUST belong to an Order.

> **INVARIANT:** INV-08 — Financial Authority

> **INVARIANT:** All authoritative financial calculations MUST be performed or validated by Edge.

> **INVARIANT:** INV-09 — Table Assignment

> **INVARIANT:** A TABLE Order MAY reference one or more physical tables.

> **INVARIANT:** INV-10 — Active Table Exclusivity

> **INVARIANT:** A physical table MUST NOT belong to more than one active Order in V1.

> **INVARIANT:** INV-11 — Idempotency

> **INVARIANT:** Retrying the same command MUST NOT duplicate its business effect.

> **INVARIANT:** INV-12 — Historical Preservation

> **INVARIANT:** Order history MUST be preserved through explicit events and non-destructive state transitions.

> **INVARIANT:** INV-13 — Offline Operation

> **INVARIANT:** Cloud connectivity MUST NOT be required to create, modify, send, pay or close a local Order.

> **INVARIANT:** INV-14 — Security

> **INVARIANT:** Every sensitive mutation MUST comply with RBAC and Audit rules defined in Section 6.

> **INVARIANT:** INV-15 — Commercial Finality

> **INVARIANT:** Closing an Order MUST freeze its commercial state and final financial representation.

## 7.39 Operaciones fuera del alcance de V1

V1 no incluirá:

MERGE_ORDERS

REOPEN_CLOSED_ORDER

Tampoco incluirá inicialmente:

Delivery propio.

Integraciones con agregadores.

Reservaciones.

Cuentas abiertas entre múltiples jornadas.

Course management avanzado.

Seat-level ordering avanzado.

Transferencia de Orders entre sucursales.

Orders compartidas entre Locations.

Edición destructiva de ventas históricas.

Estas exclusiones deberán respetarse durante el desarrollo de V1 para evitar introducir complejidad no requerida.

## 7.40 Resumen normativo para implementación

La implementación deberá asumir las siguientes reglas como fuente de verdad:

```text
Order = Transaction Root
```

```text
Order.status =
```

```text
OPEN
```

```text
CLOSED
```

```text
CANCELLED
```

```text
Order.type =
```

```text
COUNTER
```

```text
TABLE
```

```text
TAKEOUT
```

```text
OrderItem.send_status =
```

```text
DRAFT
```

```text
SENT
```

```text
OrderItem.prep_status =
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

```text
Cloud required for local sale =
```

```text
FALSE
```

```text
Edge financial authority =
```

```text
TRUE
```

```text
Historical catalog dependency =
```

```text
FALSE
```

```text
Direct modification after CLOSED =
```

```text
FALSE
```

```text
Direct reopening in V1 =
```

```text
FALSE
```

```text
Multiple active Orders per physical table =
```

```text
FALSE
```

```text
Multiple physical tables per Order =
```

```text
TRUE
```

```text
Partial payments while Order remains OPEN =
```

```text
TRUE
```

```text
New rounds after partial payment =
```

```text
TRUE
```

```text
Merge Orders in V1 =
```

```text
FALSE
```

```text
Command idempotency =
```

```text
REQUIRED
```

```text
Order versioning =
```

```text
REQUIRED
```

```text
Transactional history preservation =
```

```text
REQUIRED
```

## 7.41 Regla Central del Dominio

Order deberá ser tratada como una transacción histórica y evolutiva, no como un documento mutable que representa únicamente su estado actual.

Por tanto:

Toda modificación relevante deberá preservar la historia de lo ocurrido; Edge será la autoridad del estado y de los cálculos financieros; y una venta cerrada nunca deberá reescribirse para representar un hecho posterior.

# 8. Pagos, Propinas y Conciliación

## 8.1 Propósito y alcance

El dominio de pagos de ComanView deberá representar de forma precisa cómo una Order recibe dinero, cómo se registran propinas, cómo se calculan saldos y cómo se conserva la trazabilidad financiera.

Payment será una entidad independiente ligada a Order.

```text
Modelo conceptual:
```

```text
Order
```

```text
└── Payments[]
```

Una Order MAY contener múltiples Payments.

Los pagos deberán funcionar completamente en modo Offline mientras Edge esté disponible.

## 8.2 Entidad Payment

```text
Modelo conceptual:
```

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
├── created_at
```

```text
└── created_by
```

No todos los campos serán obligatorios para todos los métodos.

Cada Payment:

MUST pertenecer a exactamente una Order.

MUST utilizar un identificador globalmente único.

MUST conservar su historial.

MUST ser validado por Edge.

MUST NOT depender de Cloud para completarse.

## 8.3 Métodos de pago V1

V1 soportará como mínimo:

CASH

CARD

OTHER

### CASH

Pago realizado en efectivo.

### CARD

Pago procesado mediante una terminal bancaria externa.

### OTHER

Método manual adicional configurable o reservado para necesidades operativas no cubiertas inicialmente.

V1 no implementará integración bancaria directa.

## 8.4 Estados de Payment

Los estados serán:

PENDING

COMPLETED

VOIDED

### PENDING

El pago fue iniciado pero todavía no se ha aplicado definitivamente a la Order.

### COMPLETED

El pago fue confirmado y su importe fue aplicado correctamente.

### VOIDED

El pago fue anulado mediante un flujo explícito y autorizado.

Un Payment COMPLETED MUST NOT eliminarse físicamente.

No existirá un estado basado en DELETED.

## 8.5 PaymentAttempt

V1 no implementará una entidad compleja PaymentAttempt.

Debido a que las terminales bancarias permanecen externas, ComanView registrará principalmente pagos que el operador confirma como realizados.

La arquitectura SHOULD permitir incorporar PaymentAttempt posteriormente cuando existan integraciones directas con:

Terminales bancarias.

Gateways.

Wallets.

Pagos online.

## 8.6 Autoridad financiera

El Servidor Edge será la autoridad financiera local.

Los clientes podrán expresar intención:

Apply $500 as CARD

pero Edge deberá calcular y validar:

Saldo actual.

Importe aplicable.

Propina.

Cambio.

Balance resultante.

Estado financiero de la Order.

La UI MUST NOT ser considerada fuente de verdad para importes financieros.

**Regla:**

**Clients express payment intent; Edge determines authoritative financial results.**

## 8.7 Múltiples pagos

Una Order MAY recibir múltiples pagos.

**Ejemplo:**

Order total: $1,000

Payment 1

$300 CASH

Payment 2

$400 CARD

Payment 3

$300 CARD

No deberá utilizarse un único campo:

order.payment_method

como representación del pago de una venta.

```text
La relación correcta será:
```

```text
Order
```

```text
└── Payments[]
```

## 8.8 Pagos parciales

V1 soportará pagos parciales.

**Ejemplo:**

Order total: $1,000

Paid:          $400

Balance:       $600

```text
Order.status = OPEN
```

La Order MAY continuar recibiendo:

Nuevos productos.

Nuevas rondas.

Nuevos pagos.

Los pagos previamente completados MUST conservarse.

Si posteriormente se agregan productos:

Previous total: $1,000

Paid:             $400

New items:        $200

New total:      $1,200

New balance:      $800

La Order continúa OPEN.

## 8.9 Balance de la Order

**Conceptualmente:**

gross_subtotal

- discounts

- comps

+ taxes

= sale_total

Después:

sale_total

- completed_payment_amount_applied

= balance_due

Solo los Payments con:

```text
status = COMPLETED
```

deberán afectar paid_amount.

Los VOIDED MUST NOT continuar afectando el saldo vigente.

## 8.10 ORDER_PAID

ORDER_PAID será un evento derivado, no un estado principal de Order.

Se produce cuando:

```text
balance_due = 0
```

Puede existir temporalmente:

```text
Order.status = OPEN
```

```text
balance_due = 0
```

antes de ejecutar ORDER_CLOSED.

Pago y cierre continuarán siendo hechos diferentes.

## 8.11 Pago en efectivo

Un pago CASH deberá distinguir como mínimo:

amount_due

cash_tendered

amount_applied

change_given

**Ejemplo:**

Amount due:      $470

Cash tendered:   $500

Amount applied:  $470

Change given:     $30

El ingreso aplicado a la venta es:

$470

no:

$500

## 8.12 Sobrepago en efectivo

El importe físico entregado MAY ser superior al saldo debido a la existencia de cambio.

Sin embargo:

```text
amount_applied <= authoritative balance_due
```

salvo una futura regla explícita que indique lo contrario.

La diferencia deberá registrarse como:

change_given

y MUST NOT considerarse ingreso adicional.

## 8.13 Cambio

El cambio entregado:

MUST estar asociado al pago en efectivo correspondiente.

MUST ser calculado por Edge.

MUST NOT aumentar ni disminuir el ingreso de venta.

SHOULD poder formar parte de los datos utilizados por Caja y Corte Z.

**Ejemplo:**

```text
cash_tendered = 500
```

```text
amount_applied = 470
```

```text
change_given = 30
```

## 8.14 Pago con tarjeta en V1

Las terminales bancarias permanecerán desacopladas de ComanView.

```text
Flujo:
```

```text
ComanView calcula importe
```

```text
↓
```

```text
Operador captura monto en terminal
```

```text
↓
```

```text
Terminal procesa transacción
```

```text
↓
```

```text
Terminal imprime voucher
```

```text
↓
```

```text
Operador confirma pago en ComanView
```

```text
↓
```

```text
Edge registra Payment
```

ComanView MUST NOT asumir que el pago ocurrió simplemente porque se abrió la pantalla de tarjeta.

La confirmación deberá ser explícita.

## 8.15 Voucher bancario

En V1:

El voucher lo imprime la terminal bancaria.

ComanView no genera el voucher.

ComanView no almacena datos sensibles de tarjeta.

ComanView registra el pago administrativo correspondiente.

Podrá existir un campo opcional:

external_reference

para guardar:

Folio.

Referencia.

Autorización.

Identificador visible del voucher.

Su uso no será obligatorio en V1.

## 8.16 Sobrepago en tarjeta

Un Payment CARD MUST NOT aplicar un importe de venta superior al saldo autoritativo permitido.

Por ejemplo:

```text
balance_due = $500
```

no deberá permitirse:

```text
amount_applied = $600
```

como consumo.

La propina deberá registrarse por separado.

## 8.17 Pagos mixtos

V1 soportará múltiples métodos de pago dentro de una misma Order.

**Ejemplo:**

Sale total: $1,000

Payment 1

CASH

$400

Payment 2

CARD

$600

Cada pago será independiente y conservará:

Método.

Importe.

Usuario.

Fecha/hora.

Estado.

Referencia cuando aplique.

## 8.18 Propinas

La funcionalidad de propinas será configurable por establecimiento.

```text
tips_enabled = true | false
```

Si:

```text
tips_enabled = false
```

la interfaz MUST NOT mostrar controles de propina en el flujo normal.

Si está activa, V1 permitirá:

PERCENTAGE

FIXED_AMOUNT

Como opciones iniciales podrán configurarse porcentajes como:

10%

15%

20%

más un monto manual.

## 8.19 Separación entre venta y propina

La propina MUST mantenerse financieramente separada del consumo.

**Ejemplo:**

```text
sale_amount = $850
```

```text
tip_amount = $150
```

```text
charged_total = $1,000
```

MUST NOT registrarse:

```text
sale_amount = $1,000
```

porque esto alteraría:

Ventas.

Impuestos.

Reportes.

Conciliación.

Corte Z.

## 8.20 Propina asociada al Payment

La propina deberá estar vinculada al Payment concreto donde fue cobrada.

**Ejemplo:**

Payment CARD

```text
amount_applied = $850
```

```text
tip_amount = $150
```

```text
charged_total = $1,000
```

**Conceptualmente:**

```text
charged_total =
```

```text
amount_applied
```

+ tip_amount

Esto permitirá conciliar el importe registrado en ComanView contra el voucher de tarjeta.

## 8.21 Propinas en pagos mixtos

Cada Payment podrá contener su propia propina.

**Ejemplo:**

Payment 1 — CASH

```text
amount_applied = $400
```

```text
tip_amount = $0
```

Payment 2 — CARD

```text
amount_applied = $600
```

```text
tip_amount = $120
```

**Resultado:**

```text
Sale amount = $1,000
```

```text
Tip amount = $120
```

```text
Total charged = $1,120
```

La propina no deberá redistribuirse artificialmente entre otros Payments.

## 8.22 Distribución de propinas

V1 no implementará:

Pool de propinas.

Reparto por mesero.

Reparto hacia cocina.

Porcentajes por empleado.

Liquidaciones individuales.

Reglas laborales de distribución.

V1 únicamente registrará la propina a nivel transaccional.

## 8.23 Split Bill

V1 soportará división de cuenta sin crear nuevas Orders.

La Order continuará siendo la única raíz transaccional.

El split será un mecanismo de cálculo y cobro.

### División por productos

```text
Ejemplo:
```

```text
Group A
```

```text
├── 2 Tacos
```

```text
└── 1 Cerveza
```

```text
Group B
```

```text
├── 1 Hamburguesa
```

```text
└── 1 Refresco
```

### División en partes iguales

**Ejemplo:**

```text
Order total = $1,200
```

4 personas

= $300 por persona

## 8.24 División de cantidades

Cuando un OrderItem represente múltiples unidades:

3x Taco

```text
la UI podrá permitir dividir por unidades:
```

```text
2x Taco → Group A
```

```text
1x Taco → Group B
```

V1 MUST NOT requerir propiedad financiera fraccionaria arbitraria de productos unitarios.

Por ejemplo, no deberá ser necesario representar:

## 0.37 Hamburger

para realizar un split estándar.

## 8.25 Void de Payment

Un Payment COMPLETED que necesite anularse deberá utilizar:

```text
COMPLETED
```

```text
→ VOIDED
```

La operación deberá respetar la Sección 6 e incluir cuando corresponda:

Permiso.

Motivo.

Usuario solicitante.

Usuario autorizador.

Event Log.

Audit Log.

El registro original MUST permanecer históricamente disponible.

## 8.26 VOID vs REFUND

V1 distinguirá conceptualmente:

### VOID

Anulación de un pago dentro de un flujo operacional permitido.

### REFUND

Devolución financiera posterior sobre una venta históricamente cerrada.

V1 incluirá soporte para VOID.

El dominio completo de REFUND queda fuera del alcance inicial.

Una CLOSED Order MUST NOT reabrirse simplemente para realizar una devolución futura.

## 8.27 Void de tarjeta externa

En V1, ComanView no controla físicamente la terminal bancaria.

```text
Por tanto, marcar:
```

```text
Payment CARD → VOIDED
```

en ComanView no ejecuta automáticamente una reversión bancaria.

Cuando aplique, el operador deberá confirmar que realizó la acción correspondiente en la terminal externa.

El sistema deberá representar correctamente su realidad administrativa local sin afirmar que controló la red bancaria.

## 8.28 Idempotencia

Toda creación o mutación crítica de Payment deberá ser idempotente.

Podrán utilizarse identificadores como:

command_id

payment_id

**Ejemplo:**

```text
CREATE PAYMENT
```

```text
command_id = abc-123
```

```text
amount = $500
```

```text
method = CARD
```

Si la UI pierde conexión después de enviar la operación y repite el mismo comando:

same command_id

Edge MUST devolver el resultado existente.

MUST NOT crear un segundo pago.

**Regla:**

Same payment command retried N times

```text
=
```

One financial effect

## 8.29 Atomicidad

Registrar un Payment deberá realizarse de forma atómica con su efecto financiero.

```text
Flujo conceptual:
```

```text
Validate Order
```

```text
↓
```

```text
Validate balance
```

```text
↓
```

```text
Create Payment
```

```text
↓
```

```text
Update financial state
```

```text
↓
```

```text
Increment Order version
```

```text
↓
```

```text
Create Event
```

```text
↓
```

```text
COMMIT
```

Si ocurre una falla antes del COMMIT:

ROLLBACK

MUST ejecutarse.

No deberá existir un Payment COMPLETED sin que la Order refleje correctamente su efecto.

## 8.30 Concurrencia

Edge deberá proteger contra pagos simultáneos basados en saldos obsoletos.

**Ejemplo:**

Cashier A sees:

```text
balance = $500
```

Cashier B sees:

```text
balance = $500
```

Ambos intentan aplicar:

$500

Edge deberá utilizar:

Estado autoritativo.

Order.version.

Transacciones.

Locking o mecanismo equivalente.

Solo deberán ejecutarse operaciones compatibles con el saldo vigente.

La cantidad mostrada previamente por un cliente MUST NOT considerarse autoritativa.

## 8.31 Precisión monetaria

Los valores monetarios MUST utilizar aritmética exacta.

Está prohibido utilizar floating point binario como representación financiera autoritativa.

No utilizar:

float

double

para cálculos de dinero.

Se deberá utilizar:

Unidades monetarias menores enteras, o

Tipo decimal exacto equivalente.

```text
Ejemplo para MXN:
```

```text
$123.45
```

```text
→ 12345 centavos
```

La misma regla aplicará a:

Precios.

Impuestos.

Descuentos.

Propinas.

Pagos.

Saldos.

Cambio.

Totales.

## 8.32 Moneda

Cada Location tendrá una moneda operacional configurada.

**Ejemplo:**

```text
currency = MXN
```

Una Order V1 utilizará una única moneda.

V1 no soportará:

Pagos multi-moneda.

Conversión de divisas.

Tipos de cambio.

## 8.33 Conciliación

ComanView deberá poder reconstruir todos los importes por método de pago.

Como mínimo:

CASH

CARD

OTHER

y separar:

Sales

Tips

Voids

Charged Totals

**Ejemplo:**

CARD

Sales Applied: $10,000

Tips:            $1,500

Charged Total:  $11,500

Este total podrá compararse contra:

Vouchers.

Cierre de terminal bancaria.

Reportes externos.

La conciliación automática bancaria queda fuera de V1.

## 8.34 Relación con Caja

Los Payments procesados mediante una sesión de caja deberán poder asociarse a:

cash_session_id

Esto permitirá que la Sección 9 reconstruya:

Ventas por método.

Efectivo esperado.

Propinas.

Totales de tarjeta.

Corte X.

Corte Z.

La lógica de caja no deberá recalcular ni reinterpretar Payments de forma distinta al dominio definido aquí.

## 8.35 Event Log

Como mínimo deberán existir eventos conceptuales equivalentes a:

PAYMENT_CREATED

PAYMENT_COMPLETED

PAYMENT_VOIDED

TIP_ADDED

Cuando:

```text
balance_due = 0
```

podrá generarse:

ORDER_PAID

Los nombres técnicos definitivos podrán refinarse posteriormente.

## 8.36 Audit Log

Las operaciones financieras sensibles deberán respetar las reglas de la Sección 6.

En particular:

Payment void.

Modificaciones sensibles.

Ajustes autorizados.

Operaciones que afecten dinero.

MUST registrar Audit Log cuando corresponda.

No deberán duplicarse dentro de esta sección las reglas generales de autorización definidas en RBAC.

## 8.37 Invariantes del Dominio

Las siguientes invariantes son obligatorias.

> **INVARIANT:** PAY-INV-01 — Ownership

> **INVARIANT:** Every Payment MUST belong to exactly one Order.

> **INVARIANT:** PAY-INV-02 — Historical Preservation

> **INVARIANT:** A completed Payment MUST NOT be physically deleted through normal operations.

> **INVARIANT:** PAY-INV-03 — Applied Payments

> **INVARIANT:** Only COMPLETED Payments MUST affect paid_amount.

> **INVARIANT:** PAY-INV-04 — Voids

> **INVARIANT:** VOIDED Payments MUST preserve their historical traceability.

> **INVARIANT:** PAY-INV-05 — Financial Authority

> **INVARIANT:** Edge MUST be the authoritative calculator of balances and payment effects.

> **INVARIANT:** PAY-INV-06 — Idempotency

> **INVARIANT:** Retrying the same payment command MUST NOT duplicate its financial effect.

> **INVARIANT:** PAY-INV-07 — Tip Separation

> **INVARIANT:** tip_amount MUST remain distinguishable from sale revenue.

> **INVARIANT:** PAY-INV-08 — Cash Tendered

> **INVARIANT:** cash_tendered MUST NOT be treated as sale revenue.

> **INVARIANT:** PAY-INV-09 — Change

> **INVARIANT:** change_given MUST NOT increase or reduce sale revenue.

> **INVARIANT:** PAY-INV-10 — Balance Protection

> **INVARIANT:** A Payment MUST NOT apply more sale value than permitted by the authoritative balance.

> **INVARIANT:** PAY-INV-11 — Exact Arithmetic

> **INVARIANT:** All monetary calculations MUST use exact monetary arithmetic.

> **INVARIANT:** PAY-INV-12 — Atomicity

> **INVARIANT:** A completed Payment MUST be persisted atomically with its financial effect.

> **INVARIANT:** PAY-INV-13 — Multiple Payments

> **INVARIANT:** Multiple Payments MAY belong to the same Order.

> **INVARIANT:** PAY-INV-14 — Partial Payment Continuity

> **INVARIANT:** An OPEN Order MAY receive new items after one or more partial payments.

> **INVARIANT:** PAY-INV-15 — Offline Operation

> **INVARIANT:** Cloud connectivity MUST NOT be required to accept or complete a local payment.

## 8.38 Fuera del alcance de V1

V1 no incluirá:

Integración directa con terminal bancaria.

PaymentAttempt avanzado.

Refunds completos sobre ventas históricas.

Chargebacks.

Tokenización de tarjetas.

Almacenamiento de PAN.

Almacenamiento de CVV.

Procesamiento PCI directo.

Pagos online.

Wallets integradas.

Gift cards.

Crédito de cliente.

Cuentas por cobrar.

Multi-moneda.

Conciliación bancaria automática.

Distribución avanzada de propinas.

Estas capacidades podrán añadirse posteriormente sin modificar los principios fundamentales de Payment.

## 8.39 Resumen normativo para implementación

```text
Payment methods V1 =
```

```text
CASH
```

```text
CARD
```

```text
OTHER
```

```text
Payment status =
```

```text
PENDING
```

```text
COMPLETED
```

```text
VOIDED
```

```text
Multiple Payments per Order =
```

```text
TRUE
```

```text
Partial Payments =
```

```text
TRUE
```

```text
Mixed Payments =
```

```text
TRUE
```

```text
Tips =
```

```text
CONFIGURABLE
```

```text
Tip modes =
```

```text
PERCENTAGE
```

```text
FIXED_AMOUNT
```

```text
Tip included in sale revenue =
```

```text
FALSE
```

```text
Tip associated with Payment =
```

```text
TRUE
```

```text
Direct bank terminal integration =
```

```text
FALSE
```

```text
Bank voucher printed by ComanView =
```

```text
FALSE
```

```text
Payment deletion after completion =
```

```text
FALSE
```

```text
VOID support V1 =
```

```text
TRUE
```

```text
Full REFUND domain V1 =
```

```text
FALSE
```

```text
Payment idempotency =
```

```text
REQUIRED
```

```text
Payment atomicity =
```

```text
REQUIRED
```

```text
Exact monetary arithmetic =
```

```text
REQUIRED
```

```text
Binary floating-point for money =
```

```text
PROHIBITED
```

```text
Multi-currency V1 =
```

```text
FALSE
```

```text
Cloud required for local payment =
```

```text
FALSE
```

## 8.40 Regla Central del Dominio

Payment deberá representar un hecho financiero explícito, trazable e independiente de la interfaz que lo originó.

Por tanto:

Edge será la autoridad sobre saldos y efectos monetarios; cada pago deberá ser atómico e idempotente; el consumo, la propina, el efectivo recibido y el cambio deberán mantenerse conceptualmente separados; y ninguna corrección financiera deberá borrar la historia original.

# 9. Caja, Turnos, Corte X y Corte Z

## 9.1 Propósito y alcance

El dominio de caja deberá representar de forma precisa el efectivo físico, las sesiones operativas de cada caja y los cierres financieros asociados.

ComanView distinguirá explícitamente entre:

CashRegister

CashSession

User

Payment

CashMovement

La caja no será tratada como una única entidad.

```text
Modelo conceptual:
```

```text
CashRegister
```

```text
└── CashSession
```

```text
├── Opening
```

```text
├── CashMovements[]
```

```text
├── Payments[]
```

```text
└── ClosingSnapshot
```

La operación deberá funcionar completamente Offline mientras Edge esté disponible.

## 9.2 CashRegister

CashRegister representa una caja o terminal lógica dentro de un Location.

Ejemplos:

CASH-01

CASH-02

BAR-CASH

Una CashRegister MAY existir independientemente del usuario que la opere.

## 9.3 CashSession

Cada apertura de caja genera una nueva CashSession.

```text
Modelo conceptual:
```

```text
CashSession
```

```text
├── cash_session_id
```

```text
├── cash_register_id
```

```text
├── location_id
```

```text
├── business_date
```

```text
├── status
```

```text
├── opened_by
```

```text
├── opened_at
```

```text
├── opening_float
```

```text
├── CashMovements[]
```

```text
├── Payments[]
```

```text
├── closed_by
```

```text
├── closed_at
```

```text
└── ClosingSnapshot
```

Una CashSession representa el periodo operativo entre apertura y Corte Z.

## 9.4 Estados de CashSession

Los estados serán únicamente:

OPEN

CLOSED

### OPEN

La sesión puede recibir operaciones financieras.

### CLOSED

La sesión fue cerrada mediante Corte Z y su estado financiero quedó congelado.

Una CLOSED CashSession MUST NOT volver a OPEN.

## 9.5 Restricción de sesión activa

Una CashRegister MUST NOT tener más de una CashSession OPEN simultáneamente.

```text
Ejemplo inválido:
```

```text
CASH-01
```

```text
├── Session A — OPEN
```

```text
└── Session B — OPEN
```

Edge deberá impedir esta condición.

## 9.6 Apertura de caja

```text
El flujo de apertura será:
```

```text
CashRegister disponible
```

```text
↓
```

```text
OPEN_CASH_SESSION
```

```text
↓
```

```text
Declarar opening_float
```

```text
↓
```

```text
Crear CashSession
```

```text
↓
```

```text
status = OPEN
```

La apertura deberá registrar:

cash_session_id

cash_register_id

business_date

opening_float

opened_by

opened_at

## 9.7 opening_float

opening_float representa el efectivo físico inicial disponible para cambio.

**Ejemplo:**

```text
opening_float = $1,500
```

MUST NOT considerarse ingreso por ventas.

Una vez creada la sesión, el fondo inicial MUST NOT modificarse silenciosamente.

Cualquier corrección deberá representarse mediante una operación explícita y auditable.

## 9.8 Fondo inicial entre sesiones

Cada nueva CashSession deberá declarar su propio opening_float.

```text
MUST NOT existir arrastre automático:
```

```text
previous_closing_cash
```

```text
→ next_opening_float
```

**Ejemplo:**

SESSION #100

Counted at close:

$8,000

Se retiran físicamente:

$6,500

Quedan en cajón:

$1,500

SESSION #101

Opening float:

$1,500

ComanView no deberá inferir cuánto efectivo permaneció físicamente entre sesiones.

## 9.9 Usuarios y sesión de caja

Una CashSession no pertenece exclusivamente a un único usuario.

Múltiples usuarios autorizados MAY operar dentro de la misma sesión.

**Ejemplo:**

CashSession #123

Opened by:

Laura

Operations by:

Laura

Ángel

Carlos

Closed by:

Laura

Cada operación deberá conservar su propio user_id.

## 9.10 Relación con Payment

Todo Payment realizado mediante el flujo de caja deberá relacionarse con:

cash_session_id

Para V1:

Un Payment registrado desde POS MUST pertenecer a una CashSession OPEN.

Esto permitirá reconstruir con precisión los movimientos incluidos en cada Corte Z.

## 9.11 CashMovement

Los movimientos de efectivo que no sean ventas deberán representarse mediante una entidad independiente.

```text
Modelo conceptual:
```

```text
CashMovement
```

```text
├── movement_id
```

```text
├── cash_session_id
```

```text
├── type
```

```text
├── amount
```

```text
├── reason
```

```text
├── created_by
```

```text
└── created_at
```

Tipos V1:

CASH_IN

CASH_OUT

### CASH_IN

Entrada física de efectivo no proveniente de una venta.

**Ejemplo:**

+$500

Fondo adicional para cambio

### CASH_OUT

Salida física de efectivo no asociada directamente a una venta.

**Ejemplo:**

-$2,000

Retiro preventivo

## 9.12 Seguridad de CashMovement

Todo CASH_IN y CASH_OUT deberá conservar:

Usuario.

Importe.

Motivo.

Fecha/hora.

Sesión.

Permisos.

Autorizador cuando corresponda.

Event Log.

Audit Log.

MUST NOT alterarse el efectivo esperado mediante ajustes invisibles.

## 9.13 Apertura manual de cajón

La acción:

OPEN_DRAWER_WITHOUT_SALE

MUST NOT considerarse un CashMovement.

Abrir el cajón no implica necesariamente que dinero haya entrado o salido.

Sí deberá generar:

Security Event

+

Audit Log

según las reglas de la Sección 6.

## 9.14 Efectivo esperado

Edge será la autoridad para calcular el efectivo teórico de la sesión.

**Conceptualmente:**

```text
expected_cash =
```

```text
opening_float
```

+ cash_sales

+ cash_in

- cash_out

- cash_refunds

Los componentes deberán provenir de transacciones autoritativas.

MUST NOT utilizarse un total escrito manualmente como fuente de verdad.

cash_tendered MUST NOT sumarse como venta.

Se utilizará el amount_applied correspondiente definido en la Sección 8.

## 9.15 Medios no efectivo

Pagos mediante:

CARD

OTHER

deberán aparecer en reportes financieros, pero MUST NOT modificar expected_cash físico salvo que el método específico represente realmente efectivo.

Para V1:

CARD payments

MUST NOT affect expected_cash

## 9.16 Corte X

El Corte X será una consulta financiera provisional de una CashSession OPEN.

Características:

MUST NOT cerrar la sesión.

MUST NOT modificar su estado.

MAY ejecutarse múltiples veces.

MUST utilizar datos autoritativos actuales.

**Ejemplo:**

CORTE X

Opening Float       $1,500

Cash Sales          $8,000

Card Sales         $12,000

Tips                $1,800

Cash In               $500

Cash Out            $2,000

Expected Cash       $8,000

El Corte X es informativo.

## 9.17 Permiso para Corte X

La operación deberá utilizar un permiso específico, por ejemplo:

VIEW_X_REPORT

```text
Política inicial:
```

```text
OWNER    → permitido
```

```text
MANAGER  → permitido
```

```text
CASHIER  → configurable
```

```text
WAITER   → no
```

```text
KITCHEN  → no
```

La fuente real de autorización será RBAC.

## 9.18 Corte Z

El Corte Z representa el cierre definitivo de una CashSession.

```text
Flujo:
```

```text
CashSession OPEN
```

```text
↓
```

```text
Validaciones
```

```text
↓
```

```text
Conteo físico
```

```text
↓
```

```text
Reconciliación
```

```text
↓
```

```text
ClosingSnapshot
```

```text
↓
```

```text
status = CLOSED
```

```text
↓
```

```text
Z Report
```

A diferencia del Corte X:

**Corte Z modifica el estado del dominio.**

## 9.19 Conteo físico

Durante el cierre, el usuario deberá introducir:

counted_cash

que representa el efectivo físico contado.

Edge calculará:

```text
difference =
```

```text
counted_cash
```

- expected_cash

El usuario MUST NOT introducir manualmente la diferencia como valor autoritativo.

## 9.20 Diferencias de caja

```text
Las diferencias se interpretarán conceptualmente como:
```

```text
difference = 0
```

```text
→ BALANCED
```

```text
difference > 0
```

```text
→ OVER
```

```text
difference < 0
```

```text
→ SHORT
```

**Ejemplo:**

Expected Cash:

$8,000

Counted Cash:

$7,950

Difference:

-$50

Result:

SHORT

La diferencia MUST conservarse históricamente.

## 9.21 Diferencia no bloquea automáticamente el cierre

Una diferencia de caja MUST NOT impedir automáticamente realizar Corte Z.

```text
Si existe diferencia:
```

```text
Difference detected
```

```text
↓
```

```text
Reason / Comment
```

```text
↓
```

```text
Authorization if required
```

```text
↓
```

```text
Audit
```

```text
↓
```

```text
Allow close
```

El objetivo es registrar la realidad financiera, no forzar artificialmente que el cajero haga coincidir el conteo.

## 9.22 Tolerancia de diferencia

ComanView deberá permitir una configuración equivalente a:

cash_difference_tolerance

**Ejemplo:**

± $5

Si la diferencia se encuentra dentro del umbral, podrá considerarse tolerancia normal.

Si lo supera, MAY requerir:

Motivo obligatorio.

Autorización de Manager.

Audit Log reforzado.

La política será configurable por establecimiento.

## 9.23 Blind Cash Count

V1 deberá soportar:

```text
blind_cash_count = true | false
```

Cuando esté habilitado, el usuario que cuenta la caja MUST NOT ver expected_cash antes de confirmar counted_cash.

```text
Flujo:
```

```text
¿Cuánto efectivo hay?
```

```text
↓
```

```text
Usuario cuenta
```

```text
↓
```

```text
$7,950
```

```text
↓
```

```text
CONFIRMAR
```

```text
↓
```

```text
Expected: $8,000
```

```text
Difference: -$50
```

Esto reduce la posibilidad de declarar artificialmente el importe esperado.

## 9.24 Propinas y Corte Z

Los reportes deberán mantener separadas:

Sales

Tips

Charged Total

**Ejemplo:**

CARD

Sales:         $12,000

Tips:           $1,800

Charged Total: $13,800

La propina MUST NOT incorporarse silenciosamente al ingreso de venta.

Esto deberá respetar las reglas de la Sección 8.

## 9.25 Conciliación de tarjeta

Como V1 no integra directamente la terminal bancaria, ComanView podrá calcular:

Expected Card Total

a partir de los Payments CARD registrados.

Este importe podrá compararse manualmente contra:

Vouchers.

Cierre del datáfono.

Reportes del adquirente.

V1 MUST NOT declarar conciliación bancaria automática.

## 9.26 Ventas vs. efectivo físico

Los reportes deberán distinguir estrictamente entre:

SALES

y:

CASH DRAWER

**Ejemplo:**

Total Sales:

$20,000

Expected Cash Drawer:

$8,000

puede ser completamente correcto debido a:

Pagos con tarjeta.

Fondo inicial.

Entradas.

Salidas.

Propinas.

Otros medios de pago.

## 9.27 Órdenes abiertas y Corte Z

Una CashSession MUST NOT cerrar si existen operaciones financieras incompletas asociadas a ella.

Ejemplos bloqueantes:

Payment PENDING

Financial transaction incomplete

Inconsistent payment state

Sin embargo, una mesa abierta sin pagos pendientes MAY continuar existiendo mientras una caja realiza Corte Z.

Por tanto:

Open Table

≠

Automatic Z Block

siempre que no exista conflicto financiero con la sesión.

## 9.28 Cambio de personal

El cambio de cajero o mesero MUST NOT obligar a cerrar todas las Orders.

Los siguientes dominios se mantendrán separados:

Employee Shift

CashSession

Order Lifecycle

V1 no implementará gestión laboral completa de turnos.

## 9.29 ClosingSnapshot

Al ejecutar Corte Z deberá generarse una representación financiera final e inmutable.

```text
Modelo conceptual:
```

```text
ClosingSnapshot
```

```text
├── opening_float
```

```text
├── sales_by_method
```

```text
├── tips_by_method
```

```text
├── cash_in
```

```text
├── cash_out
```

```text
├── expected_cash
```

```text
├── counted_cash
```

```text
├── difference
```

```text
├── voids
```

```text
├── discounts
```

```text
├── comps
```

```text
├── opened_at
```

```text
├── closed_at
```

```text
├── opened_by
```

```text
└── closed_by
```

Este snapshot será la fuente histórica del Corte Z.

MUST NOT modificarse después del cierre mediante flujos normales.

## 9.30 Z Report

El reporte generado a partir del cierre deberá contener como mínimo:

Location

Cash Register

Cash Session

Business Date

Opened At

Closed At

Opened By

Closed By

Opening Float

Sales by Method

Tips by Method

Cash In

Cash Out

Expected Cash

Counted Cash

Difference

Voids

Discounts

Comps

Totals

La presentación visual podrá evolucionar sin alterar el dominio.

## 9.31 Impresión del Corte Z

Cerrar una sesión y imprimir el reporte serán operaciones separadas.

```text
Flujo:
```

```text
CLOSE_CASH_SESSION
```

```text
↓
```

```text
Persist ClosingSnapshot
```

```text
↓
```

```text
Set CLOSED
```

```text
↓
```

```text
COMMIT
```

```text
↓
```

```text
Create Z Print Job
```

Si la impresión falla:

```text
CashSession = CLOSED
```

```text
Print Job = FAILED
```

La sesión continuará válidamente cerrada.

El reporte podrá reimprimirse conforme a las reglas de la Sección 5.

## 9.32 Atomicidad del cierre

CLOSE_CASH_SESSION deberá ser una operación atómica.

```text
Conceptualmente:
```

```text
Validate session
```

```text
↓
```

```text
Calculate totals
```

```text
↓
```

```text
Record counted_cash
```

```text
↓
```

```text
Calculate difference
```

```text
↓
```

```text
Create ClosingSnapshot
```

```text
↓
```

```text
Set CLOSED
```

```text
↓
```

```text
Create Events
```

```text
↓
```

```text
Create Audit
```

```text
↓
```

```text
COMMIT
```

Si falla antes del commit:

ROLLBACK

MUST ejecutarse.

No deberá existir una sesión parcialmente cerrada.

## 9.33 Idempotencia del Corte Z

CLOSE_CASH_SESSION deberá utilizar idempotencia.

**Ejemplo:**

```text
command_id = XYZ
```

Si el POS pierde conexión después del cierre y reintenta el mismo comando:

same command_id

Edge MUST devolver el cierre existente.

MUST NOT:

Cerrar dos veces.

Generar dos cierres.

Duplicar eventos financieros.

## 9.34 Inmutabilidad del cierre

Una CashSession CLOSED MUST NOT modificarse mediante flujo normal.

No existirá:

EDIT_Z_REPORT

Si posteriormente se descubre un problema, deberá registrarse mediante:

Nueva operación.

Ajuste explícito.

Auditoría.

Nunca reescribiendo el cierre histórico.

## 9.35 Suspensión de licencia y cierre de turno

La política de Cierre de Turno Garantizado definida en la Sección 3 deberá aplicarse directamente sobre CashSession.

Si Cloud confirma:

```text
license_status = SUSPENDED
```

mientras:

```text
CashSession.status = OPEN
```

ComanView deberá permitir:

Continuar operaciones activas.

Cobrar.

Completar Orders.

Ejecutar Corte X.

Ejecutar Corte Z.

Después:

```text
CashSession = CLOSED
```

```text
License = SUSPENDED
```

ComanView MUST NOT permitir:

OPEN_NEW_CASH_SESSION

sin una reactivación válida.

## 9.36 Operación Offline

Cloud MUST NOT ser necesario para ejecutar:

OPEN_CASH_SESSION

CASH_IN

CASH_OUT

X_REPORT

PAYMENT

COUNT_CASH

CLOSE_CASH_SESSION

Z_REPORT

Todas estas operaciones deberán ejecutarse contra Edge.

La sincronización con Cloud ocurrirá posteriormente.

## 9.37 Recuperación tras reinicio

Una CashSession OPEN deberá persistir después de reiniciar Edge.

**Regla:**

Edge restart

≠

CashSession close

Al recuperar el servicio:

```text
CashSession.status = OPEN
```

deberá continuar intacta hasta un cierre explícito.

## 9.38 Jornada operativa — business_date

Cada CashSession deberá tener:

business_date

independiente de la fecha calendario obtenida directamente del timestamp.

**Ejemplo:**

business_date:

2026-08-12

opened_at:

2026-08-12 18:00

closed_at:

2026-08-13 03:00

Todas las operaciones podrán pertenecer a la jornada:

2026-08-12

aunque parte de ellas ocurra después de medianoche.

## 9.39 Regla de business_date

business_date representa el día operativo del negocio, no necesariamente:

DATE(timestamp)

MUST NOT derivarse únicamente del cambio de fecha a medianoche.

La política exacta de asignación podrá depender de la configuración del establecimiento.

## 9.40 Corte automático por medianoche

ComanView MUST NOT cerrar automáticamente una CashSession únicamente porque cambió el día calendario.

Una sesión válida puede ser:

Opened:

22:00

Closed:

03:00

El Corte Z define el fin de la jornada financiera de esa caja.

## 9.41 Event Log

Como mínimo deberán existir eventos conceptuales equivalentes a:

CASH_SESSION_OPENED

CASH_IN_RECORDED

CASH_OUT_RECORDED

CASH_DRAWER_OPENED_MANUALLY

X_REPORT_GENERATED

CASH_COUNT_RECORDED

CASH_DIFFERENCE_DETECTED

CASH_SESSION_CLOSED

Z_REPORT_GENERATED

Los nombres definitivos podrán refinarse durante implementación.

## 9.42 Audit Log

Las operaciones sensibles deberán respetar la Sección 6.

En particular:

CASH_IN.

CASH_OUT.

Apertura manual de cajón.

Diferencias relevantes.

Cierre Z.

Autorizaciones por tolerancia.

Reimpresiones sensibles.

MUST conservar trazabilidad de usuario y autorización cuando corresponda.

## 9.43 Invariantes del Dominio

Las siguientes invariantes son obligatorias.

> **INVARIANT:** CASH-INV-01 — Ownership

> **INVARIANT:** Every CashSession MUST belong to exactly one CashRegister and one Location.

> **INVARIANT:** CASH-INV-02 — Single Active Session

> **INVARIANT:** A CashRegister MUST NOT have more than one OPEN CashSession.

> **INVARIANT:** CASH-INV-03 — Finality

> **INVARIANT:** A CLOSED CashSession MUST NOT return to OPEN.

> **INVARIANT:** CASH-INV-04 — Opening Float

> **INVARIANT:** opening_float MUST NOT be counted as sales revenue.

> **INVARIANT:** CASH-INV-05 — CashMovement Ownership

> **INVARIANT:** Every CashMovement MUST belong to exactly one CashSession.

> **INVARIANT:** CASH-INV-06 — Movement Traceability

> **INVARIANT:** Every CASH_IN and CASH_OUT MUST preserve user, amount, reason and timestamp.

> **INVARIANT:** CASH-INV-07 — Drawer Opening

> **INVARIANT:** Manual cash drawer opening MUST NOT implicitly create a CashMovement.

> **INVARIANT:** CASH-INV-08 — Non-Cash Payments

> **INVARIANT:** CARD Payments MUST NOT affect physical expected_cash.

> **INVARIANT:** CASH-INV-09 — Financial Authority

> **INVARIANT:** expected_cash MUST be calculated by Edge from authoritative transactions.

> **INVARIANT:** CASH-INV-10 — Difference Calculation

> **INVARIANT:** Cash difference MUST be calculated by Edge and MUST NOT be supplied as an authoritative input.

> **INVARIANT:** CASH-INV-11 — Difference Preservation

> **INVARIANT:** A cash difference MUST NOT be silently discarded or rewritten.

> **INVARIANT:** CASH-INV-12 — X Report

> **INVARIANT:** An X Report MUST NOT modify or close the CashSession.

> **INVARIANT:** CASH-INV-13 — Z Uniqueness

> **INVARIANT:** A Z Report MUST correspond to exactly one final CashSession closure.

> **INVARIANT:** CASH-INV-14 — Closure Safety

> **INVARIANT:** Closing a CashSession MUST be atomic and idempotent.

> **INVARIANT:** CASH-INV-15 — Print Independence

> **INVARIANT:** A printing failure MUST NOT invalidate a successfully completed Z closure.

> **INVARIANT:** CASH-INV-16 — Restart Persistence

> **INVARIANT:** Restarting Edge MUST NOT implicitly close an OPEN CashSession.

> **INVARIANT:** CASH-INV-17 — Offline Operation

> **INVARIANT:** Cloud connectivity MUST NOT be required for local cash operations or closure.

> **INVARIANT:** CASH-INV-18 — Operational Date

> **INVARIANT:** business_date MUST represent the operational business day and MUST NOT be inferred solely from calendar midnight.

## 9.44 Fuera del alcance de V1

V1 no incluirá:

Conciliación bancaria automática.

Depósitos bancarios integrados.

Cajas fuertes inteligentes.

Cash recycler.

Gestión de bóveda.

Nómina.

Control laboral de turnos.

Distribución de propinas.

Contabilidad general.

Cierre fiscal electrónico integrado.

Consolidación financiera multi-sucursal avanzada.

Estas capacidades podrán incorporarse posteriormente sin modificar las reglas centrales de CashSession.

## 9.45 Resumen normativo para implementación

```text
CashSession status =
```

```text
OPEN
```

```text
CLOSED
```

```text
One OPEN session per CashRegister =
```

```text
REQUIRED
```

```text
Explicit opening_float =
```

```text
REQUIRED
```

```text
Automatic float carry-over =
```

```text
PROHIBITED
```

```text
Multiple users per CashSession =
```

```text
ALLOWED
```

```text
CashMovement types =
```

```text
CASH_IN
```

```text
CASH_OUT
```

```text
Opening float treated as sales =
```

```text
FALSE
```

```text
Manual drawer opening creates CashMovement =
```

```text
FALSE
```

```text
X Report closes session =
```

```text
FALSE
```

```text
Z Report closes session =
```

```text
TRUE
```

```text
Blind Cash Count =
```

```text
CONFIGURABLE
```

```text
Cash difference tolerance =
```

```text
CONFIGURABLE
```

```text
Cash difference automatically blocks Z =
```

```text
FALSE
```

```text
Card affects physical expected_cash =
```

```text
FALSE
```

```text
ClosingSnapshot =
```

```text
REQUIRED
```

```text
Z closure immutable =
```

```text
TRUE
```

```text
Z closure atomic =
```

```text
REQUIRED
```

```text
Z closure idempotent =
```

```text
REQUIRED
```

```text
Automatic midnight closure =
```

```text
PROHIBITED
```

```text
business_date =
```

```text
REQUIRED
```

```text
Cloud required for local cash operation =
```

```text
FALSE
```

## 9.46 Regla Central del Dominio

CashSession deberá representar una jornada financiera real y auditable de una caja, no simplemente un contador acumulado de ventas.

Por tanto:

Edge calculará el dinero esperado a partir de transacciones autoritativas; el usuario declarará únicamente el efectivo físicamente contado; toda diferencia se conservará; y el Corte Z congelará de forma atómica e inmutable la realidad financiera de esa sesión.

# 10. Catálogo, Productos, Precios, Impuestos y Modificadores

## 10.1 Propósito y alcance

El dominio de catálogo define qué puede vender ComanView, a qué precio, bajo qué tratamiento fiscal, con qué modificadores y hacia qué estación debe dirigirse cada producto.

```text
Modelo conceptual:
```

```text
Catalog
```

```text
├── Categories[]
```

```text
├── Products[]
```

```text
│   ├── ModifierGroups[]
```

```text
│   │   └── Modifiers[]
```

```text
│   ├── Price
```

```text
│   ├── TaxProfile
```

```text
│   └── PreparationStation
```

```text
└── Availability
```

El catálogo representa el estado comercial vigente.

Las ventas históricas MUST utilizar snapshots transaccionales y MUST NOT depender del estado actual del catálogo.

## 10.2 Product

Product será la entidad vendible central.

```text
Modelo conceptual:
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

Cada Product:

MUST tener un product_id globalmente único e inmutable.

MUST pertenecer al contexto comercial de un Tenant.

MUST poder resolverse operacionalmente dentro de un Location.

MAY tener una estación de preparación.

MAY tener grupos de modificadores.

MUST conservar referencias históricas aunque deje de venderse.

## 10.3 active vs. available

Estos estados representan conceptos distintos.

### active

Indica si el producto continúa formando parte del catálogo comercial vigente.

```text
active = false
```

significa que dejó de ofrecerse normalmente.

### available

Indica si actualmente puede venderse.

```text
active = true
```

```text
available = false
```

representa un producto existente pero temporalmente agotado o no disponible.

**Regla:**

INACTIVE

≠

UNAVAILABLE

Esta separación permitirá operaciones rápidas de 86 / agotado sin desactivar ni eliminar permanentemente el producto.

## 10.4 Eliminación de productos

Un producto utilizado históricamente MUST NOT eliminarse físicamente mediante el flujo normal.

Si deja de venderse:

```text
active = false
```

Las ventas anteriores continuarán conservando:

product_id.

Nombre histórico.

Precio histórico.

Impuestos históricos.

Modificadores.

Estación utilizada.

La desactivación comercial MUST NOT destruir referencias históricas.

## 10.5 Categorías

Category organiza los productos principalmente para navegación y UX.

```text
Modelo conceptual:
```

```text
Category
```

```text
├── category_id
```

```text
├── name
```

```text
├── display_order
```

```text
├── active
```

```text
└── optional_image
```

Ejemplos:

Tacos

Hamburguesas

Bebidas

Postres

En V1, cada producto tendrá una categoría principal.

Clasificación múltiple avanzada mediante etiquetas queda fuera del alcance inicial.

## 10.6 Orden de visualización

Categorías y productos deberán soportar:

display_order

La interfaz MUST NOT depender exclusivamente de:

Orden alfabético.

ID.

Fecha de creación.

El establecimiento deberá poder priorizar visualmente los elementos más utilizados.

## 10.7 Tipos de producto

La arquitectura contemplará:

product_type

pero V1 implementará funcionalmente principalmente:

STANDARD

Tipos futuros podrán incluir:

COMBO

WEIGHTED

SERVICE

RECIPE_BASED

La existencia futura de nuevos tipos MUST NOT requerir rediseñar la identidad básica de Product.

## 10.8 Precio base

Cada producto tendrá:

base_price

Todos los valores monetarios deberán respetar la Sección 8.

MUST utilizarse:

Unidades monetarias menores enteras, o

Tipo decimal exacto equivalente.

MUST NOT utilizarse floating point binario como fuente financiera autoritativa.

```text
Ejemplo:
```

```text
$149.50 MXN
```

```text
→ 14950 minor units
```

## 10.9 Autoridad de precios

El cliente puede solicitar:

ADD_PRODUCT(product_id)

pero MUST NOT determinar autoritativamente el precio del producto.

Edge deberá resolver:

Producto vigente.

Precio.

Modificadores.

Tratamiento fiscal.

Estación.

Disponibilidad.

**Regla:**

**The client selects a Product; Edge resolves its authoritative commercial configuration.**

## 10.10 Snapshot inmediato de OrderItem

El snapshot comercial deberá producirse cuando el producto sea incorporado a la Order.

**Ejemplo:**

Product:

```text
Hamburguesa = $150
```

```text
ADD ITEM
```

```text
↓
```

```text
OrderItem snapshot
```

```text
price = $150
```

Desde ese momento, cambios posteriores del catálogo MUST NOT modificar ese OrderItem.

Esto aplica tanto a:

DRAFT

como a:

SENT

## 10.11 Cambio de precio con Orders abiertas

**Ejemplo:**

```text
18:00
```

```text
Hamburguesa = $150
```

```text
Order #100
```

```text
→ añade Hamburguesa
```

```text
→ snapshot = $150
```

```text
19:00
```

```text
Owner changes Product
```

```text
$150 → $170
```

La hamburguesa existente en Order #100 continúa:

$150

Si posteriormente se añade otra unidad mediante una nueva operación:

```text
new OrderItem snapshot = $170
```

ComanView MUST NOT recalcular ítems ya existentes.

## 10.12 Aplicación del nuevo precio a un DRAFT existente

Si un usuario necesita aplicar la nueva configuración a un ítem DRAFT, deberá realizar una operación explícita:

```text
REMOVE DRAFT ITEM
```

```text
↓
```

```text
ADD PRODUCT AGAIN
```

MUST NOT existir actualización retroactiva automática del snapshot.

Esto proporciona un punto inequívoco para determinar qué precio fue aceptado.

## 10.13 Cambio manual arbitrario de precio

V1 MUST NOT proporcionar una función general de:

EDIT_ITEM_PRICE

durante una venta normal.

El precio deberá provenir de:

base_price

+ modifier price deltas

- authorized discounts/comps

Si posteriormente se requieren productos de precio abierto, deberán implementarse como capacidad específica, protegida por RBAC y Audit Log.

## 10.14 ModifierGroup

Los modificadores se organizarán mediante grupos.

```text
Modelo:
```

```text
ModifierGroup
```

```text
├── modifier_group_id
```

```text
├── name
```

```text
├── min_selections
```

```text
├── max_selections
```

```text
├── display_order
```

```text
└── Modifiers[]
```

**Ejemplo:**

Término de carne

```text
min_selections = 1
```

```text
max_selections = 1
```

```text
├── Medio
```

```text
├── 3/4
```

```text
└── Bien cocido
```

min_selections y max_selections serán la fuente normativa.

No será obligatorio mantener un campo redundante required.

**Conceptualmente:**

```text
required = min_selections > 0
```

## 10.15 Validación de selección

Antes de que un OrderItem pueda enviarse válidamente a preparación, todas las reglas de sus grupos deberán satisfacerse.

**Ejemplo:**

```text
min = 1
```

```text
max = 1
```

requiere exactamente una opción.

**Ejemplo:**

```text
min = 0
```

```text
max = 3
```

permite hasta tres opciones.

Edge MUST validar estas restricciones.

La UI deberá asistir al usuario, pero no será la autoridad final.

## 10.16 Modifier

```text
Modelo conceptual:
```

```text
Modifier
```

```text
├── modifier_id
```

```text
├── name
```

```text
├── default_price_delta
```

```text
├── active
```

```text
├── available
```

```text
└── display_order
```

Ejemplos:

Sin cebolla

```text
price_delta = 0
```

Extra queso

```text
price_delta = +$15
```

Los modificadores MAY aumentar, mantener o reducir el precio.

## 10.17 Cantidad de modificadores

V1 soportará cantidad cuando el modificador lo permita.

**Ejemplo:**

Extra queso ×2

Cálculo:

2 × $15

= $30

Esto deberá representarse explícitamente, evitando crear opciones duplicadas artificialmente.

## 10.18 Reutilización de ModifierGroup

Un ModifierGroup MAY asociarse a múltiples productos.

```text
Ejemplo:
```

```text
Meat Temperature
```

```text
├── Medio
```

```text
├── 3/4
```

```text
└── Bien cocido
```

podrá utilizarse en:

Hamburguesa Clásica

Hamburguesa BBQ

Steak

La relación deberá permitir reutilización sin duplicar innecesariamente configuraciones.

## 10.19 Override de precio por producto

El precio de un mismo modificador MAY variar según el producto.

**Ejemplo:**

Extra queso

Hamburguesa:

+$15

Pizza:

+$30

La arquitectura deberá permitir una relación equivalente a:

```text
ProductModifierOption
```

```text
├── modifier_id
```

```text
└── price_delta_override
```

El modificador podrá tener:

default_price_delta

y la asociación específica podrá proporcionar un override.

**Regla:**

```text
effective_modifier_price =
```

```text
price_delta_override
```

```text
OR
```

```text
default_price_delta
```

según configuración.

## 10.20 Snapshot de modificadores

Cuando un modificador forme parte de un OrderItem, deberá conservarse un snapshot suficiente.

Como mínimo:

modifier_id

name

price_delta

quantity

**Ejemplo:**

Today:

```text
Extra queso = $15
```

Tomorrow:

```text
Extra queso = $20
```

La venta anterior MUST continuar registrando:

$15

## 10.21 Variantes

V1 no implementará una entidad independiente ProductVariant.

Opciones como:

Coca-Cola

355 ml

600 ml

1 L

podrán modelarse inicialmente mediante un ModifierGroup obligatorio:

Tamaño

```text
min = 1
```

```text
max = 1
```

Esto reduce la complejidad inicial.

ProductVariant podrá incorporarse posteriormente si inventarios/SKU avanzados lo requieren.

## 10.22 Estaciones de preparación

Cada producto MAY tener:

station_id

```text
Ejemplo:
```

```text
Taco        → COCINA
```

```text
Margarita   → BARRA
```

```text
Pastel      → POSTRES
```

La estación alimentará:

Routing Engine.

KDS.

Print Manager.

Un producto que no requiere preparación MAY utilizar:

```text
station_id = null
```

**Ejemplo:**

Agua embotellada

## 10.23 Snapshot de estación

La estación vigente deberá formar parte del snapshot operacional del OrderItem.

Mientras el ítem permanezca DRAFT, su snapshot original continúa siendo la referencia salvo que el ítem se elimine y vuelva a agregarse.

Una vez:

```text
send_status = SENT
```

su destino MUST quedar congelado.

Un cambio posterior de:

Product.station_id

MUST NOT redirigir una comanda histórica ya enviada.

## 10.24 Disponibilidad

Un usuario autorizado podrá modificar:

```text
available = false
```

para suspender temporalmente nuevas ventas del producto.

**Ejemplo:**

```text
Hamburguesa
```

```text
active = true
```

```text
available = false
```

El producto:

Permanece en catálogo.

Conserva referencias históricas.

SHOULD aparecer visualmente como no disponible según UX.

MUST NOT agregarse normalmente a nuevas Orders.

## 10.25 Disponibilidad y Orders existentes

Si un producto cambia a:

```text
available = false
```

después de haber sido agregado:

### SENT

No ocurre ninguna modificación.

### DRAFT

MUST NOT eliminarse automáticamente.

El ítem conserva su snapshot.

La UI MAY mostrar una advertencia, pero cualquier resolución deberá ser explícita.

**Regla:**

Catalog availability changes MUST NOT silently mutate existing Orders.

## 10.26 TaxProfile

El tratamiento fiscal no deberá estar hardcodeado directamente dentro del frontend o de reglas específicas por producto.

```text
Se utilizará una entidad conceptual:
```

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

**Ejemplo:**

IVA 16%

```text
rate = 16%
```

Cada Product utilizará un TaxProfile en V1 cuando aplique.

## 10.27 Modos de impuesto

La arquitectura deberá soportar:

TAX_INCLUDED

TAX_ADDED

### TAX_INCLUDED

El precio mostrado incluye el impuesto.

Displayed price: $116

Tax component:    $16

Final price:     $116

### TAX_ADDED

El impuesto se agrega al precio base.

Base:  $100

Tax:    $16

Total: $116

El tratamiento deberá ser determinado por Edge.

## 10.28 Impuestos múltiples

```text
V1 utilizará conceptualmente:
```

```text
Product
```

```text
→ one TaxProfile
```

No se implementará un motor fiscal multi-jurisdicción complejo.

La arquitectura MAY permitir que TaxProfile evolucione posteriormente para contener múltiples reglas internas.

## 10.29 Snapshot fiscal

Cada OrderItem deberá conservar información fiscal suficiente para reconstruir la operación histórica.

Como mínimo, conceptualmente:

tax_profile_id

tax_name

tax_rate

tax_mode

tax_amount

Cambiar posteriormente un TaxProfile MUST NOT recalcular Orders existentes.

## 10.30 Impuestos sobre modificadores

En V1, los modificadores con impacto monetario heredarán el tratamiento fiscal del producto principal.

**Ejemplo:**

Hamburguesa

+ Extra queso

utilizará el mismo TaxProfile para ambos componentes del precio.

Impuestos independientes por modificador quedan fuera de V1.

## 10.31 Política de redondeo

Todos los cálculos fiscales deberán utilizar una política centralizada y determinista.

MUST NOT depender de comportamientos implícitos de JavaScript, frontend o dispositivo.

**Regla:**

Tax rounding MUST be deterministic and authoritative in Edge.

La implementación técnica deberá definir explícitamente:

Precisión interna.

Punto de redondeo.

Minor units.

Modo de redondeo.

## 10.32 Descuentos y catálogo

Los descuentos y cortesías MUST NOT modificar el base_price del producto para representar una venta particular.

```text
Ejemplo incorrecto:
```

```text
Product.base_price
```

```text
$150 → $100
```

para aplicar una promoción a una mesa.

La separación correcta será:

Catalog price

$150

Order adjustment

-$50

Los descuentos y comps pertenecen al dominio transaccional.

## 10.33 Auditoría de precios

Todo cambio autorizado de precio deberá generar trazabilidad.

**Ejemplo:**

PRODUCT_PRICE_CHANGED

before:

$150

after:

$170

Audit Log deberá conservar como mínimo:

Usuario.

Producto.

Valor anterior.

Valor nuevo.

Fecha/hora.

Esto deberá respetar la Sección 6.

## 10.34 Auditoría fiscal

Los cambios relevantes en:

TaxProfile.

Tasa.

Modo.

Asignación fiscal.

deberán conservar:

before

after

user

timestamp

Los cambios fiscales MUST NOT reescribir ventas históricas.

## 10.35 Edición Offline

Usuarios locales autorizados podrán modificar el catálogo sin conexión a Cloud.

Según permisos, podrán modificar:

Productos.

Categorías.

Precio.

Disponibilidad.

Modificadores.

Estaciones.

TaxProfiles permitidos.

```text
Flujo:
```

```text
Local administrative change
```

```text
↓
```

```text
Edge validation
```

```text
↓
```

```text
Local persistence
```

```text
↓
```

```text
Version increment
```

```text
↓
```

```text
Event / Audit if applicable
```

```text
↓
```

```text
Later Cloud sync
```

Cloud MUST NOT ser necesario para administrar el catálogo operacional local.

## 10.36 Sincronización del catálogo

El catálogo utilizará principalmente:

State synchronization

+

Versioning

y no Event Sourcing puro para cada campo.

Las entidades deberán conservar información equivalente a:

version

updated_at

updated_by

cuando corresponda.

Los conflictos administrativos MUST ser detectables.

ComanView MUST NOT depender de un last write wins ciego para cambios sensibles.

La estrategia técnica completa se definirá en la Sección 12.

## 10.37 Imágenes

Los productos MAY tener una referencia visual:

image_reference

Las imágenes serán opcionales.

Un producto MUST poder operar correctamente sin imagen.

Los recursos necesarios para operación local SHOULD estar disponibles o cacheados localmente para evitar dependencia de Internet.

## 10.38 SKU y códigos

V1 permitirá campos opcionales como:

sku

barcode

No serán obligatorios.

Servirán para:

Búsqueda.

Importación.

Scanner futuro.

Inventario futuro.

Integraciones.

## 10.39 Búsqueda

El catálogo SHOULD permitir búsqueda mediante:

Nombre.

SKU.

Barcode/código cuando exista.

Esto deberá funcionar utilizando los datos disponibles localmente en Edge.

## 10.40 Capacidades fuera de V1

V1 no incluirá:

Inventario por recetas.

Costeo.

Proveedores.

Combos complejos.

Promociones automáticas.

Happy Hour.

Pricing programado.

Pricing dinámico.

ProductVariant avanzado.

Matrices SKU.

Productos por peso.

Menús por horario.

Menús por canal.

Multi-moneda.

Motor fiscal multi-jurisdicción avanzado.

Impuestos independientes por modificador.

Integraciones delivery.

Nutrición/alérgenos avanzados.

Estas capacidades podrán incorporarse posteriormente sin alterar los principios fundamentales del catálogo.

## 10.41 Invariantes del Dominio

Las siguientes invariantes son obligatorias.

> **INVARIANT:** CAT-INV-01 — Product Identity

> **INVARIANT:** Every Product MUST have a globally unique and immutable product_id.

> **INVARIANT:** CAT-INV-02 — Historical Independence

> **INVARIANT:** Historical OrderItems MUST NOT depend financially on current Product state.

> **INVARIANT:** CAT-INV-03 — Price Snapshot

> **INVARIANT:** Changing Product.base_price MUST NOT alter existing OrderItem snapshots.

> **INVARIANT:** CAT-INV-04 — Historical References

> **INVARIANT:** Inactive Products MUST preserve all historical references.

> **INVARIANT:** CAT-INV-05 — Availability

> **INVARIANT:** Unavailable Products MUST NOT be added to new Orders through normal flows.

> **INVARIANT:** CAT-INV-06 — State Separation

> **INVARIANT:** active and available MUST remain distinct concepts.

> **INVARIANT:** CAT-INV-07 — Price Authority

> **INVARIANT:** All authoritative Product prices MUST be resolved or validated by Edge.

> **INVARIANT:** CAT-INV-08 — Exact Money

> **INVARIANT:** All monetary catalog values MUST use exact monetary arithmetic.

> **INVARIANT:** CAT-INV-09 — Modifier Rules

> **INVARIANT:** Modifier selections MUST satisfy their min_selections and max_selections rules before an item may be validly sent.

> **INVARIANT:** CAT-INV-10 — Modifier Snapshot

> **INVARIANT:** Existing modifier price snapshots MUST NOT change when current modifier prices change.

> **INVARIANT:** CAT-INV-11 — Routing Finality

> **INVARIANT:** A SENT OrderItem routing destination MUST NOT change retroactively.

> **INVARIANT:** CAT-INV-12 — Tax Authority

> **INVARIANT:** Tax calculations MUST be deterministic and performed or validated by Edge.

> **INVARIANT:** CAT-INV-13 — Historical Tax

> **INVARIANT:** Historical tax snapshots MUST NOT be recalculated from current TaxProfiles.

> **INVARIANT:** CAT-INV-14 — Administrative Audit

> **INVARIANT:** Price and tax changes MUST preserve audit traceability.

> **INVARIANT:** CAT-INV-15 — Transaction Protection

> **INVARIANT:** Catalog updates MUST NOT silently delete or mutate existing transactional history.

> **INVARIANT:** CAT-INV-16 — Optional Preparation

> **INVARIANT:** A Product MAY exist without a preparation station.

> **INVARIANT:** CAT-INV-17 — Offline Catalog

> **INVARIANT:** Cloud connectivity MUST NOT be required to read or modify the authorized local operational catalog.

> **INVARIANT:** CAT-INV-18 — Pricing Separation

> **INVARIANT:** Discounts and comps MUST NOT rewrite Product.base_price for individual sales.

## 10.42 Resumen normativo para implementación

```text
Product entity =
```

```text
REQUIRED
```

```text
Product active state =
```

DISTINCT FROM availability

```text
Physical Product deletion after historical use =
```

```text
PROHIBITED
```

```text
Primary category per Product V1 =
```

```text
ONE
```

```text
display_order =
```

```text
REQUIRED FOR UX ORDERING
```

```text
Functional Product type V1 =
```

```text
STANDARD
```

```text
Product architecture extensible =
```

```text
TRUE
```

```text
base_price exact arithmetic =
```

```text
REQUIRED
```

```text
Manual arbitrary item price editing =
```

```text
PROHIBITED
```

```text
OrderItem snapshot moment =
```

```text
ITEM CREATION
```

```text
Catalog changes mutate existing DRAFT items =
```

```text
FALSE
```

```text
Catalog changes mutate SENT items =
```

```text
FALSE
```

```text
Modifier model =
```

```text
ModifierGroup → Modifier
```

```text
Modifier constraints =
```

```text
min_selections
```

```text
max_selections
```

```text
Modifier quantity =
```

```text
SUPPORTED
```

```text
Negative modifier price delta =
```

```text
SUPPORTED
```

```text
Reusable ModifierGroups =
```

```text
SUPPORTED
```

```text
Per-product modifier price override =
```

```text
SUPPORTED
```

```text
Independent ProductVariant V1 =
```

```text
FALSE
```

```text
Preparation station mandatory =
```

```text
FALSE
```

```text
SENT routing destination mutable =
```

```text
FALSE
```

```text
Tax model =
```

```text
TaxProfile
```

```text
Tax modes =
```

```text
TAX_INCLUDED
```

```text
TAX_ADDED
```

```text
TaxProfiles per Product V1 =
```

```text
ONE
```

```text
Independent modifier tax V1 =
```

```text
FALSE
```

```text
Tax rounding authority =
```

```text
EDGE
```

```text
Offline catalog editing =
```

```text
SUPPORTED
```

```text
Catalog state versioning =
```

```text
REQUIRED
```

```text
Cloud required for local catalog =
```

```text
FALSE
```

## 10.43 Regla Central del Dominio

El catálogo representa la configuración comercial vigente; OrderItem representa la verdad histórica de aquello que realmente fue vendido.

Por tanto:

Toda venta capturará inmediatamente snapshots de precio, impuestos, modificadores y configuración operacional; ningún cambio posterior del catálogo podrá alterar retroactivamente una Order existente; y Edge será siempre la autoridad sobre la configuración comercial utilizada para crear nuevos ítems.

# 11. Provisionamiento, Instalación, Backups y Recuperación

## 11.1 Propósito y alcance

Esta sección define cómo una instalación nueva de ComanView se convierte en un Edge autorizado, cómo se protege su estado local y cómo debe recuperarse ante fallos de software, hardware o base de datos.

```text
Modelo conceptual:
```

```text
Tenant
```

```text
└── Location
```

```text
└── Edge
```

```text
├── Local Database
```

```text
├── Configuration
```

```text
├── License
```

```text
├── Devices
```

```text
├── Printers
```

```text
├── Logs
```

```text
└── Backups
```

El objetivo es que la instalación, actualización y recuperación sean procesos:

Reproducibles.

Versionados.

Auditables.

Seguros.

Independientes de procedimientos manuales sobre la base de datos.

Regla central:

**El binario de ComanView puede reinstalarse; el estado transaccional no puede reconstruirse si no fue correctamente persistido y respaldado.**

## 11.2 Identidad del Edge

Cada instalación Edge tendrá un identificador:

edge_id

globalmente único e inmutable.

Un Edge provisionado deberá estar asociado a:

tenant_id

location_id

Su identidad MUST NOT depender de:

Dirección IP.

Hostname.

Usuario del sistema operativo.

Nombre físico de la computadora.

Ruta local de la base de datos.

Dirección MAC como identidad primaria.

Estos elementos pueden cambiar sin alterar la identidad lógica del Edge.

## 11.3 Estados administrativos del Edge

V1 utilizará:

UNPROVISIONED

ACTIVE

REVOKED

### UNPROVISIONED

El software está instalado, pero todavía no posee autorización para representar una instalación productiva.

### ACTIVE

El Edge fue autorizado y vinculado a un Tenant y Location.

### REVOKED

La identidad del Edge fue invalidada y no deberá continuar operando como autoridad primaria válida.

## 11.4 Provisionamiento inicial

La instalación deberá utilizar un procedimiento controlado.

```text
Flujo conceptual:
```

```text
Install Edge
```

```text
↓
```

```text
Generate installation identity
```

```text
↓
```

```text
Generate temporary provisioning request
```

```text
↓
```

```text
Authorize from Super Admin
```

```text
↓
```

```text
Assign Tenant + Location
```

```text
↓
```

```text
Issue Edge credentials
```

```text
↓
```

```text
Download signed license/configuration
```

```text
↓
```

```text
Bootstrap local state
```

```text
↓
```

```text
Run Health Check
```

```text
↓
```

```text
ACTIVE
```

No deberán incluirse credenciales Cloud permanentes dentro del instalador.

## 11.5 Código de provisionamiento

Una instalación UNPROVISIONED podrá generar:

Provisioning Code

o QR equivalente.

**Ejemplo:**

A7KM-42Q9

El mecanismo deberá ser:

Temporal.

De un solo uso.

Asociado a una solicitud específica.

No reutilizable como credencial permanente.

Su único objetivo será autorizar el bootstrap de la instalación.

## 11.6 Credenciales permanentes del Edge

Después del provisionamiento, Edge deberá recibir una identidad/credencial propia que permita autenticarse frente a Cloud.

Esta credencial:

MUST estar asociada al edge_id.

MUST estar asociada al Tenant y Location correspondientes.

MUST poder revocarse.

MUST almacenarse de forma protegida.

MUST NOT ser equivalente al código temporal de provisionamiento.

## 11.7 Bootstrap inicial

Después de ser autorizado, Edge deberá obtener la información necesaria para operar localmente.

Como mínimo:

Tenant configuration

Location configuration

Signed license

Entitlements

Feature Flags

Catalog/configuration snapshot

Local user/permission data

CashRegister configuration

Preparation stations

Printer configuration

Una vez completado el bootstrap, Edge deberá poder continuar operando sin conexión permanente a Cloud.

## 11.8 Independencia del hardware

La arquitectura Edge será la misma independientemente del hardware utilizado.

### Instalación pequeña

```text
PC de Caja
```

```text
├── POS
```

```text
└── Edge
```

### Instalación dedicada

```text
Mini PC / Local Server
```

```text
└── Edge
```

```text
LAN
```

```text
├── POS
```

```text
├── Tablets
```

```text
├── KDS
```

```text
└── Printers
```

MUST NOT existir una arquitectura funcional diferente para ambos casos.

La diferencia será únicamente de despliegue físico.

## 11.9 Ejecución como servicio

En producción, Edge deberá ejecutarse mediante un proceso supervisado o servicio del sistema operativo.

MUST:

Iniciar automáticamente con el equipo.

No depender de apertura manual por parte de un empleado.

Detectar fallos del proceso.

Reiniciarse ante fallos recuperables.

Registrar eventos de arranque y fallo.

Conservar estado transaccional entre reinicios.

La caída del proceso MUST NOT eliminar ni reinicializar el estado de negocio.

## 11.10 Artefactos versionados

Las instalaciones deberán generarse a partir de artefactos versionados.

Como mínimo se deberá poder identificar:

edge_version

**Regla:**

Una instalación productiva MUST poder relacionarse con una versión concreta y reproducible del software.

Las actualizaciones deberán utilizar posteriormente el mecanismo OTA definido en la Sección 3.

## 11.11 Separación del estado local

La instalación deberá mantener separación lógica entre:

Application binaries

Application configuration

Secrets / credentials

Database

Logs

Backups

Cached assets

El objetivo es permitir:

Actualizar aplicación sin reemplazar datos.

Restaurar datos sin reinstalar todo el software.

Exportar diagnósticos sin exponer secretos.

Aplicar permisos distintos según tipo de información.

## 11.12 Información crítica para respaldo

Los backups deberán proteger el estado necesario para reconstruir la operación.

Como mínimo:

Local Database

Orders

OrderItems

Rounds

Payments

CashSessions

CashMovements

Event Log

Audit Log

Catalog

Users / Permissions

Operational configuration

Stations

Printers

Relevant device configuration

Los binarios de aplicación no constituyen el principal activo del backup porque pueden ser reinstalados desde artefactos versionados.

## 11.13 Backup local automático

V1 deberá realizar backups locales automáticos.

El sistema MUST NOT depender exclusivamente de una acción manual del usuario.

Los backups deberán ejecutarse:

Periódicamente.

Antes de migrations sensibles.

Antes de actualizaciones con riesgo sobre datos cuando corresponda.

Antes de determinados procesos de restore.

La frecuencia definitiva se configurará en la implementación técnica.

## 11.14 Consistencia del backup

Un backup MUST representar un estado consistente y restaurable.

MUST NOT copiarse ingenuamente una base en uso si el motor de datos no garantiza que dicha copia sea consistente.

El mecanismo deberá utilizar:

Funcionalidad nativa del motor.

Snapshot soportado.

Transacción.

Procedimiento equivalente seguro.

**Regla:**

Backup creation MUST preserve database consistency.

## 11.15 Retención y rotación

Los backups deberán utilizar una política de retención.

**Conceptualmente:**

Recent backups

Daily retained backups

Older selected snapshots

La implementación deberá:

Evitar crecimiento ilimitado.

Eliminar backups antiguos según política.

Preservar suficientes puntos de recuperación.

Considerar capacidad disponible de almacenamiento.

## 11.16 Backup local y backup externo

ComanView deberá contemplar al menos dos niveles de protección:

### Backup local

Permite recuperación rápida ante:

Error de aplicación.

Migration fallida.

Corrupción lógica limitada.

Restauración operacional.

### Backup protegido fuera del Edge

Permite recuperación ante:

Fallo total de disco.

Robo.

Daño físico.

Pérdida completa del equipo.

Cuando exista Internet, la segunda copia podrá mantenerse en infraestructura Cloud controlada por ComanView.

## 11.17 Sync no equivale a Backup

La sincronización definida en la Sección 2 y los backups tienen responsabilidades distintas.

SYNC ≠ BACKUP

Sync transporta cambios/eventos y consolida información.

Backup conserva un estado restaurable.

Una implementación MUST NOT asumir:

All events synced

```text
=
```

Full recoverable Edge backup exists

Esta distinción es obligatoria.

## 11.18 Backup Cloud

Cuando exista conectividad, Edge deberá poder enviar backups o paquetes de recuperación hacia almacenamiento protegido.

Si este proceso falla:

Cloud Backup FAILED

el restaurante deberá continuar operando localmente.

El sistema deberá:

Registrar el fallo.

Reintentar posteriormente.

Mostrar telemetría/alerta administrativa.

MUST NOT bloquear POS, KDS o caja por un fallo del backup remoto.

## 11.19 Protección de backups

Los backups transferidos fuera del Edge deberán estar protegidos mediante:

Cifrado en tránsito.

Cifrado en almacenamiento.

Integridad verificable.

Los backups locales SHOULD protegerse adicionalmente cuando sea viable.

Las claves necesarias para protegerlos MUST NOT almacenarse dentro del mismo paquete de manera que anulen el cifrado.

## 11.20 Metadata de backup

Cada backup deberá contener metadata equivalente a:

backup_id

tenant_id

location_id

edge_id

created_at

edge_version

schema_version

checksum

Podrá incorporar información adicional cuando sea necesario.

Esta metadata será utilizada para validar compatibilidad y procedencia.

## 11.21 schema_version

Todo backup MUST indicar:

schema_version

**Ejemplo:**

```text
edge_version = 1.8.2
```

```text
schema_version = 34
```

Esto permitirá determinar si la base necesita migrations después del restore.

## 11.22 Migrations versionadas

Todos los cambios estructurales de base de datos deberán realizarse mediante migrations versionadas.

```text
Flujo conceptual:
```

```text
schema_version = 40
```

```text
↓
```

```text
migration 41
```

```text
↓
```

```text
schema_version = 41
```

MUST NOT existir como procedimiento productivo normal:

Modificar manualmente tablas

mediante herramientas administrativas.

Las migrations deberán:

Ser reproducibles.

Ejecutarse en secuencia conocida.

Registrar éxito/fallo.

Ser verificables.

Integrarse con mecanismos de backup.

## 11.23 Pre-update backup

Una actualización que incluya cambios sensibles de datos o schema MUST contar previamente con un backup válido.

```text
Flujo:
```

```text
OTA package ready
```

```text
↓
```

```text
Create / validate backup
```

```text
↓
```

```text
Install application update
```

```text
↓
```

```text
Run migrations
```

```text
↓
```

```text
Health Check
```

Si el backup previo requerido no puede generarse:

La actualización sensible MUST NOT ejecutarse automáticamente.

## 11.24 Rollback y schema

Rollback de aplicación y rollback de base de datos no son equivalentes.

```text
Ejemplo:
```

```text
Application:
```

```text
v1.8 → v1.9
```

```text
Database:
```

```text
schema 40 → 41
```

Volver simplemente a:

v1.8

MAY no ser seguro contra:

schema 41

Por tanto:

Application rollback MUST NOT assume database rollback compatibility.

La estrategia concreta deberá definirse por migration/update en la Sección 12.

## 11.25 Restore controlado

Restaurar un backup será una operación sensible.

```text
MUST NOT existir:
```

```text
RESTORE
```

```text
→ immediately overwrite everything
```

sin validación.

```text
Flujo:
```

```text
Select backup
```

```text
↓
```

```text
Validate checksum
```

```text
↓
```

```text
Validate Tenant / Location
```

```text
↓
```

```text
Validate schema compatibility
```

```text
↓
```

```text
Create safety backup of current state
```

```text
↓
```

```text
Stop transactional processing
```

```text
↓
```

```text
Restore
```

```text
↓
```

```text
Run required migrations
```

```text
↓
```

```text
Integrity Check
```

```text
↓
```

```text
Health Check
```

```text
↓
```

```text
Resume operation
```

## 11.26 Safety backup

Antes de sobrescribir un estado productivo durante restore, ComanView SHOULD crear un backup del estado actual cuando técnicamente sea posible.

Esto permite revertir una restauración incorrecta o recuperar información más reciente si se seleccionó el backup equivocado.

## 11.27 Validación de integridad

Antes de restaurar, el sistema deberá validar al menos:

checksum

tenant_id

location_id

schema_version

backup format

Un backup corrupto MUST NOT instalarse silenciosamente.

## 11.28 Fallo físico del Edge

Ante pérdida del equipo principal:

EDGE HARDWARE FAILURE

```text
el procedimiento será conceptualmente:
```

```text
Install Edge on replacement hardware
```

```text
↓
```

```text
Provision as replacement
```

```text
↓
```

```text
Restore latest valid backup
```

```text
↓
```

```text
Run migrations if necessary
```

```text
↓
```

```text
Recover Cloud-synced information when available
```

```text
↓
```

```text
Run Health Check
```

```text
↓
```

```text
Resume operation
```

La recuperación SHOULD evitar reconstrucción manual de información crítica.

## 11.29 Reemplazo de Edge

V1 utilizará un único Edge primario operacional por Location.

```text
Cuando sea reemplazado:
```

```text
EDGE-A → REVOKED / REPLACED
```

```text
EDGE-B → ACTIVE
```

La identidad comercial de:

Tenant

Location

Orders

Users

Catalog

MUST conservarse.

edge_id del nuevo servidor será distinto, pero la identidad transaccional del negocio deberá mantenerse.

## 11.30 Prevención de split-brain

V1 MUST NOT operar intencionalmente:

EDGE-A ACTIVE

+

EDGE-B ACTIVE

como autoridades independientes sobre una misma Location.

Esta condición podría producir historia transaccional divergente.

La prevención deberá utilizar:

Identidad Edge.

Provisionamiento explícito.

Revocación.

Estado Cloud cuando esté disponible.

Advertencias/validaciones.

V1 no implementará consenso distribuido ni active-active.

## 11.31 Recuperación Offline

Una recuperación MAY necesitar ejecutarse sin Cloud.

Si existe un backup válido local/externo, la arquitectura SHOULD permitir recuperación Offline mediante autorización segura.

La restauración MUST NOT permitir que cualquier persona copie un backup y clone libremente una instalación productiva.

Se deberá utilizar un mecanismo equivalente a:

Recovery authorization

verificable localmente.

## 11.32 Recovery Package

```text
Conceptualmente podrá existir:
```

```text
Recovery Package
```

```text
├── Backup
```

```text
├── Metadata
```

```text
├── Integrity proof
```

```text
└── Recovery authorization
```

No será obligatorio que estos componentes formen un único archivo físico.

El objetivo será permitir recuperación:

Identificable.

Verificable.

Segura.

Auditada.

## 11.33 RPO — Recovery Point Objective

V1 no establecerá inicialmente un SLA comercial numérico no validado.

La arquitectura deberá minimizar pérdida potencial de datos mediante:

Immediate local persistence

+

Periodic backups

+

Continuous Cloud sync when available

La cifra real de RPO deberá definirse después de validar comportamiento en producción.

## 11.34 RTO — Recovery Time Objective

V1 tampoco prometerá inicialmente un tiempo contractual específico de recuperación.

Sin embargo, la recuperación MUST poder ejecutarse mediante procedimientos documentados sin requerir:

Edición SQL manual.

Intervención directa del desarrollador.

Reconstrucción manual del catálogo.

Reconstrucción manual de ventas.

Los objetivos numéricos podrán establecerse después de pruebas reales.

## 11.35 Corrupción de base de datos

Edge deberá detectar fallos graves que impidan confiar en la integridad de la base local.

Ante corrupción:

DB INTEGRITY FAILURE

```text
el sistema deberá:
```

```text
Stop transactional startup
```

```text
↓
```

```text
Preserve existing database/files
```

```text
↓
```

```text
Enter RECOVERY_REQUIRED
```

```text
↓
```

```text
Expose diagnostics
```

```text
↓
```

```text
Require authorized recovery
```

MUST NOT iniciar automáticamente una nueva base vacía.

## 11.36 Prohibición de inicialización destructiva

La siguiente equivalencia está expresamente prohibida:

Database cannot open

```text
=
```

Create empty production database

Una base aparentemente vacía puede hacer creer al restaurante que perdió:

Ventas.

Caja.

Usuarios.

Catálogo.

Auditoría.

El sistema deberá priorizar preservar información y solicitar recuperación controlada.

## 11.37 RECOVERY_REQUIRED

La salud técnica de Edge podrá utilizar un estado equivalente a:

RECOVERY_REQUIRED

Mientras esté activo:

MUST NOT aceptar nuevas transacciones comerciales.

MUST preservar archivos existentes.

SHOULD mostrar diagnóstico.

SHOULD permitir seleccionar mecanismos de recuperación autorizados.

MUST evitar inicialización productiva limpia automática.

Este estado representa una condición técnica, no un estado de licencia comercial.

## 11.38 Logs locales

Edge deberá mantener logs estructurados por áreas como:

startup

database

sync

printing

updates

backup

restore

security

Los logs deberán utilizar rotación.

MUST NOT registrar:

Contraseñas.

PINs.

Claves privadas.

Tokens completos.

CVV.

PAN de tarjetas.

Otros secretos innecesarios.

## 11.39 Paquete de diagnóstico

ComanView deberá soportar una operación equivalente a:

EXPORT_DIAGNOSTIC_PACKAGE

que pueda incluir:

Edge version.

Schema version.

Health status.

Información no secreta de configuración.

Logs relevantes.

Sync health.

Backup health.

Printer health.

Device status.

MUST excluir o sanitizar secretos.

El paquete podrá generarse:

Localmente por usuario autorizado.

Desde Super Admin cuando exista conectividad.

## 11.40 Provisionamiento de dispositivos

Una vez provisionado Edge, los dispositivos utilizarán el pairing definido en la Sección 6.

```text
Orden recomendado:
```

```text
Provision Edge
```

```text
↓
```

```text
Configure Location
```

```text
↓
```

```text
Configure Users
```

```text
↓
```

```text
Configure Catalog
```

```text
↓
```

```text
Configure CashRegisters
```

```text
↓
```

```text
Configure Stations
```

```text
↓
```

```text
Configure Printers
```

```text
↓
```

```text
Pair POS / Tablets / KDS
```

```text
↓
```

```text
Run Tests
```

```text
↓
```

```text
Go Live
```

## 11.41 Installation Health Check

Antes de declarar una instalación productiva como lista deberá ejecutarse un Health Check.

Como mínimo deberá verificar:

```text
Edge service        = OK
```

```text
Database            = OK
```

```text
License             = VALID
```

```text
Tenant/Location     = ASSIGNED
```

```text
Catalog             = AVAILABLE
```

```text
Users               = AVAILABLE
```

```text
CashRegister        = CONFIGURED
```

```text
Stations            = CONFIGURED
```

```text
Printers            = TESTED where applicable
```

```text
Devices             = PAIRED
```

```text
Backup system       = INITIALIZED
```

```text
Sync                = VERIFIED when Internet is available
```

Un resultado crítico fallido deberá impedir marcar la instalación como lista para producción.

## 11.42 Pruebas antes de Go Live

El onboarding SHOULD permitir verificar:

Login.

Apertura de caja.

Producto de prueba.

Impresión.

KDS cuando aplique.

Comunicación LAN.

Heartbeat.

Backup.

Sync.

Las pruebas MUST evitar contaminar las ventas productivas.

## 11.43 Test Mode

Cuando exista una operación de prueba deberá estar claramente separada de producción.

MUST NOT permitir que una transacción de prueba termine accidentalmente en:

Ventas.

Corte Z.

Analítica.

Reportes financieros.

Historial comercial real.

Para pruebas específicas se preferirán operaciones como:

TEST_PRINTER

RUN_HEALTH_CHECK

sin crear Orders reales.

## 11.44 Importación masiva de catálogo

V1 deberá incluir importación administrativa mediante:

CSV

XLSX

para facilitar onboarding de establecimientos con catálogos existentes.

```text
Flujo:
```

```text
Upload file
```

```text
↓
```

```text
Parse
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
Show preview/errors
```

```text
↓
```

```text
Confirm
```

```text
↓
```

```text
Import through domain rules
```

La importación MUST pasar por las mismas reglas de dominio que la captura manual.

MUST NOT insertar datos directamente saltándose validaciones de Product, ModifierGroup, TaxProfile o precios.

## 11.45 Validación de importación

La importación deberá poder detectar problemas por fila.

Ejemplos:

Missing product name

Invalid price

Unknown category

Invalid tax profile

Unknown station

Invalid modifier configuration

Duplicate SKU

El sistema SHOULD mostrar un resumen antes de confirmar.

No deberá ejecutar una importación parcialmente silenciosa sin informar qué registros fallaron.

## 11.46 Atomicidad de importación

La estrategia definitiva podrá permitir importación completa o por lotes, pero deberá mantener resultados deterministas.

```text
Si se utiliza una importación transaccional total:
```

```text
Validation failure
```

```text
→ no import
```

Si se utilizan lotes:

Imported rows

Failed rows

deberán quedar claramente reportados.

La estrategia concreta se definirá en la Sección 12.

## 11.47 Exportaciones

V1 MAY permitir exportaciones operativas como:

Catálogo.

Reportes seleccionados.

Información de recuperación autorizada.

No será necesario construir un motor genérico de exportación dentro de esta sección.

## 11.48 Invariantes Operacionales

Las siguientes invariantes son obligatorias.

> **INVARIANT:** OPS-INV-01 — Edge Identity

> **INVARIANT:** Every provisioned Edge MUST have one immutable edge_id.

> **INVARIANT:** OPS-INV-02 — Edge Ownership

> **INVARIANT:** An ACTIVE Edge MUST be associated with exactly one Tenant and one Location.

> **INVARIANT:** OPS-INV-03 — Provisioning Security

> **INVARIANT:** Provisioning credentials MUST NOT be permanent reusable installation secrets.

> **INVARIANT:** OPS-INV-04 — Automatic Startup

> **INVARIANT:** Edge MUST be capable of restarting without manual application startup.

> **INVARIANT:** OPS-INV-05 — Persistent State

> **INVARIANT:** Transactional state MUST survive application and operating system restart.

> **INVARIANT:** OPS-INV-06 — Backup Consistency

> **INVARIANT:** A backup MUST represent an internally consistent and restorable state.

> **INVARIANT:** OPS-INV-07 — Sync Separation

> **INVARIANT:** Synchronization MUST NOT be treated as equivalent to Backup.

> **INVARIANT:** OPS-INV-08 — Restore Integrity

> **INVARIANT:** Backup integrity MUST be validated before restore.

> **INVARIANT:** OPS-INV-09 — Schema Identification

> **INVARIANT:** Every backup MUST identify its schema_version.

> **INVARIANT:** OPS-INV-10 — Versioned Migrations

> **INVARIANT:** Database schema changes MUST use versioned migrations.

> **INVARIANT:** OPS-INV-11 — Controlled Restore

> **INVARIANT:** Restore MUST NOT silently overwrite production state without controlled validation.

> **INVARIANT:** OPS-INV-12 — Corruption Safety

> **INVARIANT:** Database corruption MUST NOT cause automatic initialization of an empty production database.

> **INVARIANT:** OPS-INV-13 — Single Primary Edge

> **INVARIANT:** A Location MUST NOT intentionally operate multiple independent primary Edges in V1.

> **INVARIANT:** OPS-INV-14 — Replacement Continuity

> **INVARIANT:** Replacing an Edge MUST preserve Tenant/Location transactional identity.

> **INVARIANT:** OPS-INV-15 — Cloud Backup Independence

> **INVARIANT:** Cloud backup failure MUST NOT stop local restaurant operation.

> **INVARIANT:** OPS-INV-16 — Secret Protection

> **INVARIANT:** Backups and diagnostic logs MUST NOT expose authentication secrets.

> **INVARIANT:** OPS-INV-17 — Production Readiness

> **INVARIANT:** Production readiness MUST be verifiable through installation Health Checks.

> **INVARIANT:** OPS-INV-18 — Migration Rollback Safety

> **INVARIANT:** Application updates MUST NOT assume database rollback is automatically safe after schema migration.

## 11.49 Fuera del alcance de V1

V1 no incluirá:

Active-active Edge.

Clustering local.

Hot standby automático.

Failover LAN automático.

Consenso distribuido.

Replicación continua entre varios Edges locales.

Kubernetes local.

Remote Desktop integrado.

Bare-metal disaster recovery.

Provisionamiento automático de appliances físicos.

SLA numérico garantizado de RPO/RTO antes de validación real.

## 11.50 Resumen normativo para implementación

```text
Edge identity =
```

IMMUTABLE edge_id

```text
Edge states =
```

```text
UNPROVISIONED
```

```text
ACTIVE
```

```text
REVOKED
```

```text
Provisioning code =
```

```text
TEMPORARY
```

```text
ONE-TIME
```

```text
Permanent Cloud credentials inside installer =
```

```text
PROHIBITED
```

```text
One primary Edge per Location V1 =
```

```text
REQUIRED
```

```text
Edge auto-start =
```

```text
REQUIRED
```

```text
Manual application launch for production =
```

```text
NOT REQUIRED
```

```text
Versioned installation artifacts =
```

```text
REQUIRED
```

```text
Automatic local backup =
```

```text
REQUIRED
```

```text
Backup retention =
```

```text
REQUIRED
```

```text
Cloud/protected backup =
```

```text
REQUIRED CONCEPTUALLY
```

```text
SYNC == BACKUP =
```

```text
FALSE
```

```text
Backup checksum/integrity =
```

```text
REQUIRED
```

```text
schema_version in backup =
```

```text
REQUIRED
```

```text
Versioned DB migrations =
```

```text
REQUIRED
```

```text
Pre-update backup for sensitive migrations =
```

```text
REQUIRED
```

```text
Automatic empty DB after corruption =
```

```text
PROHIBITED
```

```text
RECOVERY_REQUIRED mode =
```

```text
REQUIRED
```

```text
Controlled restore =
```

```text
REQUIRED
```

```text
Diagnostic package =
```

```text
REQUIRED
```

```text
Installation Health Check =
```

```text
REQUIRED
```

```text
CSV/XLSX catalog import =
```

```text
INCLUDED IN V1
```

```text
Import bypasses domain validation =
```

```text
FALSE
```

```text
Active-active Edge V1 =
```

```text
FALSE
```

## 11.51 Regla Central Operacional

Una instalación de ComanView deberá poder ser reproducida, actualizada, diagnosticada y recuperada sin depender de procedimientos manuales destructivos.

Por tanto:

Edge tendrá identidad propia e independiente del hardware; su estado deberá estar protegido mediante backups consistentes y separados de la sincronización; las migrations serán versionadas; y ante corrupción o fallo físico el sistema preservará primero la información existente y entrará en recuperación controlada antes de permitir cualquier reinicialización productiva.

# 12. Arquitectura Técnica e Implementación

## 12.1 Propósito y alcance

Esta sección define la arquitectura técnica concreta de ComanView V1 y traduce las decisiones funcionales de las Secciones 1–11 en componentes, tecnologías, contratos, procesos y fronteras de implementación.

Los objetivos técnicos prioritarios serán:

Mantenibilidad.

Estabilidad en producción.

Integridad transaccional.

Rendimiento operacional.

Reutilización de código.

Simplicidad de despliegue.

Recuperabilidad.

Offline-First.

Seguridad.

Evolución controlada.

La arquitectura MUST evitar sobre-ingeniería que aumente el costo operacional dentro del restaurante.

## 12.2 Estrategia tecnológica general

ComanView será TypeScript-first.

Stack primario:

Language:

TypeScript

Runtime:

Node.js 24 LTS

V1 MUST NOT introducir Go, Rust u otro lenguaje únicamente por optimización teórica.

Un segundo lenguaje MAY incorporarse posteriormente si existe:

Cuello de botella medido.

Necesidad de aislamiento.

Integración hardware específica.

Requerimiento de seguridad/rendimiento claramente demostrado.

La arquitectura priorizará reutilizar entre Edge, Cloud y clientes:

Domain Types

Contracts

Schemas

Commands

Events

Permissions

Money Utilities

Identifiers

Sync Protocol

Validation

## 12.3 Principio de modularidad

ComanView utilizará principalmente Modular Monoliths, no microservicios por defecto.

Existirán dos monolitos modulares principales:

Edge Runtime

Cloud Backend

Cada uno contendrá módulos claramente separados internamente.

La división en servicios independientes solo deberá realizarse cuando exista una necesidad operacional real.

## 12.4 Arquitectura general

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
│ Event Log / Outbox    │
```

```text
│ WebSocket Server      │
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
│ License Manager       │
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
Public Storefront:
```

```text
Customer Browser
```

```text
↓
```

```text
Internet
```

```text
↓
```

```text
CloudFront / Public Edge
```

```text
↓
```

```text
Storefront
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

## 12.5 Edge Runtime

El Edge será la autoridad operacional local definida en Sección 2.

Stack:

Node.js 24 LTS

TypeScript

Fastify

SQLite

El Edge deberá ejecutar:

HTTP API.

WebSocket Server.

Domain Engine.

Local Authentication.

Order Engine.

Payment Engine.

Cash Engine.

Catalog Engine.

Print Manager.

Event Log.

Audit Log.

Sync Engine.

Backup Engine.

Device Manager.

License Manager.

OTA coordination.

Health / Telemetry.

## 12.6 Fastify

Fastify será el framework HTTP tanto para Edge como para Cloud.

Se utilizará para:

Routing.

Plugins.

Middleware/hooks.

Request lifecycle.

Schema integration.

Logging.

HTTP error handling.

Las rutas MUST permanecer delgadas.

Ejemplo correcto:

```text
POST /orders/:id/items
```

```text
Route
```

```text
↓
```

```text
Validate Contract
```

```text
↓
```

```text
Application Command
```

```text
↓
```

```text
Domain Service
```

```text
↓
```

```text
Repository / Transaction
```

```text
Ejemplo prohibido:
```

```text
Route
```

```text
→ SQL directly
```

```text
→ mutate tables
```

```text
→ calculate totals
```

## 12.7 Edge como Modular Monolith

La aplicación Edge estará dividida conceptualmente en módulos como:

```text
Edge
```

```text
├── Auth
```

```text
├── Devices
```

```text
├── Catalog
```

```text
├── Orders
```

```text
├── Tables
```

```text
├── Payments
```

```text
├── Cash
```

```text
├── KDS
```

```text
├── Printing
```

```text
├── Sync
```

```text
├── Audit
```

```text
├── Licensing
```

```text
├── Backup
```

```text
├── OTA
```

```text
└── Health
```

Estos módulos MAY compartir el mismo proceso y base de datos, pero MUST mantener fronteras claras de dominio.

## 12.8 Base de datos Edge

La base local será:

SQLite

Configuración:

WAL mode

SQLite será la autoridad local para:

Orders.

OrderItems.

Rounds.

Payments.

CashSessions.

CashMovements.

Catalog.

Users.

Permissions.

Event Log.

Audit Log.

Print Jobs.

Device registrations.

Local configuration.

Sync state.

## 12.9 SQLite y LibSQL

V1 utilizará SQLite directamente.

LibSQL MUST NOT utilizarse como reemplazo del Sync Engine.

La sincronización de ComanView está definida como:

Current State

+

Event Log

+

Transactional Outbox

+

Cloud Inbox

Introducir replicación automática de base de datos agregaría una segunda semántica de sincronización y MUST evitarse en V1.

## 12.10 Driver SQLite

La implementación inicial utilizará:

better-sqlite3

como driver Node para SQLite.

node:sqlite podrá reevaluarse cuando alcance el nivel de estabilidad requerido para producción.

La elección del driver MUST permanecer encapsulada detrás de la capa de persistencia.

El Domain Layer MUST NOT depender directamente de better-sqlite3.

## 12.11 WAL y concurrencia local

SQLite se configurará para optimizar el patrón de ComanView:

multiple readers

+

controlled writers

Las mutaciones financieras críticas deberán ejecutarse mediante transacciones explícitas.

La arquitectura MUST asumir que existe una única autoridad de escritura operacional: Edge.

## 12.12 Drizzle

ComanView utilizará:

Drizzle

como capa de:

Schema.

Query building.

Database typing.

Migrations.

Se utilizará tanto para:

SQLite — Edge

PostgreSQL — Cloud

cuando corresponda.

Drizzle MUST NOT convertirse en el Domain Model.

## 12.13 Separación Domain / Persistence

```text
La dependencia correcta será:
```

```text
Domain
```

```text
↑
```

```text
Application
```

```text
↑
```

```text
Infrastructure
```

```text
y no:
```

```text
Domain
```

```text
→ Drizzle
```

Los repositorios o gateways deberán traducir entre:

Domain Entities

↔

Database Records

## 12.14 Runtime Validation

ComanView utilizará:

Zod

para validación runtime.

Se utilizará como mínimo para:

REST Requests.

REST Responses donde aplique.

WebSocket messages.

Sync envelopes.

Importaciones CSV/XLSX.

Provisioning data.

Backup metadata.

Configuration payloads.

Cloud-to-Edge commands.

TypeScript solo proporciona validación estática.

**Regla:**

Compile-time types MUST NOT be treated as runtime trust.

## 12.15 Arquitectura de comandos

Las mutaciones importantes deberán expresarse como Commands.

Ejemplos:

CreateOrderCommand

AddOrderItemCommand

SendRoundCommand

CreatePaymentCommand

CloseOrderCommand

OpenCashSessionCommand

CloseCashSessionCommand

ChangeProductAvailabilityCommand

Cada comando crítico SHOULD contener:

command_id

actor

device

location

payload

expected_version when applicable

## 12.16 Command Idempotency

Los comandos críticos definidos como idempotentes en secciones anteriores deberán persistir su resultado asociado a:

command_id

El retry del mismo comando MUST devolver el resultado existente o equivalente.

MUST NOT producir una segunda mutación.

## 12.17 Domain Events

Las mutaciones relevantes generarán eventos explícitos.

Ejemplos:

ORDER_CREATED

ITEM_ADDED

ROUND_SENT

PAYMENT_COMPLETED

ORDER_CLOSED

CASH_SESSION_CLOSED

PRODUCT_PRICE_CHANGED

Los eventos deberán representar hechos ocurridos, no órdenes futuras.

## 12.18 Transactional Outbox

El Event Log del Edge funcionará también como Transactional Outbox.

Una mutación crítica deberá persistir dentro de la misma frontera transaccional:

Business State

+

Financial State

+

Domain Event

+

Sync Eligibility

**Ejemplo:**

BEGIN

INSERT Payment

UPDATE Order financial state

INSERT EventLog

COMMIT

MUST NOT existir:

Save business data

COMMIT

later...

maybe create sync event

porque podría producir estado no sincronizable.

## 12.19 Local Background Workers

Edge tendrá workers conceptuales para:

Print Worker

Sync Worker

Backup Worker

Maintenance Worker

OTA Worker

No todos necesitan ser procesos de sistema separados.

Inicialmente podrán utilizarse:

Node async worker loops

cuando la tarea sea principalmente I/O.

## 12.20 Procesos separados

Se utilizará aislamiento de proceso únicamente cuando exista justificación.

Ejemplos posibles:

OTA installer

hardware-specific adapter

dangerous native integration

Un fallo del proceso secundario SHOULD NOT tumbar el servidor Edge principal.

## 12.21 worker_threads

Los worker_threads MAY utilizarse posteriormente para tareas CPU-intensivas.

No deberán introducirse simplemente para operaciones normales de:

SQLite.

Network I/O.

Printing.

Sync.

Node ya gestiona eficientemente I/O asíncrono.

## 12.22 Colas locales

Edge MUST NOT requerir:

Redis

RabbitMQ

Kafka

Las colas durables se implementarán mediante SQLite.

Ejemplos:

event_log

print_jobs

background_jobs

Los workers deberán reclamar trabajos mediante mecanismos transaccionales seguros.

## 12.23 Device ↔ Edge

El protocolo principal será:

HTTP REST

+

WebSocket

REST será utilizado para:

Commands.

Queries.

Authentication.

Configuration.

Device actions.

WebSocket será utilizado para cambios en tiempo real.

## 12.24 REST API local

Ejemplos conceptuales:

```text
POST /orders
```

```text
POST /orders/:id/items
```

```text
POST /orders/:id/rounds
```

```text
POST /orders/:id/close
```

```text
POST /payments
```

```text
POST /cash-sessions
```

```text
POST /cash-sessions/:id/close
```

```text
GET /catalog
```

```text
GET /tables
```

```text
GET /orders/:id
```

Los endpoints definitivos podrán refinarse durante implementación.

El comportamiento del dominio tiene prioridad sobre la forma final de las URLs.

## 12.25 WebSocket

WebSocket deberá permitir eventos como:

ORDER_UPDATED

TABLE_UPDATED

ROUND_SENT

KDS_ITEM_UPDATED

ITEM_READY

CATALOG_UPDATED

PRODUCT_AVAILABILITY_CHANGED

CASH_SESSION_UPDATED

LICENSE_STATE_CHANGED

CONNECTIVITY_CHANGED

Los mensajes WebSocket MUST utilizar contratos versionables.

## 12.26 WebSocket no es autoridad

Un WebSocket message no constituye por sí mismo persistencia transaccional.

```text
El flujo será:
```

```text
Command
```

```text
→ Edge validates
```

```text
→ Edge persists
```

```text
→ COMMIT
```

```text
→ Edge emits WebSocket notification
```

MUST NOT emitirse éxito definitivo antes del commit.

## 12.27 gRPC

V1 MUST NOT utilizar gRPC entre clientes operativos y Edge.

Razón:

POS/Waiter/KDS son clientes browser.

HTTP y WebSocket son suficientes.

Mayor compatibilidad.

Menor complejidad.

gRPC MAY incorporarse posteriormente para comunicación service-to-service si surge necesidad real.

## 12.28 Clientes Operativos

V1 tendrá tres clientes principales:

POS

Waiter

KDS

Stack compartido:

React

TypeScript

Vite

Las aplicaciones compartirán:

UI components.

Contracts.

Client SDK.

Auth logic.

Networking.

Money formatting.

Common utilities.

## 12.29 POS

POS será una aplicación web local servida por Edge.

Ejemplo conceptual:

https://comanview.local/pos

Podrá ejecutarse:

Navegador.

Kiosk mode.

PWA instalada.

V1 MUST NOT requerir una aplicación desktop nativa.

## 12.30 PWA

POS y Waiter SHOULD soportar capacidades PWA cuando sean útiles:

Instalación visual.

App icon.

Full-screen.

Cached static assets.

Faster startup.

Sin embargo, la PWA MUST NOT convertirse en una segunda autoridad transaccional.

## 12.31 Tauri / Electron

V1 no utilizará:

Electron

Tauri

como requisito del POS.

La integración con:

DB.

Impresión.

Licencias.

Hardware.

vive en Edge.

Por tanto el frontend no necesita acceso nativo directo.

Tauri MAY reconsiderarse posteriormente si aparece un requerimiento OS específico.

## 12.32 Waiter App

La comandería será:

React

Vite

PWA

Responsive

Funcionará principalmente en:

Tablets.

Smartphones.

MUST adaptarse al tamaño de pantalla.

No se desarrollará React Native en V1.

## 12.33 KDS

KDS utilizará:

React

Vite

y será servido por Edge.

Podrá funcionar en:

Tablet.

PC.

Mini PC.

Browser kiosk.

Pantalla touch.

No necesitará aplicación nativa independiente.

## 12.34 Estado del frontend

Para server state se utilizará preferentemente:

TanStack Query

para:

Fetching.

Caching.

Mutation lifecycle.

Invalidación.

Refetch.

Estado visual local permanecerá en React.

## 12.35 Zustand

Zustand

MAY utilizarse para estado global UI limitado cuando exista necesidad clara.

MUST NOT crearse un store global masivo que replique la base del Edge.

## 12.36 Redux

Redux MUST NOT ser introducido por defecto.

Solo podría incorporarse si existe un problema de estado complejo no resuelto adecuadamente por:

TanStack Query

+

React state

+

small Zustand stores

## 12.37 Offline de los clientes

Debe mantenerse la definición correcta:

**ComanView Offline-First significa independencia de Internet/Cloud, no independencia del Edge.**

Si un cliente pierde comunicación con Edge:

```text
transactional authority = unavailable
```

El cliente MAY conservar:

Assets.

Último catálogo visible.

UI state.

Draft temporal.

Pero MUST NOT confirmar:

Order creada.

Payment completado.

Round enviado.

Cash movement.

Order cerrada.

hasta recibir ACK del Edge.

## 12.38 Edge discovery

Los dispositivos no deberían depender exclusivamente de una IP fija.

Se preparará un mecanismo como:

comanview.local

mediante hostname/mDNS o equivalente.

Debe existir fallback de:

manual IP / hostname configuration

porque algunos routers pueden no soportar correctamente discovery local.

## 12.39 Comunicación LAN segura

Producción SHOULD utilizar comunicación autenticada y cifrada Device ↔ Edge.

Objetivo:

TLS

+

Device Credentials

+

User Session

La estrategia concreta de certificados locales deberá equilibrar:

Seguridad.

Facilidad de instalación.

Compatibilidad con browsers.

HTTP simple podrá utilizarse durante desarrollo.

## 12.40 Print Manager

El sistema de impresión residirá en Edge.

```text
Arquitectura:
```

```text
Order / Cash
```

```text
↓
```

```text
Print Manager
```

```text
↓
```

```text
PrintJob
```

```text
↓
```

```text
Persistent Queue
```

```text
↓
```

```text
Print Worker
```

```text
↓
```

```text
PrinterAdapter
```

## 12.41 Printer Adapters

Interface conceptual:

PrinterAdapter

Implementaciones:

TcpEscPosAdapter

UsbEscPosAdapter

SystemDriverAdapter

V1 priorizará:

TcpEscPosAdapter

## 12.42 ESC/POS

La generación ESC/POS deberá estar encapsulada dentro de:

packages/printing

o módulo equivalente.

El Domain Layer MUST NOT conocer APIs de librerías ESC/POS.

```text
Ejemplo prohibido:
```

```text
OrderService
```

```text
→ npm escpos library
```

```text
Correcto:
```

```text
Order Domain
```

```text
→ Print Job
```

```text
→ Printing Module
```

```text
→ Adapter
```

## 12.43 Dependencias de impresión

Podrán utilizarse librerías existentes para comunicación ESC/POS, pero deberán encapsularse.

La aplicación MUST poder cambiar de librería sin modificar:

Order Domain.

Payment Domain.

KDS Domain.

Cash Domain.

## 12.44 Cloud Backend

Stack:

Node.js 24 LTS

TypeScript

Fastify

PostgreSQL 18

Cloud será inicialmente:

Modular Monolith

+

Background Workers

## 12.45 Módulos Cloud

```text
Conceptualmente:
```

```text
Cloud
```

```text
├── Identity
```

```text
├── Tenants
```

```text
├── Locations
```

```text
├── Edge Fleet
```

```text
├── Licensing
```

```text
├── Entitlements
```

```text
├── Feature Flags
```

```text
├── Sync
```

```text
├── Configuration
```

```text
├── Audit Consolidation
```

```text
├── Telemetry
```

```text
├── OTA
```

```text
├── Storefront Publishing
```

```text
└── Super Admin
```

## 12.46 PostgreSQL

PostgreSQL será la base central.

Almacenará como mínimo:

Tenants.

Locations.

Edge identities.

Licenses.

Entitlements.

Feature Flags.

Sync Inbox.

Consolidated operational projections.

Audit copies.

Storefront projection.

Telemetry metadata.

OTA metadata.

Administrative state.

## 12.47 Cloud no es autoridad local

La existencia de una representación Cloud de:

Order

Payment

CashSession

MUST NOT convertir Cloud en autoridad sobre operaciones locales históricas ya confirmadas.

Cloud recibe y consolida hechos provenientes de Edge.

## 12.48 Cloud Sync API

```text
Flujo:
```

```text
Edge Event Batch
```

```text
↓
```

```text
Cloud Sync Endpoint
```

```text
↓
```

```text
Authenticate Edge
```

```text
↓
```

```text
Validate Envelope
```

```text
↓
```

```text
Validate Tenant/Location
```

```text
↓
```

```text
Check event_id idempotency
```

```text
↓
```

```text
Persist durable Inbox
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
Process projections asynchronously
```

El ACK SHOULD poder enviarse después de persistencia durable, sin esperar a reconstruir todas las proyecciones.

## 12.49 Cloud Inbox

```text
Existirá una estructura equivalente a:
```

```text
sync_inbox
```

```text
├── event_id UNIQUE
```

```text
├── edge_id
```

```text
├── tenant_id
```

```text
├── location_id
```

```text
├── event_type
```

```text
├── payload
```

```text
├── received_at
```

```text
├── processing_status
```

```text
└── processing_error
```

**Regla:**

same event_id N times

```text
=
```

one logical Cloud effect

## 12.50 Cloud Workers

Los trabajos asíncronos podrán incluir:

Sync Projection Worker

Storefront Projection Worker

Email Worker

Telemetry Processing

Backup Metadata Processing

OTA Tasks

Maintenance

## 12.51 Cloud Queue V1

Inicialmente MAY utilizarse una cola respaldada por PostgreSQL.

V1 no requerirá:

Kafka

como infraestructura obligatoria.

Servicios administrados como:

SQS

MAY añadirse cuando el volumen o desacoplamiento lo justifiquen.

## 12.52 Infraestructura Cloud

Proveedor principal:

AWS

```text
Arquitectura propuesta:
```

```text
Route 53
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
ALB
```

```text
↓
```

```text
ECS Fargate
```

```text
├── Cloud API
```

```text
├── Workers
```

```text
└── Storefront SSR
```

RDS PostgreSQL

S3

CloudWatch

Secrets Manager

## 12.53 Kubernetes

Kubernetes MUST NOT ser requisito para V1.

ECS Fargate proporciona suficiente aislamiento y escalamiento inicial sin añadir administración de clusters.

Kubernetes MAY evaluarse posteriormente si el tamaño del sistema lo justifica.

## 12.54 API Gateway

La arquitectura tendrá una frontera pública de API, pero no requiere obligatoriamente AWS API Gateway en V1.

```text
Un flujo válido será:
```

```text
CloudFront
```

```text
→ ALB
```

```text
→ Fastify
```

AWS API Gateway MAY incorporarse si aparecen necesidades específicas como:

APIs públicas externas.

Throttling avanzado.

API keys externas.

Usage plans.

Gateway-specific integrations.

## 12.55 S3

Amazon S3 será almacenamiento de objetos para:

Backups

Catalog Images

Logos

OTA Packages

Diagnostic Packages

Exports

Public Assets

MUST NOT utilizarse PostgreSQL como almacenamiento genérico de archivos grandes.

## 12.56 Secrets

Credenciales Cloud deberán almacenarse mediante mecanismos como:

AWS Secrets Manager

MUST NOT mantenerse secretos productivos dentro de:

Repositorio.

.env versionados.

Frontend bundles.

Docker images públicas.

## 12.57 Public Storefront Service

V1 incluirá un Public Storefront completamente Cloud-hosted.

Stack:

Next.js 16

React

TypeScript

Objetivos:

SSR.

SEO.

Metadata.

URLs públicas.

Menú rápido en mobile.

Caching.

Indexabilidad.

Compartibilidad.

## 12.58 Storefront como servicio independiente de Edge

El navegador del consumidor MUST NOT conectarse directamente al Edge.

```text
Arquitectura:
```

```text
Restaurant Edge
```

```text
↓
```

```text
Sync
```

```text
↓
```

```text
Cloud
```

```text
↓
```

```text
Published Catalog Projection
```

```text
↓
```

```text
Storefront
```

```text
↓
```

```text
Customer
```

No deberán abrirse puertos públicos en la red del restaurante.

## 12.59 Published Catalog Projection

Cloud mantendrá una proyección pública específica.

```text
Ejemplo conceptual:
```

```text
PublicLocation
```

```text
├── location_id
```

```text
├── public_slug
```

```text
├── name
```

```text
├── logo
```

```text
├── description
```

```text
├── address
```

```text
├── contact
```

```text
├── opening_hours
```

```text
└── public_status
```

```text
PublicCategory
```

```text
├── category_id
```

```text
├── name
```

```text
└── display_order
```

```text
PublicProduct
```

```text
├── product_id
```

```text
├── name
```

```text
├── description
```

```text
├── price
```

```text
├── image
```

```text
├── category_id
```

```text
├── available
```

```text
└── display_order
```

## 12.60 Información prohibida en Storefront

La proyección pública MUST NOT incluir accidentalmente:

Product cost

Margins

Supplier data

Internal audit records

Internal tax configuration details unnecessary for public display

Station routing

Printer configuration

User data

Cash information

License data

Secrets

Internal notes

## 12.61 Eventual Consistency del Storefront

Cuando Edge cambia:

```text
Product.available = false
```

```text
el flujo será:
```

```text
Edge mutation
```

```text
↓
```

```text
Event
```

```text
↓
```

```text
Sync
```

```text
↓
```

```text
Cloud Inbox
```

```text
↓
```

```text
Projection Worker
```

```text
↓
```

```text
PublicProduct.available = false
```

```text
↓
```

```text
Storefront cache invalidation
```

Con Internet disponible, el cambio SHOULD propagarse rápidamente.

Si Edge no tiene Internet:

```text
Storefront
```

```text
=
```

last synchronized published state

MUST NOT prometerse consistencia instantánea durante desconexión Edge↔Cloud.

## 12.62 Storefront V1

V1 incluirá:

Nombre del restaurante.

Logo.

Descripción.

Horarios.

Ubicación.

Contacto.

Menú.

Categorías.

Productos.

Precios.

Disponibilidad.

Imágenes.

Código QR.

URL pública.

Responsive design.

## 12.63 Slugs públicos

Cada Location con Storefront tendrá:

public_slug

**Ejemplo:**

tacos-el-gordo.comanview.app

El slug deberá ser:

Único.

Normalizado.

Validado.

Reservable.

## 12.64 Custom Domains

La arquitectura MAY preparar:

custom_domain

para permitir posteriormente:

www.restaurant.com

sin cambiar el modelo del Storefront.

La automatización completa del dominio personalizado puede desplegarse progresivamente.

## 12.65 Código QR

El QR representará la URL pública.

**Ejemplo:**

https://tacos-el-gordo.comanview.app

Puede generarse dinámicamente como:

SVG

PNG

No requiere necesariamente almacenar una imagen QR persistente.

## 12.66 Storefront V2 — Online Orders

V1 será read-only desde la perspectiva transaccional.

V1 MUST NOT aceptar Orders públicas.

La arquitectura deberá preparar un futuro:

Online Order Gateway

```text
Flujo futuro:
```

```text
Customer
```

```text
↓
```

```text
Storefront
```

```text
↓
```

```text
Online Order Gateway
```

```text
↓
```

```text
Cloud Durable State / Queue
```

```text
↓
```

```text
Edge
```

```text
↓
```

```text
Order Domain
```

## 12.67 Prohibición de escritura directa

```text
Futuras Orders online MUST NOT realizar:
```

```text
Storefront
```

```text
→ direct DB insert
```

```text
ni:
```

```text
Storefront
```

```text
→ Edge directly
```

Deben ingresar mediante un Gateway con:

Validation.

Authentication/anti-abuse.

Idempotency.

Durable acceptance.

State machine.

Edge delivery.

## 12.68 order_channel

Se introduce formalmente:

order_channel

separado de:

order_type

### order_type

Representa cómo se entrega/atiende la Order:

COUNTER

TABLE

TAKEOUT

### order_channel

Representa desde dónde se originó.

V1:

POS

WAITER

Futuro:

ONLINE_WEB

DELIVERY_AGGREGATOR

API

**Ejemplo:**

```text
order_type = TAKEOUT
```

```text
order_channel = ONLINE_WEB
```

## 12.69 Identificadores

Nuevas entidades utilizarán por defecto:

UUID v7

en lugar de UUID v4.

Aplica a entidades como:

order_id

order_item_id

round_id

payment_id

cash_session_id

event_id

audit_id

print_job_id

device_id

edge_id

salvo excepción documentada.

## 12.70 IDs humanos

Los UUID no reemplazan identificadores amigables.

**Ejemplo:**

order_id:

019c...

order_number:

A-00482

Los IDs humanos se utilizarán para UX/reportes.

Los UUID se utilizarán para identidad técnica.

## 12.71 Monorepo

ComanView utilizará:

pnpm workspaces

+

Turborepo

```text
Repositorio conceptual:
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
├── tooling/
```

```text
│   ├── eslint/
```

```text
│   ├── typescript/
```

```text
│   └── scripts/
```

```text
│
```

```text
├── pnpm-workspace.yaml
```

```text
├── turbo.json
```

```text
└── package.json
```

## 12.72 packages/domain

Será la capa de dominio compartida.

MUST NOT depender de:

Fastify

React

Next.js

Drizzle

SQLite

PostgreSQL

AWS

Vite

Podrá contener:

Entities

Value Objects

Domain Services

Commands

Domain Events

Invariants

Domain Errors

State Machines

Money Rules

## 12.73 packages/contracts

Contendrá contratos de frontera.

Ejemplos:

CreateOrderRequest

CreateOrderResponse

PaymentRequest

SyncEventEnvelope

WebSocketMessage

CloudCommand

ProvisioningPayload

Podrá utilizar:

Zod

para schemas runtime.

## 12.74 Domain Objects vs API Contracts

MUST NOT exponerse directamente una entidad Domain completa como respuesta HTTP por conveniencia.

```text
Correcto:
```

```text
Domain Entity
```

```text
→ Mapper
```

```text
→ API Response Contract
```

Esto permite evolucionar internamente el dominio sin romper contratos externos.

## 12.75 packages/money

Deberá centralizar:

Minor units.

Addition.

Subtraction.

Multiplication.

Allocation.

Tax calculation helpers.

Rounding policy.

Formatting helpers separados de cálculo.

MUST NOT existir lógica monetaria duplicada entre frontends.

## 12.76 packages/sync

Contendrá:

Event envelopes.

Event schemas.

Serialization.

Batch protocol.

ACK contracts.

Retry policies conceptuales.

Sync validation.

Version compatibility.

## 12.77 packages/printing

Contendrá:

Print Job contracts.

Ticket models.

ESC/POS generation.

PrinterAdapter interfaces.

Encoding/profile logic.

Print templates.

## 12.78 packages/ui

Contendrá componentes reutilizables entre:

POS

Waiter

KDS

Super Admin when appropriate

No deberá obligar a que todas las interfaces tengan exactamente la misma UX.

## 12.79 packages/client-sdk

```text
Encapsulará comunicación cliente → Edge.
```

```text
Podrá proporcionar:
```

```text
ordersClient
```

```text
paymentsClient
```

```text
cashClient
```

```text
catalogClient
```

```text
tablesClient
```

```text
websocketClient
```

Los componentes React SHOULD NOT construir requests HTTP ad-hoc en toda la aplicación.

## 12.80 Testing — estrategia general

ComanView utilizará:

Vitest

Playwright

Real database integration tests

No se buscará únicamente una cifra de cobertura.

Se priorizará cobertura de invariantes y escenarios de fallo.

## 12.81 Unit Tests

Vitest se utilizará especialmente para:

Money

Taxes

Order state

Payment rules

Cash calculations

Discount limits

Permissions

Modifier validation

Business date

Sync conflict logic

El Domain Layer deberá poder probarse sin levantar Fastify.

## 12.82 Integration Tests

Deberán probarse operaciones críticas contra:

real SQLite

real PostgreSQL

MUST NOT depender únicamente de mocks para validar:

Atomicidad.

Unique constraints.

Transactions.

Concurrency.

Migrations.

## 12.83 E2E

Playwright se utilizará para:

POS flows

Waiter flows

KDS flows

Super Admin flows

Storefront flows

## 12.84 Escenarios críticos obligatorios

Antes de liberar V1 deberán existir pruebas para:

Duplicate Payment retry

Duplicate command retry

Duplicate Event sync

Concurrent payment attempts

Concurrent Order mutations

Edge restart during OPEN CashSession

Edge restart with pending PrintJob

Edge restart with unsynced Events

Internet disconnect

Internet reconnect

Catalog mutation during OPEN Order

Product unavailable while DRAFT exists

Printer failure during Z

PrintJob UNKNOWN recovery

Failed migration

Backup restore

DB corruption detection

License suspension during active CashSession

Suspension after Z

Storefront stale availability while Edge offline

## 12.85 Property-Based Testing

Para dominios financieros críticos SHOULD considerarse property testing.

Ejemplos:

```text
sale_total >= 0
```

según reglas de descuentos.

```text
balance_due =
```

```text
sale_total - completed_payment_amount
```

```text
cash_tendered =
```

```text
amount_applied + change_given
```

cuando corresponda.

La finalidad será detectar combinaciones no cubiertas manualmente.

## 12.86 Migrations Edge

Migrations Edge se almacenarán separadamente:

migrations/edge

```text
Flujo productivo:
```

```text
Current schema
```

```text
↓
```

```text
Pre-update backup
```

```text
↓
```

```text
Migration
```

```text
↓
```

```text
Validation
```

```text
↓
```

```text
Health Check
```

## 12.87 Migrations Cloud

Cloud tendrá:

migrations/cloud

y deberán ejecutarse mediante CI/CD controlado.

Cambios destructivos deberán utilizar estrategia compatible con despliegues progresivos cuando sea necesario.

## 12.88 Revisión de Migrations

Las migrations generadas automáticamente MUST revisarse antes de producción.

No deberá asumirse que una herramienta ORM puede decidir automáticamente la estrategia segura de evolución de datos.

## 12.89 Versionamiento de schema

Existirán conceptos equivalentes a:

edge_schema_version

cloud_schema_version

Los backups Edge deberán registrar su schema_version según Sección 11.

## 12.90 Compatibilidad de actualización

Una versión nueva del Edge deberá declarar:

Schema mínimo soportado.

Schema objetivo.

Migration path.

Compatibilidad de rollback cuando exista.

MUST NOT suponerse rollback universal.

## 12.91 Packaging Edge

V1 soportará oficialmente primero:

Windows 11 x64

El cliente MUST NOT instalar manualmente Node.

```text
El paquete incluirá conceptualmente:
```

```text
Installer
```

```text
├── Pinned Node Runtime
```

```text
├── Edge Application
```

```text
├── SQLite Native Dependency
```

```text
├── POS Assets
```

```text
├── Waiter Assets
```

```text
├── KDS Assets
```

```text
├── Service Configuration
```

```text
└── Update Components
```

## 12.92 Node Single Executable

V1 no dependerá obligatoriamente de Node Single Executable Applications.

La distribución podrá incluir Node embebido/pinned.

SEA MAY reevaluarse cuando su estabilidad y soporte cubran completamente las necesidades del producto.

## 12.93 Servicio Windows

Edge se registrará como servicio del sistema.

MUST:

Arrancar automáticamente.

Ejecutarse sin sesión interactiva.

Reiniciarse ante crash recuperable.

Utilizar permisos mínimos necesarios.

Mantener paths persistentes separados de binarios.

## 12.94 Linux

Linux MAY soportarse posteriormente para:

Dedicated Mini-PC Edge

V1 no intentará validar simultáneamente múltiples plataformas operativas.

## 12.95 Instalador

El instalador podrá construirse mediante:

WiX Toolset

o herramienta equivalente.

Responsabilidades:

Install binaries

Install runtime

Create application directories

Set filesystem permissions

Register Windows service

Initialize UNPROVISIONED state

Start service

Launch provisioning flow

MUST NOT incluir secretos permanentes.

## 12.96 Docker

Cloud:

Docker / OCI

```text
=
```

```text
REQUIRED
```

Edge:

```text
Docker
```

```text
=
```

```text
NOT REQUIRED / NOT USED IN V1
```

El restaurante MUST NOT depender de:

Docker Desktop.

Container daemon.

Kubernetes.

Compose.

para realizar ventas.

## 12.97 Cloud Containers

Cloud API y Workers se distribuirán como imágenes OCI.

**Ejemplo:**

cloud-api image

cloud-worker image

storefront image

Estos artefactos deberán ser reproducibles.

## 12.98 CI/CD

Se utilizará:

GitHub Actions

```text
Pipeline de Pull Request:
```

```text
Install
```

```text
↓
```

```text
Lint
```

```text
↓
```

```text
Typecheck
```

```text
↓
```

```text
Unit Tests
```

```text
↓
```

```text
Integration Tests
```

```text
↓
```

```text
Build
```

## 12.99 Staging

```text
Merge hacia rama principal deberá poder ejecutar:
```

```text
Build Cloud Images
```

```text
↓
```

```text
Deploy Staging
```

```text
↓
```

```text
Run Cloud Migrations
```

```text
↓
```

```text
Run E2E
```

```text
↓
```

```text
Health Checks
```

## 12.100 Releases Edge

```text
Flujo:
```

```text
Build Windows Artifact
```

```text
↓
```

```text
Unit / Integration Tests
```

```text
↓
```

```text
Package
```

```text
↓
```

```text
Sign
```

```text
↓
```

```text
Publish
```

```text
↓
```

```text
INTERNAL
```

```text
↓
```

```text
PILOT
```

```text
↓
```

```text
STABLE
```

## 12.101 Firma de artefactos

Edge installer y OTA packages SHOULD utilizar firma de código/artefactos.

Edge MUST verificar:

Integrity

+

Authenticity

antes de instalar una actualización.

## 12.102 Environments

ComanView tendrá al menos:

local

test

staging

production

Estos son ambientes de infraestructura.

## 12.103 Release Channels

Separadamente existirán:

INTERNAL

PILOT

STABLE

Los release channels determinan rollout de Edge.

MUST NOT confundirse:

staging

con:

PILOT

## 12.104 Observabilidad Cloud

Cloud deberá utilizar:

Structured Logs

Metrics

Traces

Alerts

Las implementaciones SHOULD seguir convenciones OpenTelemetry cuando sea razonable.

## 12.105 Observabilidad Edge

Edge deberá mantener:

Structured Local Logs

Health Metrics

Sanitized Telemetry

Telemetría MAY sincronizarse con Cloud.

MUST NOT enviar secretos.

## 12.106 Correlation IDs

Requests y operaciones relevantes SHOULD incorporar identificadores de correlación.

**Ejemplo:**

request_id

command_id

event_id

print_job_id

Esto facilitará reconstrucción de incidentes.

## 12.107 Logging estructurado

Preferir:

JSON structured logs

en servicios backend.

Cada log relevante debería poder incluir:

timestamp

level

component

tenant_id when allowed

location_id

edge_id

device_id

request_id

event_id

message

según contexto.

## 12.108 Datos sensibles en logs

MUST NOT registrarse:

Password.

PIN.

Private keys.

Full auth tokens.

PAN.

CVV.

Secrets.

Payloads sensibles deberán ser sanitizados.

## 12.109 Versiones del Documento Maestro

El Documento Maestro fijará únicamente versiones arquitectónicas importantes.

**Ejemplo:**

Node.js 24 LTS

Next.js 16

PostgreSQL 18

MUST NOT fijar:

24.x.y

16.x.y

18.x

innecesariamente.

## 12.110 Versiones exactas

Las versiones exactas vivirán en:

package.json

pnpm-lock.yaml

Dockerfiles

Infrastructure manifests

Release metadata

Esto permitirá actualizar patches/minors sin reescribir la especificación del producto.

## 12.111 Dependency Management

Todas las dependencias JS/TS se administrarán mediante:

pnpm

MUST existir:

pnpm-lock.yaml

versionado.

Builds de CI MUST utilizar instalación determinista.

## 12.112 Dependencias compartidas

El monorepo SHOULD centralizar versiones cuando sea razonable para evitar:

React 19 in POS

React 20 in KDS

different Zod contracts

different money libraries

sin razón.

## 12.113 Seguridad de dependencias

CI SHOULD incorporar progresivamente:

Dependency vulnerability scanning.

Lockfile review.

Secret scanning.

Static analysis.

Un update automático MUST NOT desplegarse directamente a producción sin tests.

## 12.114 Arquitectura Super Admin

Super Admin será una aplicación Cloud web separada de los clientes del restaurante.

Podrá utilizar:

React / Next.js

según convenga en implementación.

No requiere SSR público/SEO como el Storefront.

Compartirá contratos Cloud donde corresponda.

## 12.115 API interna vs API pública

Cloud deberá separar conceptualmente:

Edge Sync API

Super Admin API

Public Storefront API/read path

Future External API

MUST NOT tratarse todas las rutas con el mismo modelo de autenticación/permisos.

## 12.116 Storefront Public API

El Storefront podrá utilizar:

Server Components/SSR.

Server-side queries.

Public read endpoints.

La Public API MUST ser:

READ ONLY

en V1.

## 12.117 Cache Storefront

El Storefront podrá utilizar:

CDN caching

application caching

projection caching

siempre respetando cambios de disponibilidad.

La invalidación deberá producirse después de una actualización válida de la Published Projection.

## 12.118 Assets públicos

Imágenes de producto y logo deberán almacenarse en object storage y servirse mediante CDN cuando sea posible.

El Storefront MUST NOT depender de descargar imágenes directamente desde Edge.

## 12.119 Configuración del sistema

La configuración deberá diferenciar:

Build-time config

Runtime config

Tenant config

Location config

Secrets

Feature Flags

Entitlements

MUST NOT mezclarse en un único archivo gigante.

## 12.120 Feature Flags

Feature Flags deberán consumirse mediante una abstracción compartida.

**Ejemplo:**

featureFlags.isEnabled(...)

Los componentes SHOULD NOT consultar directamente tablas Cloud o valores arbitrarios.

## 12.121 Entitlements

Los módulos comerciales deberán validarse en Edge y Cloud según corresponda.

**Ejemplo:**

KDS entitlement disabled

debe impedir activar KDS aunque exista código del módulo.

## 12.122 Error Handling

Los errores se clasificarán al menos conceptualmente como:

ValidationError

AuthenticationError

AuthorizationError

DomainConflictError

NotFoundError

InfrastructureError

ExternalDependencyError

Los clientes MUST recibir errores estructurados.

## 12.123 Domain Errors

El dominio deberá producir errores semánticos.

Ejemplos:

ORDER_ALREADY_CLOSED

PRODUCT_UNAVAILABLE

PAYMENT_EXCEEDS_BALANCE

CASH_SESSION_ALREADY_OPEN

STALE_ORDER_VERSION

MODIFIER_SELECTION_INVALID

LICENSE_SUSPENDED

MUST evitarse depender del texto humano del error para lógica frontend.

## 12.124 Error Codes

Los contratos deberán exponer códigos estables.

**Ejemplo:**

{

"code": "PAYMENT_EXCEEDS_BALANCE",

"message": "...",

"details": {}

}

La message MAY traducirse.

El code será la referencia lógica.

## 12.125 Localización

Aunque el idioma inicial del producto pueda ser definido durante implementación, textos de UI SHOULD estar preparados para internacionalización.

Los identificadores internos y código SHOULD utilizar inglés consistentemente.

## 12.126 Fechas y horas

Persistir timestamps utilizando una representación inequívoca.

El sistema deberá distinguir:

UTC timestamp

Location timezone

business_date

business_date MUST NOT reconstruirse simplemente desde UTC.

## 12.127 Timezone

Cada Location deberá disponer de:

timezone

con formato de timezone reconocido.

**Ejemplo:**

America/Monterrey

La lógica temporal de negocio utilizará Location timezone cuando corresponda.

## 12.128 Public Storefront y timezone

Los horarios públicos del Storefront deberán presentarse utilizando la timezone del Location, no la timezone del servidor Cloud.

## 12.129 Seguridad del Edge

El Edge deberá ejecutarse utilizando un usuario de servicio con permisos mínimos.

La base, backups y secrets deberán tener permisos de filesystem restrictivos.

## 12.130 Seguridad Cloud

Cloud deberá aplicar como mínimo:

TLS.

Secrets management.

Least privilege IAM.

Private DB networking.

Restricted security groups.

Encrypted storage.

Audited administrative actions.

## 12.131 PostgreSQL Networking

RDS/PostgreSQL MUST NOT exponerse públicamente a Internet.

Únicamente servicios autorizados dentro de la infraestructura deberán conectarse.

## 12.132 Database Credentials

Credenciales DB MUST NOT compartirse con:

Storefront browser.

POS.

Waiter.

KDS.

Restaurant Edge.

Edge nunca conecta directamente a PostgreSQL Cloud.

## 12.133 Sync transport

Edge sincronizará exclusivamente mediante APIs autenticadas.

MUST NOT tener acceso directo a tablas Cloud.

## 12.134 Cloud schema independence

Edge y Cloud tendrán schemas distintos.

MUST NOT suponerse:

SQLite schema

```text
=
```

PostgreSQL schema

Cloud podrá tener:

Inbox tables.

Projections.

Analytics.

Control plane data.

que no existen localmente.

## 12.135 Storefront schema independence

La Published Catalog Projection será un read model, no una réplica completa de Product.

Esto permite optimizar:

Queries.

Caching.

Security.

SEO rendering.

## 12.136 Data retention

Las políticas exactas podrán definirse posteriormente, pero datos transaccionales/auditables MUST conservarse según requisitos comerciales y legales aplicables.

No se implementará borrado destructivo automático de historia financiera como optimización de espacio.

## 12.137 Performance Philosophy

Antes de introducir infraestructura adicional se deberá:

```text
Measure
```

```text
→ Identify bottleneck
```

```text
→ Optimize
```

```text
MUST NOT hacerse:
```

```text
Assume scale
```

```text
→ Introduce distributed complexity
```

## 12.138 Edge Performance

Prioridades:

Queries indexadas.

Transacciones cortas.

WAL.

Evitar N+1.

Batch sync.

Durable queues.

Cache únicamente donde aporte valor.

No se introducirá Redis local.

## 12.139 Cloud Scalability

Cloud deberá ser stateless donde sea práctico para permitir:

multiple ECS tasks

La información durable residirá en servicios externos como:

PostgreSQL

S3

## 12.140 Storefront Scalability

Storefront utilizará:

CDN.

Caching.

SSR/ISR-equivalent mechanisms cuando correspondan.

Published projections.

Una visita pública nunca deberá generar carga contra Edge.

## 12.141 Tecnologías aprobadas

Stack V1:

| Área | Tecnología |
| --- | --- |
| Lenguaje principal | TypeScript |
| Edge runtime | Node.js 24 LTS |
| Edge HTTP | Fastify |
| Edge DB | SQLite + WAL |
| SQLite driver | better-sqlite3 |
| DB/query layer | Drizzle |
| Runtime validation | Zod |
| Device protocol | REST + WebSocket |
| POS | React + Vite / PWA |
| Waiter | React + Vite / PWA |
| KDS | React + Vite |
| Cloud runtime | Node.js 24 LTS |
| Cloud API | Fastify |
| Cloud DB | PostgreSQL 18 |
| Storefront | Next.js 16 + React |
| Cloud provider | AWS |
| Cloud containers | Docker/OCI |
| Compute | ECS Fargate |
| Cloud DB hosting | RDS PostgreSQL |
| Object storage | S3 |
| CDN | CloudFront |
| Monorepo | pnpm + Turborepo |
| Unit tests | Vitest |
| E2E | Playwright |
| Migrations | Drizzle + reviewed migrations |
| CI/CD | GitHub Actions |
| Edge V1 OS | Windows 11 x64 |
| Edge Docker | No |
| UUID default | UUID v7 |

## 12.142 Tecnologías expresamente no requeridas en V1

MUST NOT introducirse sin necesidad técnica demostrada:

Microservices everywhere

Kubernetes

Kafka

Redis on Edge

RabbitMQ on Edge

Docker on Edge

Electron

React Native

Go services

Rust services

gRPC for browser clients

GraphQL local API

LibSQL replication as Sync Engine

Multiple primary Edges

Cloud-dependent POS

Estas tecnologías no están prohibidas permanentemente.

Su inclusión requiere una razón arquitectónica nueva.

## 12.143 Decisiones técnicas consolidadas

Las siguientes decisiones son normativas:

TypeScript será el lenguaje principal.

V1 no requiere un segundo lenguaje.

Node.js 24 LTS será runtime de Edge y Cloud.

Fastify será framework HTTP principal.

Edge será Modular Monolith.

SQLite + WAL será DB Edge.

LibSQL no reemplazará Sync Engine.

better-sqlite3 será driver inicial.

Drizzle será database/query layer.

Zod validará contratos runtime.

Money utilizará minor units enteras/exactas.

Device ↔ Edge utilizará REST + WebSocket.

gRPC no será requerido para clientes browser V1.

Edge utilizará queues persistidas en SQLite.

PostgreSQL será DB Cloud.

Cloud será Modular Monolith + Workers inicialmente.

Edge utilizará Transactional Outbox y Cloud Inbox idempotente.

AWS será infraestructura Cloud primaria.

ECS Fargate + RDS PostgreSQL + S3 + CloudFront será base del deployment.

Next.js será framework del Public Storefront.

Storefront utilizará Published Catalog Projection independiente.

POS/KDS/Waiter utilizarán React + Vite.

POS será web/PWA local y no desktop nativo inicialmente.

Waiter será PWA y no React Native.

Printing utilizará Adapter abstraction.

Monorepo utilizará pnpm + Turborepo.

packages/domain será independiente de frameworks/ORM.

Testing utilizará Vitest + bases reales + Playwright.

Windows 11 x64 será primer Edge OS soportado.

Edge se distribuirá con installer autocontenido y sin Docker.

UUID v7 será el estándar para nuevas entidades.

order_channel será independiente de order_type.

El Documento Maestro fijará major/LTS relevantes, no patch/minor exactos.

## 12.144 Resumen normativo para implementación

```text
Primary language =
```

```text
TypeScript
```

```text
Edge runtime =
```

Node.js 24 LTS

```text
Cloud runtime =
```

Node.js 24 LTS

```text
Edge architecture =
```

```text
MODULAR MONOLITH
```

```text
Cloud architecture V1 =
```

```text
MODULAR MONOLITH + WORKERS
```

```text
Edge database =
```

```text
SQLite + WAL
```

```text
Cloud database =
```

PostgreSQL 18

```text
Edge replication through LibSQL =
```

```text
FALSE
```

```text
Edge persistent queues =
```

```text
SQLite
```

```text
Redis on Edge =
```

```text
FALSE
```

```text
RabbitMQ on Edge =
```

```text
FALSE
```

```text
Kafka required =
```

```text
FALSE
```

```text
Device protocol =
```

```text
REST + WebSocket
```

```text
gRPC browser clients =
```

```text
FALSE
```

```text
POS =
```

```text
React + Vite PWA
```

```text
Waiter =
```

```text
React + Vite PWA
```

```text
KDS =
```

```text
React + Vite
```

```text
Native POS desktop required =
```

```text
FALSE
```

```text
React Native required =
```

```text
FALSE
```

```text
Printing authority =
```

```text
EDGE
```

```text
Primary print protocol =
```

```text
TCP ESC/POS
```

```text
Cloud provider =
```

```text
AWS
```

```text
Cloud compute =
```

ECS Fargate

```text
Cloud object storage =
```

```text
S3
```

```text
Cloud CDN =
```

```text
CloudFront
```

```text
Storefront =
```

Next.js 16

```text
Storefront talks directly to Edge =
```

```text
FALSE
```

```text
Storefront transactional V1 =
```

```text
FALSE
```

```text
Published Catalog Projection =
```

```text
REQUIRED
```

```text
Storefront consistency =
```

```text
EVENTUAL
```

```text
Online Orders V1 =
```

```text
FALSE
```

```text
order_channel =
```

SEPARATE FROM order_type

```text
Default global IDs =
```

UUID v7

```text
Monorepo =
```

```text
pnpm + Turborepo
```

```text
Domain depends on Fastify =
```

```text
FALSE
```

```text
Domain depends on React =
```

```text
FALSE
```

```text
Domain depends on Drizzle =
```

```text
FALSE
```

```text
Runtime validation =
```

```text
Zod
```

```text
Unit testing =
```

```text
Vitest
```

```text
E2E testing =
```

```text
Playwright
```

```text
Edge V1 OS =
```

Windows 11 x64

```text
Docker Cloud =
```

```text
TRUE
```

```text
Docker Edge =
```

```text
FALSE
```

```text
CI/CD =
```

GitHub Actions

```text
Edge release channels =
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

## 12.145 Regla Central de Arquitectura

La arquitectura técnica de ComanView deberá mantener una única autoridad operacional local, minimizar dependencias dentro del restaurante y compartir la mayor cantidad posible de dominio y contratos sin acoplar las reglas de negocio a frameworks específicos.

Por tanto:

Edge será un Modular Monolith TypeScript sobre Node.js y SQLite que concentra la autoridad transaccional local; Cloud será una plataforma TypeScript/PostgreSQL desacoplada del camino crítico de venta; POS, Waiter y KDS serán clientes web ligeros servidos localmente; y la infraestructura adicional solo deberá introducirse cuando resuelva un problema técnico medido y no por anticipación de escala.

El principio rector de implementación será:

Mantener simple la operación local, mantener fuerte la consistencia transaccional y permitir que la complejidad crezca únicamente en las fronteras donde realmente sea necesaria.
