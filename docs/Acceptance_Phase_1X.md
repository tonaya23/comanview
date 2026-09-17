# Fase 1X — Aceptación UX/UI

Estado de fase: **1X CLOSED — TECHNICAL VALIDATION PASS**. Aceptación manual: **MANUAL ACCEPTANCE PASS**, confirmada por el usuario tras UX Round 2.
La aceptación de 1W no constituye aceptación de 1X.
Validación técnica final: **TECHNICAL VALIDATION PASS**. El aislamiento obligatorio de tests
sensibles resolvió el bloqueo de concurrencia; `pnpm test` terminó con exit code 0 el 2026-09-16.
Ver detalle y evidencia en el ledger. Auth/Floor/WebSocket y la aceptación completa de UX Round 2 pasaron el retest manual confirmado por el usuario.

## UX Round 2 — aceptación manual aprobada

El usuario confirmó PASS en POS, Cobro, descarte de venta vacía, Admin Local, Waiter, KDS,
Super Admin, continuidad, responsive y uso real. El checklist siguiente se conserva como referencia.

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

### Corrección focal Waiter/Super Admin y recursos Edge — historial 2026-09-16

#### Auditoría focal posterior: recursos Edge

Mediciones individuales, sin cambiar tests ni límites: RecoveryLifecycle línea 107 **846 ms**,
línea 140 **977 ms**, PersonnelSecurityOperation línea 67 **1626 ms** (frente a 5577/5216/5215 ms
en global y límite original de 5000 ms).

- Restore 107 espera preparar nuevamente el journal, conservar staging tras fallo post-persistencia
  y completar restore real. Restore 140 espera dos rechazos ante staging ausente, recuperación
  posterior y restart idempotente. Ambos ejecutan todas las migrations SQLite, backup consistente,
  cifrado/hash, verificación de archivos, rename y Floor durable con fsync/locking.
- Personnel 67 prepara schema 14→15, snapshot y baseline, hashes scrypt de PIN/Device, login y
  veinte autorizaciones coordinadas sobre el mismo Floor; después un escritor independiente
  cambia epoch y se comprueba invalidación y nueva decodificación. La cola/lock dentro del caso
  es intencional y permanece intacta.
- Cada fixture usa mkdtemp y binding propios: sin ruta operacional compartida ni evidencia de
  contención por el mismo directorio. No DPAPI, spawn, polling de aplicación o sleeps en estos casos.
  Cleanup cierra SQLite/restaura mocks/borra únicamente el fixture. El reloj de Vitest sí depende
  del scheduling del host; no se atribuye el fallo a una fase interna exacta no instrumentada ni
  se afirma haber medido CPU starvation a nivel kernel.

Clasificación de vecinos (A = conservar paralelo; B = aislamiento sustentado; C/D = bug demostrado):

| Familia | Clase / evidencia |
| --- | --- |
| RecoveryLifecycle / PersonnelSecurityOperation | B: tres timeouts medidos + cadena real filesystem/SQLite/Floor/hash; archivos completos al nuevo Edge test:resources |
| UpgradeAcceptanceLab, ProductionRecoveryUpgrade, RecoverySecurityConcurrency, RecoverySecurityStore, EdgeSecretStore | B existente: DPAPI/procesos/concurrencia real; siguen completos en test:host |
| PersonnelSecurityModel, BackupManager, RealtimeHub, Catalog/order mappers | A: lógica pura/mocks o filesystem mínimo; sin fallo de recursos demostrado |
| BackupArtifact, StartupRecoveryGuard, RecoveryRequiredApp | A con E/S acotada: archivos completos 778/485/912 ms en la corrida problemática; no basta usar SQLite para aislarlos |
| RecoveryCoordinator | A: Floor en memoria y SQLite propio, 4 casos / 2924 ms globales; sin timeout |
| LicensingSecurity | A vigilado: Floor durable/restore similar, pero 17 casos / 16335 ms globales sin timeout; no se aísla preventivamente |
| ProductionAdministrationUpgrade / EdgeLicenseManager | A vigilado: migrations/hash/backup o seed real, 5/11 casos sin timeout global; no confundir duración del archivo con la de cada caso |
| Integración HTTP y permisos restantes | A: fixtures propios, sin nuevos fallos acreditados; conservan concurrencia |

