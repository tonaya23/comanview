# Guía de aceptación limpia — Fase 1U

Esta guía prepara e instala **Restaurante Demo** desde cero en el laboratorio local. Está escrita
para una persona que está aprendiendo ComanView. Los valores temporales de seguridad se copian entre
pantallas, pero nunca se pegan en chats, tickets o capturas.

## 1. Conceptos en lenguaje sencillo

- **Super Admin:** panel que usa ComanView para dar de alta clientes, locales, planes, licencias y
  Edge. No es una pantalla de operación diaria del restaurante.
- **Tenant:** el cliente u organización propietaria de uno o más restaurantes.
- **Location:** un restaurante físico concreto, con su zona horaria, licencia y Edge.
- **Edge:** servidor local del restaurante. Conserva SQLite y es la autoridad operacional y
  financiera aunque Internet falle.
- **Provisioning:** vincular de forma segura un Edge nuevo con una Location usando un código temporal.
- **Plan:** definición comercial/técnica que agrupa capacidades y límites. El código operacional no
  autoriza por el nombre del Plan.
- **Entitlements:** capacidades efectivas concedidas por la licencia, por ejemplo `CORE_POS`, `KDS`
  o `PRINTING`.
- **Feature Flags:** banderas firmadas separadas para habilitar comportamiento previsto. No son un
  sustituto del Plan ni de los permisos del usuario.
- **License:** documento firmado que lleva al Edge el estado comercial, capacidades y límites.
  `ACTIVE` permite operar; `PAST_DUE` y `GRACE_PERIOD` conservan una ventana controlada;
  `SUSPENDED` restringe nueva operación y protege obligaciones existentes; `TERMINATED` permanece
  bloqueante hasta recibir un estado firmado posterior válido.
- **First-device bootstrap:** autorización firmada y de un solo uso para crear el primer OWNER y
  activar el primer Device cuando todavía no existe nadie que pueda aprobarlo localmente.
- **Device:** una terminal física o navegador autorizado, por ejemplo un POS o KDS.
- **User:** una persona con PIN, roles y permisos. Device y User son identidades distintas.
- **Device credential:** secreto del navegador que demuestra qué terminal es. El **PIN** demuestra
  qué persona está operando. Se necesitan ambos para el login normal.
- **Pairing:** solicitud temporal de seis dígitos para autorizar un Device adicional desde
  Administración Local.
- **OWNER:** administrador local del restaurante. Gestiona Devices y revisa readiness sin entrar a
  Super Admin.
- **Administración Local:** panel dentro del POS para Devices, solicitudes y estado de instalación.
- **Readiness:** diagnóstico derivado de componentes reales. `Production Readiness = NOT_READY`
  puede ser correcto aunque el POS opere, porque Backup/Recovery pertenece a Fase 1V.
- **Cloud:** administra identidad Edge, control, licencia, sincronización y Super Admin; no participa
  en el camino crítico de una venta.
- **Offline:** Edge, POS, caja, pedidos, pagos, KDS y permisos locales continúan según la última
  política firmada válida. Cloud y Sync convergen al volver Internet.

## 2. Quién hace qué

### ComanView / Platform Admin / instalador

Crea Tenant y Location, configura Plan/licencia, genera el código de provisioning, comprueba Edge y
Cloud, y emite la autorización inicial. Usa Super Admin durante alta, replacement o revocación de
infraestructura; el dueño no necesita estas funciones en la operación normal.

### Dueño del restaurante

Completa el OWNER inicial, inicia sesión con Device autorizado + PIN, abre Administración Local,
aprueba o cancela pairings, revoca Devices y revisa readiness.

### Empleados

`CASHIER`, `WAITER`, `KITCHEN` y otros perfiles usan Devices ya autorizados y sus propios PIN/RBAC.
No usan Super Admin. La administración completa de usuarios aún no forma parte de esta fase.

### Sistema

