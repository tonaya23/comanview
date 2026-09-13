# Aceptación manual — Fase 1W

Manual acceptance: **PASS**. Fase 1W: **CLOSED**.

La aceptación manual se completó en el laboratorio aislado `phase-1w-final-acceptance`. Los defectos
funcionales encontrados durante el recorrido fueron corregidos y revalidados; no quedaron blockers
operativos conocidos. La validación técnica global y PostgreSQL también quedaron aprobados antes del
cierre. Esta aceptación no necesita repetirse para el cierre actual.

Las observaciones transversales de UX/IA no bloquean 1W y quedan como follow-up futuro: mensajes de
rechazo demasiado genéricos, dependencias administrativas poco guiadas, campos que exponen conceptos
técnicos (por ejemplo Station Purpose) y una carga cognitiva excesiva en partes de Admin Local. La
experiencia comercial completa de administración de catálogo y la importación CSV/XLSX no forman parte
de 1W; permanecen en el Grupo B del roadmap. Registrar esta deuda no inicia 1X ni el Grupo B.

Los pasos siguientes se conservan como procedimiento reproducible y evidencia del alcance aceptado.
Use exclusivamente una instalación/laboratorio autorizado, con backup verificable antes de comenzar.

## 0. Laboratorio aislado obligatorio

Este procedimiento no usa `restaurant-acceptance`, los laboratorios 1U/1V ni identidades previas. Requiere
Windows, Node 24, pnpm 9, Docker Desktop operativo y Google Chrome. Todos los artefactos quedan bajo
`%LOCALAPPDATA%\ComanView\ManualAcceptance\phase-1w\phase-1w-manual`; el archivo de configuración,
Edge Secret Store y Security Floor están protegidos con DPAPI del usuario actual.

### Preparación del harness (no es aceptación manual)

Con los puertos 3000, 4000 y 5173–5176 libres, abrir una sola PowerShell:

```powershell
Set-Location C:\Proyects\comanview
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Create
```

`Create` compila solo los workspaces necesarios, crea PostgreSQL 18 aislado, Tenant/Location/licencia propios,
una DB Edge vacía en schema 14, provisioning real, Edge Secret Store y Security Floor coherentes. No crea
Orders, Payments, CashSessions, CashMovements, usuarios, Devices ni configuración comercial. Debe terminar con
`LAB_READY = true`, `SCHEMA = 14`, `BINDING_CONSISTENT = true`, `SECURITY_FLOOR_PRESENT = true` y
`FINANCIAL_ACTIVITY_ROWS = 0`.

Arrancar Cloud, Edge por el entry point normal, POS, Waiter, KDS y Super Admin, todos en segundo plano:

```powershell
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Start
```

Debe informar `SCHEMA = 15`, binding/floor válidos y `RUNNING = true`. El primer `Start` ejecuta la migración
productiva 0014→0015 y el Personnel Security baseline; un segundo `Start` posterior no los repite.

Abrir Chrome con un perfil completamente separado (cerrar esa ventana antes de `Destroy`):

```powershell
$labBrowser = Join-Path $env:LOCALAPPDATA 'ComanView\ManualAcceptance\phase-1w\phase-1w-manual\browser-profile'
Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" -ArgumentList "--user-data-dir=$labBrowser",'http://127.0.0.1:5173'
```

URLs del laboratorio:

- POS/Admin Local: `http://127.0.0.1:5173`
- Waiter: `http://127.0.0.1:5175`
- KDS: `http://127.0.0.1:5174`
- Super Admin: `http://127.0.0.1:5176`

### Pairing y OWNER por flujos reales

El bootstrap firmado inicial materializa los grants de `BASE_ROLE_PERMISSIONS` dentro de la
transacción de enrollment, bajo el lock del Security Floor, antes de crear OWNER. Requiere estado
PENDING sin evidencia de bootstrap previo, usuarios ni historia Personnel y epoch 0. No se ejecuta
en restart/restore ni completa permisos de instalaciones establecidas. Los permisos efectivos siguen
siendo grants persistidos intersectados con la allowlist canónica. Las migrations históricas no cambian.
Create/Start anteriores al pairing solo preparan infraestructura: aún no existe OWNER. `VerifyOwner`
es obligatorio al completar pairing; Start también valida OWNER cuando bootstrap ya está COMPLETED.
Un laboratorio que ya completó bootstrap con grants incompletos debe preservarse y sustituirse por
otro laboratorio nuevo con `-LabName` propio, sin editar su DB. Usar ese nombre también en el perfil Chrome.

1. En POS, escribir un nombre nuevo para el dispositivo, solicitar pairing y usar **Copiar datos de autorización**.
   El bloque copiado omite credential, request token y PIN.