No se identificó C (race de test) ni D (regresión productiva) en los tres casos inspeccionados.
Política mantenible: aislar archivos completos con sensibilidad medida, conservar pruebas de carreras
internas reales y reevaluar vecinos con evidencia, no aislar por importación de SQLite ni serializar Edge.
La partición de Edge ahora es normal / recursos / host, exhaustiva y exclusiva; los tres son obligatorios.

Diagnóstico separado:

- Waiter: `findByRole('button', { name: /Mesa terraza/ })` espera la restauración de sesión,
  el efecto de usuario y `getTables()` antes del primer clic. Identidad y API son mocks async
  preparados antes de render; no depende de user-event previo, fake timers, polling de 5 s,
  portal, ResizeObserver o fixtures de otra prueba. Cleanup desmonta efectos y limpia globals/storage.
- Super Admin: `findByRole` espera el nombre accesible compuesto tras `getSession()`,
  `getLocations()` y `getTenants() → getCanonicalLocations() → Promise.all`. El singleton client
  apunta al mismo objeto de mocks restablecido en beforeEach; cleanup desmonta la UI. No hay
  red real, cache externa, navegación previa, portal ni timer de aplicación necesario para el dato.
- Ambos usan correctamente la espera async; la evidencia global/aislada apunta a sensibilidad
  de React/jsdom/query a carga concurrente, sin demostrar una race de fixtures ni regresión de producto.
  No se afirma haber medido CPU starvation a nivel del sistema operativo.

Corrección solo de tooling: archivos completos excluidos del bloque normal e incluidos exactamente
una vez en recursos Waiter y Super Admin (maxWorkers=1, fileParallelism=false, passWithNoTests=false).
`pnpm test:ui-resources` encadena ambos con `&&` y es obligatorio después de los grupos existentes
en `pnpm test`. El resto del monorepo sigue paralelo. Los controles comprueban archivos existentes,
partición exclusiva/exhaustiva, ausencia de filtros/timeouts añadidos y cadena canónica fail-fast.

Validación focal: partición 7/7; Waiter 22/22; Super Admin 3/3. Convivencia de sus bloques normales
8/8 y 24/24, seguida del grupo combinado 22+3: PASS. Sin modificar assertions ni producto.

**Única corrida global posterior: FAIL (exit 1)**, 31/32 tareas Turbo, 28 cached.
710 pruebas Turbo PASS, 3 FAIL, 31 skips PostgreSQL preexistentes; controles previos 7/7 PASS.
Waiter normal 8/8, Super Admin normal 24/24 y POS normal 92/92 PASS. Edge: 201 PASS / 3 FAIL.
Nuevos fallos, todos `Test timed out in 5000ms`:

- `RecoveryLifecycle.test.ts:107`: `preserves staging when scheduling fails after the journal was durably saved` (5577 ms).
- `RecoveryLifecycle.test.ts:140`: `never reports completion on retry when verified staging disappears before swap` (5216 ms).
- `PersonnelSecurityOperation.test.ts:67`: `reuses only byte-identical validated durable state and re-decodes an independent writer` (5215 ms).

El fail-fast impidió ejecutar los grupos posteriores de esta corrida, incluido UI resources;
su PASS focal no se presenta como PASS global. Sin nuevos skips en código. No se ampliaron
aislamientos a Edge ni se repitieron esos escenarios fuera del alcance autorizado. La causa de
estos tres timeouts requiere diagnóstico propio. Typecheck/build/PostgreSQL/DPAPI de la misma
ronda conservan su aprobación previa y no se repitieron por separado. `git diff --check` PASS.
**Estado histórico antes del ajuste Edge: 1X OPEN — MANUAL ACCEPTANCE PASS — CLOSURE BLOCKED.**