Cloud y Edge realizan automáticamente persistencia, firma/verificación, heartbeat, Sync, pull de
control state, sesiones, licencia y readiness. Ninguna persona debe copiar credenciales internas ni
editar SQLite/PostgreSQL para completar el flujo.

## 3. Arranque del laboratorio

Use cuatro PowerShell nuevas. No comparta la información que se copia al portapapeles.

### Terminal 1 — PostgreSQL y Cloud API

```powershell
cd C:\Proyects\comanview
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Environment restaurant-acceptance -Target Database
pnpm dev:cloud:db
pnpm dev:cloud:migrate
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Environment restaurant-acceptance -Target Cloud
pnpm --filter @comanview/cloud-api dev
```

Déjela abierta. Cloud debe escuchar en `http://127.0.0.1:4000`.

### Terminal 2 — Edge (esperar el código de provisioning)

```powershell
cd C:\Proyects\comanview
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Environment restaurant-acceptance -Target Edge
```

No inicie Edge todavía. Cuando Super Admin muestre el código de provisioning:

```powershell
$env:COMANVIEW_PROVISIONING_CODE = Read-Host 'Pega el código de provisioning'
pnpm --filter @comanview/edge provision
Remove-Item Env:COMANVIEW_PROVISIONING_CODE
pnpm --filter @comanview/edge dev
```

El comando `provision` aplica las migrations Edge hasta `0013`, crea la identidad durable y guarda
la credencial fuera de la base. Después Edge debe escuchar en `http://127.0.0.1:3000`.

### Terminal 3 — Super Admin

```powershell
cd C:\Proyects\comanview
. .\scripts\Load-1UDevelopmentEnvironment.ps1 -Environment restaurant-acceptance -CopyCloudAdminPassword
pnpm --filter @comanview/super-admin dev
```

Abra `http://127.0.0.1:5176`. El script muestra el email de desarrollo y copia la contraseña al
portapapeles sin imprimirla.

### Terminal 4 — POS

```powershell
cd C:\Proyects\comanview
pnpm --filter @comanview/pos dev
```

Abra `http://localhost:5173`. Antes de provisionar Edge puede mostrar desconexión; es esperado.

## 4. Instalación de Restaurante Demo

### Etapa ComanView / instalador

#### Alta del cliente y local

**QUÉ ESTÁS HACIENDO:** iniciar sesión en Super Admin, abrir **Control Plane**, crear Tenant
`Restaurante Demo` y Location `Restaurante Demo - Principal` con timezone `America/Matamoros`.

**PARA QUÉ SIRVE:** establece la organización y el restaurante físico donde vivirá el Edge.

**QUIÉN LO HACE EN UN CASO REAL:** ComanView / instalador.

**DÓNDE SE HACE:** `http://127.0.0.1:5176`, Control Plane.

**QUÉ DEBERÍAS VER:** Tenant y Location `ACTIVE`, inicialmente sin Edge y sin licencia.

**QUÉ NO DEBES COMPARTIR:** contraseña del administrador Cloud ni cookie de sesión.

#### Plan y licencia

**QUÉ ESTÁS HACIENDO:** crear el Plan `DEMO_ACCEPTANCE`, nombre `Demo Acceptance`, capacidades
`CORE_POS`, `KDS`, `PRINTING` y `TABLE_SERVICE`; límites `POS=2`, `WAITER=2`, `KDS=1`. Seleccionarlo
en la Location y pulsar **Asignar licencia**. Mantener estado `ACTIVE` y configurar propinas
`10,15,20`.

**PARA QUÉ SIRVE:** define capacidades efectivas, límites de Devices y configuración firmada.

**QUIÉN LO HACE EN UN CASO REAL:** ComanView / responsable comercial autorizado.

**DÓNDE SE HACE:** Control Plane, sección de Planes y tarjeta de la Location.

**QUÉ DEBERÍAS VER:** licencia `ACTIVE`, Plan asignado y Location aún `Sin Edge activo`.

**QUÉ NO DEBES COMPARTIR:** credenciales Cloud; el código del Plan no es una contraseña.

#### Provisioning del Edge