2. Obtener el email no secreto mediante `-Action Status`. Copiar la contraseña Cloud al portapapeles sin
   imprimirla y usarla para iniciar sesión en Super Admin:

   ```powershell
   .\scripts\Phase1W-AcceptanceLab.ps1 -Action CopyCloudPassword
   ```

3. En Super Admin abrir el Location del laboratorio, pegar los datos de pairing, emitir la autorización de
   instalación y copiar la autorización resultante.
4. Volver a POS, pegarla, elegir localmente el PIN inicial OWNER y completar la instalación. Ni PIN ni
   autorización se guardan en el harness.
5. Iniciar sesión con ese OWNER. Antes de configurar el negocio, ejecutar `-Action VerifyOwner`
   con el mismo `-LabName` usado para Create/Start. Debe informar `OWNER_BASELINE_VALID = true`,
   `OWNER_ADMINISTRATION_VIEW = true` y `OWNER_CATALOG_VIEW = true`. Esta inspección read-only
   comprueba OWNER contractual ACTIVE y grants canónicos completos; no inserta permisos ni prueba HTTP.
   Confirmar después por UI que Catálogo y Restaurante abren sin 403.
   La configuración comercial comienza aquí y debe hacerse por UI/API real.
   Tras fijar moneda y crear un TaxProfile, **Administración → Impuestos → Producto mínimo para aceptación**
   permite crear el producto de prueba usando la revisión fiscal real seleccionada.

Cloud puede apagarse después de completar bootstrap y recibir una licencia firmada, para validar operación LAN:

```powershell
.\scripts\Phase1W-AcceptanceLab.ps1 -Action CloudOff
```

### Parada, reinicio y destrucción

```powershell
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Stop
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Start
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Status
```

`Stop` espera el periodo seguro del lock del Security Floor. El reinicio debe conservar schema 15, binding,
Floor, OWNER, Device y configuración. Al finalizar toda la aceptación, cerrar Chrome y destruir exclusivamente
el laboratorio nombrado:

```powershell
.\scripts\Phase1W-AcceptanceLab.ps1 -Action Destroy
```

`Destroy` elimina el contenedor y el directorio exacto `phase-1w-manual`; rechaza rutas externas y nombres de
labs 1U/1V. No ejecutar `dev:prepare`, restore ni scripts de fases anteriores durante esta aceptación.

## 1. Preparación

- Confirmar Edge schema 15, `/health` UP y DB OK; Sync puede permanecer deshabilitado.
- Iniciar sesión en POS con un OWNER y Device válidos. Abrir **Administración → Restaurante**.
- Registrar timezone, moneda y estado de readiness iniciales. No usar SQL, Postman ni scripts para
  realizar las operaciones de esta checklist.

## 2. Negocio, jornada y moneda

1. Guardar nombre comercial, dirección/horarios y un logo PNG/JPEG válido; reiniciar POS/Edge y
   confirmar persistencia. Verificar que el perfil público omite razón social, teléfono y email.
2. Guardar timezone IANA y rollover. Confirmar que una Order/CashSession nueva recibe el
   `business_date` calculado por Edge, incluso si el navegador envía/representa otra fecha.
3. Con Order o CashSession OPEN, comprobar que cambiar timezone/rollover se rechaza. Cerrarlas y
   confirmar que el cambio aplica solo a operaciones nuevas.
4. En laboratorio sin actividad financiera, establecer moneda coherente. Crear actividad monetaria y
   confirmar que la moneda queda bloqueada sin conversión ni reetiquetado silencioso.

## 3. Impuestos y snapshots

1. Crear perfiles zero, TAX_ADDED y TAX_INCLUDED, revisar una tasa/modo, elegir default y asignar un
   producto. Confirmar totales por línea HALF_UP y que el perfil inactivo no admite uso nuevo.
2. Crear Item DRAFT con tasa 16%; cambiar el TaxProfile a 8% sin editar el Item y confirmar snapshot
   16%. Ejecutar una edición explícita del DRAFT y confirmar snapshot/cálculo 8%.
3. Enviar otro Item con 16%, cambiar configuración e intentar editarlo: SENT e historia cerrada deben
   conservar el snapshot original; no convertir automáticamente policy legacy.

## 4. Personal y permisos

1. Crear CASHIER/WAITER/KITCHEN con PINs únicos; renombrar, cambiar roles, cambiar/resetear PIN,
   invalidar sesiones y desactivar. PIN antiguo y sesiones anteriores deben fallar.
2. Reactivar con PIN nuevo. Confirmar límites MANAGER, protección del último/OWNER contractual y que
   un usuario no puede desactivarse a sí mismo.
3. Confirmar que cada sección/acción respeta RBAC y que Audit/Event no contienen PIN, hash ni token.

## 5. Caja, estaciones, zonas y mesas