### Intento anterior de cierre técnico — evidencia histórica

`pnpm test` se ejecutó una sola vez y terminó con exit 1: Turbo informó 28/32 tareas exitosas.
Dos pruebas fallaron esperando botones durante la carga inicial:

- `waiterNavigation.test.tsx`: `keeps the real multi-table context across views without creating another order`, buscando `Mesa terraza`.
- `round2UX.test.tsx`: `shows canonical names and distinguishes unprocessed projections from zero activity`, buscando `Sucursal Centro / Restaurante Norte`.

Repetidas únicamente esas dos pruebas, sin modificar código ni timeouts: PASS (483 ms y 622 ms).
La evidencia es compatible con contención/sensibilidad temporal: en global los archivos tardaron
100.87 s y 103.64 s; aislados, las ejecuciones focales tardaron 5.46 s y 7.55 s.
No demuestra una regresión de producto, pero tampoco certifica reproducibilidad del gate global.
En ese intento no se repitió la suite global ni se convirtió su FAIL en PASS; 1X permaneció OPEN, sin commit/push.

Gates restantes ejecutados una sola vez:

- `pnpm typecheck`: PASS, 21/21 tareas (10 cached).
- `pnpm build`: PASS, 20/20 tareas (12 cached).
- Windows/DPAPI obligatorio: 56/56 PASS, sin skips. Se ejecutó directamente porque el `&&` del comando global no llegó a este grupo.
- Database resources: 39/39 PASS; POS resources/Admin: 25/25 PASS, ambos ejecutados directamente por la misma razón.
- PostgreSQL 18.6 real en contenedor temporal exclusivo de cierre: Database 18/18, Cloud API 1/1, Cloud Worker 12/12; total 31/31 PASS sin skips. No se utilizó la DB del laboratorio manual.
- `git diff --check`: PASS. Migraciones históricas intactas; ninguna migration nueva. Sin artifacts DB/WAL/SHM, backups, perfiles, logs o Floor runtime entre los archivos propuestos; sin secretos reales detectados (literales de fixtures separados de credenciales reales).
- Sin skips nuevos en código. Los 31 skips PostgreSQL del flujo sin URL quedan cubiertos por la ejecución real. Los 23 casos no seleccionados de los dos reruns diagnósticos no son nuevas exclusiones del gate.

La corrida global reportó 28/32 tareas exitosas (22 cached), dos tareas fallidas (Waiter/Super Admin)
y dos sin resultado completo (Edge/POS) al abortar Turbo. No existe un total global final certificado.
Los resultados aislados no sustituyen esa certificación. La revisión confirma X-A–X-I y Round 2
implementados, coordinación Auth/Floor/WS y clasificación temporal/inválida presentes, sin Grupo B
ni cambios de migraciones; no autoriza declarar 1X CLOSED mientras el gate global esté fallido.

La evidencia histórica inferior se conserva; no representa el estado actual del blocker Auth/Floor/WebSocket.
Usar el laboratorio aislado y perfil autorizado existentes, sin mezclar identidades ni DB/Floor.

1. POS: verificar items compactos y Enviar/Precuenta/Cobrar accesibles; revisar notas, modificadores, importes y estados. Abrir Cobro después de agregar/enviar: sin success anterior duplicado.
2. Cobro: revisar total, pagado, saldo, recibido, propina y cambio; confirmación accesible sin ocultar datos. Cerrar conserva la venta sin crear un pago.
3. Descartar solo una venta vacía: queda estado neutral, sin abrir selector ni elegir otra venta. No se habilita cancelación de ventas con productos.
4. Admin: guardar perfil accesible, navegar por teclado hasta Copias y recuperación; scroll sin paneles competidores. Guardar un apartado preserva borradores de otro; warnings/OCC siguen vigentes.
5. Waiter: alternar mesas y vistas conservando contexto; Actualizar sin recorte. Producto sin modificadores se agrega directamente y ofrece Agregar nota; producto con modificadores conserva configuración. Success breve, errores persistentes.
6. KDS: verificar los tres carriles, lectura completa de notas/items y desplazamiento hasta el último listo por teclado; transiciones sin cambios y sin overflow horizontal en mínimo soportado.
7. Super Admin: instalaciones primero, creación opt-in, navegación Tenant/Location y secciones; nombres antes de UUID, detalles técnicos disponibles. Nunca procesado no aparenta actividad cero; autorización inicial consumida no puede repetirse desde UI.