**QUÉ ESTÁS HACIENDO:** pulsar **Generar código**, copiarlo una vez y ejecutar los comandos de
provisioning de Terminal 2. Después iniciar Edge.

**PARA QUÉ SIRVE:** vincula criptográficamente este servidor local con la Location correcta.

**QUIÉN LO HACE EN UN CASO REAL:** instalador de ComanView.

**DÓNDE SE HACE:** Super Admin y Terminal 2.

**QUÉ DEBERÍAS VER:** Edge `ACTIVE`, heartbeat reciente, licencia/configuración recibidas y ACK.

**QUÉ NO DEBES COMPARTIR:** provisioning code vigente, credencial Edge o secret store.

### Etapa dueño del restaurante

#### Primer Device y OWNER

**QUÉ ESTÁS HACIENDO:** abrir el primer POS, poner un nombre claro como `Caja principal`, pulsar
**Emparejar dispositivo** y copiar **Datos para autorizar este dispositivo**. En Super Admin pulsar
**Autorizar instalación inicial**, pegar el bloque y escribir el nombre del OWNER. Copiar la
autorización firmada una sola vez, pegarla en POS, definir localmente el PIN y completar instalación.

**PARA QUÉ SIRVE:** crea el primer administrador local sin sembrar usuarios o Devices conocidos.

**QUIÉN LO HACE EN UN CASO REAL:** instalador y dueño, físicamente presentes.

**DÓNDE SE HACE:** primer POS y Super Admin.

**QUÉ DEBERÍAS VER:** bootstrap `COMPLETED`, primer Device `ACTIVE`, OWNER creado y login por PIN.

**QUÉ NO DEBES COMPARTIR:** PIN, pairing code vigente, bloque de autorización o Device credential.

#### Administración Local

**QUÉ ESTÁS HACIENDO:** iniciar sesión como OWNER y pulsar **Administración**.

**PARA QUÉ SIRVE:** revisar Devices, pairings y readiness sin depender de Super Admin.

**QUIÉN LO HACE EN UN CASO REAL:** dueño o usuario con permisos administrativos locales.

**DÓNDE SE HACE:** encabezado del POS.

**QUÉ DEBERÍAS VER:** `Caja principal` ACTIVE, detalle de readiness y Backup `PENDING_PHASE`.

**QUÉ NO DEBES COMPARTIR:** IDs completos salvo soporte necesario; nunca credenciales.

### Etapa instalación de equipos adicionales

#### Segundo POS

**QUÉ ESTÁS HACIENDO:** abrir `http://127.0.0.1:5173` en otro perfil/navegador, nombrarlo
`Caja secundaria` y solicitar pairing. En el primer POS, Administración → solicitudes, seleccionar
la solicitud, escribir el código de seis dígitos y aprobar.

**PARA QUÉ SIRVE:** autoriza una terminal adicional sin volver a Cloud ni repetir bootstrap.

**QUIÉN LO HACE EN UN CASO REAL:** OWNER local.

**DÓNDE SE HACE:** Device nuevo y Administración Local del primer POS.

**QUÉ DEBERÍAS VER:** segundo Device `ACTIVE`; el mismo PIN OWNER funciona porque el Device y el
User son comprobaciones separadas.

**QUÉ NO DEBES COMPARTIR:** pairing code o Device credential.

#### Cancelar, expirar y revocar

**QUÉ ESTÁS HACIENDO:** desde un tercer perfil crear una solicitud y cancelarla en Administración;
crear otra y dejarla diez minutos sin aprobar; revocar un Device secundario con confirmación.

**PARA QUÉ SIRVE:** valida estados terminales y seguridad administrativa.

**QUIÉN LO HACE EN UN CASO REAL:** OWNER ante una solicitud abandonada o un equipo retirado.

**DÓNDE SE HACE:** Administración Local.

**QUÉ DEBERÍAS VER:** `CANCELLED`, `EXPIRED` no aprobable y `REVOKED` sin reactivación; sus sesiones
dejan de ser válidas. El cliente revocado debe solicitar pairing con una identidad nueva.