1. Crear/editar cajas, elegir exactamente una predeterminada y abrir CashSession: debe usar ese ID.
   Con sesión OPEN, cambio de default/desactivación debe rechazarse. No debe existir borrado físico.
2. Crear/editar/reordenar Station, cambiar visibilidad KDS y asignar Product. Con trabajo SENT activo,
   una desactivación incompatible debe rechazarse; los destinos históricos no cambian.
3. Crear/editar/reordenar Zone/Table y mover una mesa libre. Con Order activa, movimiento o
   desactivación incompatible debe rechazarse. La regla de una Order activa por Table se conserva.

## 6. Propinas, offline y concurrencia

1. Verificar por separado policy Cloud firmada, preferencia local y resultado efectivo. OWNER solo
   puede elegir porcentajes/fija permitidos; configuración legacy sin delegación se conserva.
2. Desconectar Internet, reiniciar Edge y confirmar que la última policy válida y toda configuración
   local permiten operar por LAN. Cloud stale no debe sobrescribir Edge.
3. Abrir dos vistas de Administración, guardar en una y luego en la otra: la segunda debe recibir un
   conflicto OCC, recargar y no perder silenciosamente el primer cambio.

## 7. Restore, hardware replacement y upgrade

1. En laboratorio de recovery, cambiar PIN/roles/estado después del backup y restaurar el backup
   anterior. PIN, privilegios y sesiones antiguos no deben revivir; usuarios divergentes quedan
   bloqueados selectivamente y el OWNER puede revalidarlos con una decisión nueva.
2. En hardware replacement, confirmar Devices revocados, nuevo trust domain y personal no confiable.
   Una autorización Cloud inválida/expirada/reutilizada o con binding incorrecto falla; la válida
   recupera solo al OWNER contractual exacto y exige login normal con PIN nuevo.
3. Actualizar una copia real schema 14: debe crearse snapshot, aplicar 0015, derivar baseline sin
   inventar defaults y arrancar NORMAL. Reinicio/segundo intento debe ser idempotente; DB missing,
   corrupta, downgrade o transición parcial deben fallar cerrado.

## 8. Readiness y cierre de evidencia — PASS

- Completar perfil, jornada, moneda, OWNER confiable, caja default, impuesto/default/asignaciones y
  Personnel Security. Confirmar componente ADMINISTRATION/PERSONNEL_SECURITY listo.
- Confirmar que logo/dirección/horarios opcionales no bloquean y que
  `BACKUP_PROTECTION_INCOMPLETE` todavía impide Production READY.
- Reiniciar Edge y POS, verificar persistencia, Audit/Event y ausencia de secretos. La ejecución de
  cierre completó este recorrido sin blockers operativos conocidos.

## 9. Functional hardening previo al cierre — PASS

Esta sección valida las correcciones focales de 1W; no inicia el rediseño 1X.
Las correcciones fueron incluidas en la aceptación manual final aprobada.

1. Personal: cambiar PIN, reactivar y revalidar usuarios usando campos enmascarados
   de 4–12 dígitos. El PIN no aparece en mensajes ni permanece tras guardar/cancelar
   el diálogo. Para cambiar el PIN propio se solicita el PIN actual. Comprobar que
   las sesiones anteriores y la credencial anterior dejan de servir según las reglas
   de Personnel Security. No copiar PINs a la evidencia.
2. Borradores: editar Perfil sin guardar; navegar a otra sección y guardar una operación.
   Volver a Perfil: el borrador debe conservarse. Repetir entre Jornada y Moneda.
   Salir con cambios pendientes debe advertir. Un reload autoritativo no debe elevar
   silenciosamente la versión OCC de un borrador pendiente; un conflicto no lo borra.
3. Ventas: abrir el selector y modificar una venta desde otra sesión autorizada.
   Seleccionarla debe consultar Edge y presentar su versión vigente, o informar que
   ya no está abierta. «Nueva» no debe abandonar otra venta vacía sin ofrecer recuperarla.
4. Descartar exige una venta COUNTER OPEN sin items, rondas ni pagos. Tras confirmar,
   la venta desaparece del selector y no se abre automáticamente otra venta. Si falla
   la actualización posterior, debe indicar que la cancelación sí se confirmó y permitir
   actualizar la lista. Una versión antigua o una venta no vacía debe rechazarse.
5. Permisos: una sesión con PERSONNEL_VIEW puede abrir Personal sin CATALOG_VIEW
   ni dependencia de los endpoints administrativos no autorizados. Una falla de una
   sección independiente no debe impedir usar las demás. Los endpoints protegidos
   siguen rechazando con 403 las operaciones sin el permiso correspondiente.

Estos escenarios quedaron aceptados sin repetir la aceptación general de 1V.