### Evidencia técnica y browser smoke Round 2

| Superficie | Viewports reales revisados | Resultado |
| --- | --- | --- |
| POS y Cobro | 1280×720, 1366×768, 768×1024 | Acciones accesibles y composición compacta |
| Admin Local | 1366×768, 768×1024 | Guardar visible; scroll y navegación accesibles |
| Waiter | 390×844, 360×800 | Contexto/navegación móvil y Actualizar sin recorte |
| KDS | 1920×1080, 1366×768, 1024×640 | Sin overflow horizontal; listos completos en carril desplazable |
| Super Admin | 1366×768, 1920×1080 | Jerarquía, formularios opt-in y acciones aplicables |

Pruebas focales: **120/120 PASS** (POS/hardening 30, Admin 25, Waiter 22, KDS 18, Super Admin 25).
El nuevo test KDS tuvo un fallo de lectura de CSS por URL transformada en jsdom; se corrigió únicamente esa lectura y KDS terminó 18/18.
Typecheck/build focal de POS, Waiter, KDS y Super Admin: PASS. No suites globales en esta ronda.
Computer Use/browser smoke no equivale a aceptación manual del usuario ni certificación física completa de accesibilidad.

Diferidos: **GROUP_B_CATALOG** (productos/categorías/commercial catalog/configuración por producto/CSV-XLSX),
**GROUP_C** (cancelar DRAFT con productos) y gestos touch **NICE_TO_HAVE**. No son blockers de esta ronda.

## Fix Round 1 — evidencia histórica y checklist de regresión

Evidencia del laboratorio: `req-1cy`, GET `/orders/open-counter`, devolvió 401
`PERSONNEL_SECURITY_UNAVAILABLE` durante la invalidación temporal del snapshot del Floor.
ENROLL devolvió 409 `PERSONNEL_COMMAND_FIELDS_INVALID`: la UI enviaba `status`, no admitido.
Además, una petición administrativa pre-ACK podía repoblar una caché ya invalidada.

- Auth HTTP lee y valida bajo el lock del Floor; no usa fallback stale ni repite comandos.
  Orden: cola por ruta canónica → lock interproceso → lectura/validación Floor → comprobaciones
  síncronas Auth/SQLite → liberación. PIN hashing ocurre fuera; no se espera otra operación de
  Floor ni se ejecuta el comando HTTP dentro del callback. El reloj se consulta tras la espera.
- Repetir apertura de caja → crear venta → Dispositivos/Respaldo sin recargar ni segundo intento.
- Crear personal válido: un envío, PIN enmascarado y borrado tras ACK; sin `status` en ENROLL.
- Guardar día → guardar moneda/operación dependiente usa la revisión consultada tras ACK.
  Conservar borradores de otros apartados y advertencia OCC hasta revisión explícita.
- Verificar un solo bloque OCC con la intención conservada; sin success contradictorio.
  Revertir un campo al valor inicial elimina dirty; refresh aparece solo cuando hace falta.
- Revisar header en desktop/tablet: caja/conexión visibles, detalles desplegables y acciones
  accesibles; readiness prioriza pendientes y agrupa lo verificado; preparación recomienda
  el siguiente paso sin impedir navegación libre.

Las pruebas focales y la revisión independiente de seguridad no sustituyen este retest manual.
No ejecutar aceptación sobre otra instalación ni mezclar DB/Floor/perfil de navegador.

Validación focal de Fix Round 1 (sin suites globales):