**QUÉ NO DEBES COMPARTIR:** códigos vigentes, PIN ni datos guardados por el navegador.

### Etapa operativa

Después del bootstrap se puede probar una venta normal: abrir CashSession, crear Order, agregar y
enviar productos, comprobar KDS/Printing, registrar Payment y cerrar Order. Para validar 1T puede
apagarse solo Cloud API mientras Edge sigue activo y confirmar que la operación local continúa con
la última licencia válida. Los escenarios restrictivos `SUSPENDED`, Guaranteed Shift, Protected
Orders y `LICENSE_RECOVERY` deben ejecutarse como un bloque separado y controlado; no son requisitos
del mecanismo de pairing, pero quedaron pendientes de comprobación manual hasta disponer de Devices.

## 5. Checklist manual completa y acotada

1. [ ] **Cloud/Super Admin:** crear Tenant, Location y Plan; asignar licencia.
   **Esperado:** un solo restaurante nuevo, licencia `ACTIVE`, sin datos heredados.
2. [ ] **Provisioning:** generar código, ejecutar `provision`, iniciar Edge.
   **Esperado:** Edge `ACTIVE`, heartbeat/control state/ACK correctos.
3. [ ] **Primera instalación:** crear pairing inicial y emitir autorización estructurada.
   **Esperado:** una autorización `ISSUED`; no revelar sus contenidos.
4. [ ] **OWNER:** completar bootstrap y entrar con Device proof + PIN.
   **Esperado:** bootstrap irreversible `COMPLETED`, OWNER y primer Device `ACTIVE`.
5. [ ] **Persistencia:** recargar POS y reiniciar Edge.
   **Esperado:** identidad Device, OWNER y login continúan funcionando.
6. [ ] **Cloud offline:** detener solo Cloud API y operar localmente; luego restaurarlo.
   **Esperado:** Edge/POS siguen operando y heartbeat/control/sync reconvergen después.
7. [ ] **Segundo Device:** emparejar `Caja secundaria` desde Administración Local.
   **Esperado:** aprobación local y login correctos, sin Super Admin.
8. [ ] **Cancelar y expirar:** cancelar una solicitud PENDING y dejar otra superar diez minutos.
   **Esperado:** `CANCELLED` y `EXPIRED`, ambas terminales y no aprobables.
9. [ ] **Revocación y re-pair:** revocar el segundo Device, intentar usarlo y solicitar pairing nuevo.
   **Esperado:** login anterior bloqueado; re-pair crea una identidad nueva, nunca reactiva la vieja.
10. [ ] **Device limits:** con dos POS ACTIVE intentar aprobar un tercero.
    **Esperado:** `DEVICE_LIMIT_REACHED` contextual; ningún tercer POS queda ACTIVE.
11. [ ] **Readiness/UI administrativa:** revisar estados, duplicados, detalles y mensajes.
    **Esperado:** badges con texto, errores dentro del panel, IDs bajo detalles y Backup 1V pendiente.
12. [ ] **Operación base:** caja → Order → Round → KDS/Printing → Payment → cierre.
    **Esperado:** flujo local completo sobre SQLite real.
13. [ ] **Validación 1T diferida:** probar el bloque controlado SUSPENDED/turno protegido y recovery.
    **Esperado:** guards y recuperación coinciden con los tests; Cloud nunca entra al hot path.

No hace falta compartir códigos, bloques firmados ni IDs para reportar PASS/FAIL; normalmente basta
con estado visible y mensaje de error.

## 6. Seguridad

**Puede compartir normalmente:** estados, nombres genéricos, mensajes de error e IDs técnicos solo
cuando aporten valor a soporte. Un ID identifica un registro; no equivale automáticamente a una
contraseña.

**No comparta:** PIN, Device credential, request token/proof, pairing code vigente, provisioning code
vigente, InstallationAuthorization firmada, secret stores, tokens, passwords o claves/PEM privadas.