- Personnel Security: 18/18; permisos independientes: 1/1; Licensing Security: 17/17.
- Auth HTTP/RBAC: 7/7, incluyendo caja → consulta/venta y Devices/readiness/backup.
- Locking interproceso: 11/11; Security Store/DPAPI: 4/4.
- Administración: 25/25; POS operativo: 14/14; Devices: 13/13; hardening: 10/10.
- Guidance: 14/14. Typecheck focal Edge/POS/UI y builds focales Edge/POS/UI: PASS.
- Una prueba reprodujo la expiración de sesión durante la espera del lock; tras corregir
  la toma del reloj, el mismo escenario rechaza la sesión expirada. No se aumentaron timeouts.
- Si falla la consulta post-ACK, el guardado permanece confirmado y no se reenvía; se impide
  otra escritura administrativa hasta consultar el estado vigente.

La carrera se controla en pruebas mediante el encoder del File Store real y transiciones
registradas; DPAPI conserva su prueba Windows. La disposición visual desktop/tablet y la
latencia percibida con el laboratorio real quedaron para retest del operador en esa ronda.
La aceptación manual final posterior está aprobada arriba; no se atribuye ese PASS a los tests focales.

## Seguridad y preparación

### Blocker runtime WS/Auth — evidencia histórica (retest posteriormente aprobado)

**Estado histórico: Manual Acceptance FAIL / BLOCKED antes del retest aprobado.** El PID 1636 del laboratorio
`phase-1w-1x-final-20260914` había arrancado a las 20:11:58 del 2026-09-14,
antes del fix HTTP. Sus stacks correspondían a la ruta síncrona antigua; no son
evidencia del código corregido. El harness arranca `src/index.ts` mediante tsx:
compilar no sustituye el código ya cargado en ese proceso.

HTTP y WS usan el mismo Floor: cola por ruta canónica → lock interproceso → lectura
durable validada → Auth/SQLite síncrono → enqueue no bloqueante del evento → liberar.
El hub no mantiene un lock propio ni espera dentro de una transacción SQLite. Los escritores
Personnel y Licensing conservan su protocolo y el mismo lock. No hay reentrada al Floor.
WS no toca lastActivity/expiresAt. La caché bajo lock se reutiliza solamente si los bytes
actuales coinciden con los ya autenticados; un escritor externo obliga a validar de nuevo.

Handshake, revalidación periódica y entrega usan autorización asíncrona. Hay como máximo
64 eventos por suscriptor, control de buffer de socket (256 KiB) y plazo de drenaje de
5 segundos, sin aumentar el plazo previo de autenticación. Un límite excedido o indisponibilidad
cierra con 1013 y conserva credenciales; el reconnect existente consulta estado autoritativo.
INVALID cierra con 1008. Nunca se entrega después de cerrar ni antes de validar. Los eventos
mantienen orden por conexión y aislamiento por Location; no cambia el contrato de dominio.

`PERSONNEL_SECURITY_UNAVAILABLE` representa una validación temporal no disponible (503);
Floor ausente/corrupto/incompatible conduce a recuperación, no a autorización. Revocación,
revisiones inválidas y restricciones de personal conservan rechazo. POS/KDS clasifican por
código, no por cualquier 401; una respuesta temporal no borra la sesión ni el Device.

Validación focal WS/Auth: 123 tests PASS (Personnel 20, Auth/RBAC/WS 7, Licensing 17,
Hub 5, concurrencia interproceso 11, Store/DPAPI 4, POS 18, KDS 17, clasificación SDK 10,
guidance 14). Los tests de reconexión POS/KDS distinguen 1013/1008, vuelven a consultar
estado sin login manual y no repiten comandos. Typecheck Edge/POS/KDS/SDK/UI y builds
focales Edge/POS/KDS/SDK/UI: PASS. Sin suites globales. La concurrencia con el File Store
real, la entrega ordenada y las interacciones DOM se comprueban por capas; no se declara
ejecutado el recorrido combinado prolongado sobre el laboratorio del operador.

Reinicio controlado, en una PowerShell desde `C:\Proyects\comanview`:

```powershell
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Stop -LabName phase-1w-1x-final-20260914
$env:COMANVIEW_SECURITY_TRACE = 'true'
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Start -LabName phase-1w-1x-final-20260914
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Status -LabName phase-1w-1x-final-20260914
$runtimeLog = Join-Path $env:LOCALAPPDATA 'ComanView\ManualAcceptance\phase-1w\phase-1w-1x-final-20260914\logs\edge.log'
$runtime = Get-Content -LiteralPath $runtimeLog | ForEach-Object {
  try { $_ | ConvertFrom-Json -ErrorAction Stop } catch {}
} | Where-Object { $_.msg -eq 'AUTH_RUNTIME_READY' } | Select-Object -Last 1
$runtime | Select-Object runtimeMarker,pid,startedAt
Get-Process -Id $runtime.pid | Select-Object Id,StartTime
```

Exigir marcador `1X-WS-AUTH-BARRIER-1`, PID vigente y hora del nuevo arranque.
Si Start falla, detenerse; no Create/Destroy/Prepare/restore ni cambiar rutas.
La traza es opt-in e incluye eventos de espera/adquisición/liberación del lock,
revisiones numéricas, requestId y IDs de sesión/usuario/Device, nunca tokens, PINs,
hashes, Recovery Key ni contenido del Floor. No compartir logs completos.

Reutilizar el navegador aislado del mismo lab. Durante 5–10 minutos, sin recargar:
alternar estaciones KDS, preparar/marcar varias rondas como Listo, crear ventas POS,
agregar/quitar borradores y abrir Restaurante/Dispositivos. Verificar que Licensing sigue
activo, no hay logout/1008 espurio, y revocar un Device de prueba sí bloquea sus sesiones.
Las pruebas focales no certifican aún ese recorrido prolongado de operador real.
Al terminar el diagnóstico, Stop, quitar `COMANVIEW_SECURITY_TRACE` de la terminal y Start
desactiva la traza sin cambiar ni eliminar datos del lab.

Usar exclusivamente un laboratorio aislado del harness `scripts/Phase1W-AcceptanceLab.ps1`,
con nombre propio, identidad, SQLite, Security Floor y perfil de navegador coherentes.
No mezclar archivos con instalaciones anteriores. No ejecutar preparación, restore ni SQL
sobre una instalación operacional. Reutilizar un laboratorio solo tras verificar su identidad.
El operador realiza la aceptación; los tests DOM y la revisión de CSS no la sustituyen.
No incluir PIN, credenciales, códigos de alta, autorizaciones firmadas ni claves de recuperación
en capturas o en la evidencia compartida. Las acciones críticas se prueban solo con datos del lab.

## Matriz de pantallas

| Superficie | Viewport a comprobar | Resultado esperado |
| --- | --- | --- |
| POS | 1280×800 y 768×1024 | Venta y acciones accesibles; categorías desplazables; sin importes cortados |
| Admin Local | 1280×800 y 768×1024 | Navegación y formulario accesibles; diálogo desplazable y acciones alcanzables |
| Waiter | 360×800, 390×844, 480×800; tablet 768×1024 | Una tarea por vista; navegación inferior no tapa acciones; no depende de hover |
| KDS | 1024×640 y 1280×800 | Tres columnas, contexto y urgencia textual, acciones de preparación accesibles |
| KDS reducido | 900×600 | Aviso de vista limitada y desplazamiento; no se promete layout móvil |
| Super Admin | 1280×800 y ventana 900×700 | Formularios y confirmaciones alcanzables; detalles técnicos plegados |

X-I revisa breakpoints, overflow, targets y pruebas DOM. Esta matriz requiere además la
comprobación visual del operador; no representa certificación WCAG ni de dispositivos físicos.

## Checklist manual de referencia

La aceptación final fue aprobada por el usuario. Se conserva el checklist para futuras regresiones;
no es una nueva lista pendiente ni añade evidencia individual no reportada por el operador.

- **Configuración incompleta:** abrir Restaurante en instalación válida sin completar;
  distinguir estado pendiente, permiso ausente y servicio no disponible.
- **Prerequisitos:** intentar una acción sin moneda/impuesto requerido; leer qué falta y
  usar el acceso guiado si el rol tiene permiso. Volver conserva el contexto.
- **Moneda / día:** configurar moneda inicial y jornada; confirmar persistencia. Tras
  actividad financiera, moneda bloqueada con explicación; no alterar historial para probarla.
- **Impuestos / caja:** configurar impuesto predeterminado y caja desde UI; verificar
  mensajes de precondición y no confundir bloqueo con fallo de conexión.
- **Borradores:** editar negocio y otra sección; guardar una conserva el borrador de la
  otra. Cerrar/navegar a otro panel advierte y permite cancelar sin pérdida.
- **OCC:** dos sesiones autorizadas editan el mismo recurso; conservar intención y requerir
  consultar/revisar la base vigente. Nunca repetir el comando silenciosamente.
- **Estaciones:** seleccionar función sugerida o personalizada; label/helper claros,
  sin exigir conocer el enum ni restringir vocabulario previamente válido.
- **POS:** abrir venta, agregar/configurar productos, enviar y cobrar; Sin enviar/Enviado
  distinguibles. Total, pagado, saldo y propina separados, sin reinterpretación fiscal.
- **Admin/Devices:** ida y vuelta mantiene venta/mesa/selección y devuelve foco.
- **Impresión degradada:** una impresión no confirmada muestra advertencia; no declara
  fallida una venta/ronda ya confirmada ni duplica la solicitud por una consulta fallida.
- **Waiter móvil:** Mesas → Productos → Pedido → Atrás conserva zona/categoría/pedido;
  navegar no crea ni cancela pedidos. Acciones prioritarias alcanzables con touch.
- **Reconexión:** distinguir falta de conexión local de avisos en vivo reconectando;
  recuperar estado vigente sin enviar comandos automáticamente. OCC conserva intención segura.
- **KDS:** seleccionar estación; revisar urgencia textual y ejecutar preparar/listo;
  teclado mantiene foco tras cambio de columna. Estación desaparecida requiere nueva selección.
- **Super Admin:** cancelar una confirmación no opera; confirmar muestra entidad/impacto,
  bloquea doble envío y conserva inputs ante rechazo. Revisar propinas, revocación y reemplazo
  solo en entidades prescindibles. Autorizaciones: entrega explícita, vencimiento, sin documento
  renderizado; no compartir su contenido como evidencia.
- **Teclado/foco:** Tab/Shift+Tab quedan en el diálogo; Escape cancela cuando es seguro;
  contenido exterior bloqueado, foco visible/restaurado, labels y errores asociados.
- **Pantallas:** completar la matriz anterior; no hay controles inaccesibles, texto
  superpuesto ni estados comunicados únicamente por color.
- **Restart:** detener/reiniciar el mismo lab con su harness; configuración persiste y
  se consulta el estado vigente. No esperar persistencia de borradores locales tras cerrar navegador.

## Deuda y límites

- La experiencia comercial completa de Catálogo y CSV/XLSX pertenece a Commercial Catalog;
  no se declara implementada por 1X.
- Configuración de impresoras, Grupo B y funcionalidades nuevas quedan fuera de alcance.
- KDS no recibe nombre/número de mesa en su contrato actual: no se inventa ese dato.
- Ampliaciones futuras del dashboard de Super Admin y pulido estético fuera de los recorridos
  críticos quedan como follow-up, no como ampliación tardía de X-I.
- Cloud object backup y certificación física de copia externa siguen diferidos desde 1V.
- La clave de recuperación exportada conserva el flujo seguro explícito de 1V; no es un PIN
  ni una credencial humana para iniciar sesión.
