# Aceptación manual — Fase 1V Backup y Recovery

Esta guía utiliza exclusivamente el laboratorio aislado:

`%LOCALAPPDATA%\ComanView\RecoveryAcceptance\phase-1v`

La DB `restaurant-acceptance` se abre solamente `readonly` para crear el snapshot inicial mediante
`better-sqlite3 Database.backup()`. No use `pnpm dev:local`: ese comando ejecuta preparación de desarrollo
y no es apropiado para este laboratorio.

## 1. Preparar el laboratorio

Detenga cualquier Edge en el puerto 3000. En **Terminal Preparación**:

```powershell
cd C:\Proyects\comanview
.\scripts\Phase1V-RecoveryLab.ps1 -Action Prepare -Environment restaurant-acceptance
```

Solo continúe si termina con:

```text
SOURCE_DB_EXISTS = true
RUNTIME_DB_EXISTS = true
SAME_PATH = false
SQLITE_INTEGRITY = OK
EDGE_SECRET_PRESENT = true
SECURITY_FLOOR_READY = true
LAB_READY = true
```

`Prepare` construye y valida un staging, migra solamente la copia aislada al schema 1V e inicializa su
Security Floor protegido con DPAPI antes de reemplazar un laboratorio anterior. Un error de `pnpm`,
snapshot, migration, Security Floor, settings, integridad o copia detiene el script; el laboratorio
incompleto se elimina y no queda disponible para `LoadEdge`.

## 2. Arrancar Edge aislado

En **Terminal Edge**:

```powershell
cd C:\Proyects\comanview
. .\scripts\Phase1V-RecoveryLab.ps1 -Action LoadEdge -Environment restaurant-acceptance
pnpm --filter @comanview/edge dev
```

Confirme en la salida:

```text
ISOLATED_RUNTIME = true
RUNTIME_DB = ...\RecoveryAcceptance\phase-1v\runtime\edge.db
SYNC_ENABLED = false
```

No continúe si `RUNTIME_DB` apunta a `C:\Proyects\comanview\apps\edge`.

## 3. Arrancar POS y Administración Local

En **Terminal POS**:

```powershell
cd C:\Proyects\comanview
pnpm --filter @comanview/pos dev -- --host 127.0.0.1
```

Abra:

- POS: <http://localhost:5173>
- Edge health: <http://127.0.0.1:3000/health>

Use el navegador/Device autorizado de `restaurant-acceptance`; no limpie su IndexedDB. Inicie sesión como
OWNER y abra **Menú → Administración Local → Dispositivos e instalación → Backup y recuperación**.

Estado esperado: Edge `UP`, database `OK`, recovery `NORMAL`. Deténgase si aparece `RECOVERY_REQUIRED` antes
de haber ejecutado una simulación.

## 4. Backup LOCAL

En Administración Local pulse **Crear backup ahora**. Espere `VERIFIED` en Backups recientes. El fallo de
un backup no debe cerrar ni bloquear POS.

## 5. Recovery Key

Pulse **Exportar Recovery Key una vez** y guárdela en una custodia segura fuera del equipo. No la pegue en
PowerShell, tickets, mensajes ni capturas. La UI debe cambiar Recovery Key a `READY`.

## 6. OFF_DEVICE

En Terminal Preparación copie una ruta aislada al portapapeles:

```powershell
$offDevice = Join-Path $env:LOCALAPPDATA 'ComanView\RecoveryAcceptance\phase-1v\off-device'
New-Item -ItemType Directory -Path $offDevice -Force | Out-Null
Set-Clipboard -Value $offDevice
```

Péguela en **Directorio off-device**, pulse **Configurar destino** y después **Crear backup externo**.
Mientras solo esté configurada la ruta, el destino se muestra `Pendiente`; cambia a `READY` después del
primer backup externo `VERIFIED`. Esto valida el destino filesystem, no certifica que sea otro disco físico.

## 7. Operación sin Cloud

El harness fija `COMANVIEW_SYNC_ENABLED=false`; no levante Cloud. Cree una Order de prueba, agregue un producto,
envíe Round y confirme que POS sigue operando. Cree otro backup LOCAL y confirme `VERIFIED`.

## 8. Restart

Detenga Edge con `Ctrl+C`. En la misma Terminal Edge:

```powershell
. .\scripts\Phase1V-RecoveryLab.ps1 -Action LoadEdge -Environment restaurant-acceptance
pnpm --filter @comanview/edge dev
```

Debe volver `UP/OK`, conservar historial, Recovery Key exportada y scheduling.

## 9. Backup post-Z

Desde POS abra caja, complete una venta sencilla y ejecute Corte Z. El Z debe concluir sin esperar al backup.
Después, en Administración Local, confirme un backup con trigger `POST_Z`. Si el backup fallara, el Z debe
permanecer cerrado.

## 10. Crear checkpoint para escenarios destructivos

Detenga Edge con `Ctrl+C`. En Terminal Preparación:

```powershell
cd C:\Proyects\comanview
.\scripts\Phase1V-RecoveryLab.ps1 -Action Checkpoint
```

Solo continúe con `CHECKPOINT_READY = true`.

Para volver a este estado entre escenarios, con Edge detenido:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action RestoreCheckpoint
```

Debe terminar nuevamente en `LAB_READY = true`.

## 11. Fallo OFF_DEVICE

Restaure checkpoint y arranque Edge normal. En Terminal Preparación determine una unidad no montada:

```powershell
$letter = @('Z','Y','X','W') | Where-Object { !(Test-Path "${_}:\") } | Select-Object -First 1
if (!$letter) { throw 'No hay una letra de unidad libre para esta prueba.' }
Set-Clipboard -Value "${letter}:\ComanView-1V-Unavailable"
```

Intente **Configurar destino** con esa ruta. La configuración debe fallar contextualmente indicando que el
destino externo no está disponible; no pulse **Crear backup externo**, porque al rechazarse la nueva ruta
ComanView conserva deliberadamente el último destino válido. Los backups `VERIFIED` anteriores deben permanecer
intactos y las ventas no deben bloquearse. Detenga Edge y restaure checkpoint.

## 12. DB missing

Con Edge detenido y checkpoint restaurado:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action SimulateMissing
```

Arranque el modo recovery en Terminal Edge:

```powershell
. .\scripts\Phase1V-RecoveryLab.ps1 -Action LoadRecoveryEdge -Environment restaurant-acceptance
pnpm --filter @comanview/edge dev
```

Esperado: `/health` devuelve `DOWN`, database `ERROR`, `RECOVERY_REQUIRED`; no aparece una DB vacía. POS muestra
la pantalla segura de recuperación. Detenga Edge y restaure checkpoint antes del siguiente escenario.

## 13. DB corrupta

Con Edge detenido y checkpoint restaurado:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action SimulateCorrupt
```

Arranque con `LoadRecoveryEdge` como en el paso 12. Debe entrar en `RECOVERY_REQUIRED` y preservar una copia en
`runtime\evidence`. Detenga Edge y restaure checkpoint.

## 14. Recovery Key incorrecta

Con Edge detenido: restaure checkpoint, consulte el artifact sano y simule DB missing:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action LatestArtifact
.\scripts\Phase1V-RecoveryLab.ps1 -Action SimulateMissing
.\scripts\Phase1V-RecoveryLab.ps1 -Action CopyWrongKey
```

Anote únicamente `BACKUP_ID` y `ARTIFACT_PATH`; no son secretos. Arranque con `LoadRecoveryEdge`. En POS ingrese
esos dos valores y pegue la clave de prueba del portapapeles. Deje Recovery Authorization vacío. Debe rechazarse,
permanecer `RECOVERY_REQUIRED` y no crear DB. Limpie el portapapeles:

```powershell
Set-Clipboard -Value ''
```

Detenga Edge y restaure checkpoint.

## 15. Artifact alterado

Con Edge detenido y checkpoint restaurado:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action TamperLatest
.\scripts\Phase1V-RecoveryLab.ps1 -Action SimulateMissing
```

El comando entrega `BACKUP_ID` y `TAMPERED_ARTIFACT_PATH`; el artifact original permanece intacto. Arranque con
`LoadRecoveryEdge`. En POS use esos valores y la Recovery Key correcta. Debe rechazarse por autenticidad/integridad,
seguir en `RECOVERY_REQUIRED` y no instalar datos. Detenga Edge y restaure checkpoint.

## 16. Restore VERIFIED correcto

Con Edge detenido y checkpoint restaurado, obtenga el artifact sano antes de retirar la DB:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action LatestArtifact
.\scripts\Phase1V-RecoveryLab.ps1 -Action SimulateMissing
```

Arranque con `LoadRecoveryEdge`. En POS ingrese `BACKUP_ID`, `ARTIFACT_PATH` y la Recovery Key correcta. Para
restore sobre el mismo Edge deje Recovery Authorization vacío. Pulse **Validar e iniciar recuperación**.

Tras `scheduled`, Edge cerrará la superficie recovery. Reinicie en la misma Terminal Edge usando todavía:

```powershell
. .\scripts\Phase1V-RecoveryLab.ps1 -Action LoadRecoveryEdge -Environment restaurant-acceptance
pnpm --filter @comanview/edge dev
```

Ese arranque consume el journal, aplica el swap y debe iniciar normalmente. Si el comando informa que ya no hay
escenario recovery, use `LoadEdge` y arranque Edge normal.

## 17. Estado posterior

Confirme `/health` `UP`, database `OK`, recovery `NORMAL`; inicie sesión y verifique Orders, Payments, Cash,
Audit y Event Log del snapshot. Debe existir evidencia `edge.db.pre-recovery-*` y el artifact `VERIFIED` original.

## 18. Comprobar la fuente

Con Edge aislado detenido:

```powershell
.\scripts\Phase1V-RecoveryLab.ps1 -Action RestoreCheckpoint
.\scripts\Phase1V-RecoveryLab.ps1 -Action Status
```

`Status` abre source, baseline y runtime readonly, exige integridad y confirma `SAME_PATH=false`. No se usa un hash
persistente como prueba absoluta: una SQLite WAL puede cambiar legítimamente por operación posterior. Durante
`Prepare` el helper exige Edge detenido, usa `readonly + query_only`, comprueba cero cambios, integridad y un
fingerprint lógico estable antes/después del snapshot.

## 19. Limpieza final

Con Edge detenido:

```powershell
cd C:\Proyects\comanview
.\scripts\Phase1V-RecoveryLab.ps1 -Action Cleanup
```

Solo elimina `%LOCALAPPDATA%\ComanView\RecoveryAcceptance\phase-1v`. Nunca elimina settings, DB ni secret store
de `restaurant-acceptance`. Debe terminar con `LAB_REMOVED = true`.

## 20. Aceptación adicional del upgrade productivo 1U → 1V

La aceptación manual general de Backup/Recovery y la aceptación específica del upgrade productivo
1U → 1V están **PASS**. La evidencia se obtuvo y revisó durante el desarrollo de la fase; no es
necesario repetir estas aceptaciones para el cierre actual. Los pasos siguientes se conservan como
procedimiento de referencia, sin repetir la aceptación general de Backup/Recovery.

Permanecen como deuda no bloqueante: Cloud object backup diferido y certificación física de que
OFF_DEVICE reside en otro dispositivo diferida.

La aceptación específica utiliza exclusivamente el harness:

`scripts/Phase1V-UpgradeLab.ps1`

Su laboratorio es `%LOCALAPPDATA%\ComanView\RecoveryAcceptance\phase-1v-upgrade`.
No reemplaza ni modifica `phase-1v`, el laboratorio anterior. No use `Phase1V-RecoveryLab.ps1 -Action Prepare`:
ese otro harness ya aplica 0014 antes del startup.

### A. Preparar la copia 1U

Detenga Edge con `Ctrl+C` en su terminal y deje cerrados los clientes POS para no generar operaciones.
Use dos terminales PowerShell nuevas con la misma cuenta Windows. Mantenga detenido el Edge original
durante toda esta aceptación. No levante Cloud.

En **Terminal Verificación**:

```powershell
cd C:\Proyects\comanview
.\scripts\Phase1V-UpgradeLab.ps1 -Action Prepare -Environment restaurant-acceptance
```

Este comando lee las rutas de `Development\restaurant-acceptance\settings.json`; no carga esas rutas
en el entorno del Edge. Exige source schema 0013 completo y credencial activa coherente, comprobados
únicamente sobre una copia. El helper `Phase1V-UpgradeCapture.ps1` adquiere handles Windows de lectura
con `FileShare.None` para DB y todos sus auxiliares existentes antes de capturar bytes. Requiere disco
local NTFS y fuente detenida; si algún cliente mantiene abierta la DB/WAL/SHM, falla cerrado con
`UPGRADE_LAB_SOURCE_IN_USE`. No basta con que el puerto 3000 esté libre. No abre SQLite sobre la fuente,
no hace checkpoint allí y nunca borra sus WAL/SHM. Un WAL residual tras reiniciar sí puede capturarse.

Conserva DB/WAL/SHM originales en `capture` y hashes SHA-256 en `capture/capture.json`. Compara bytes
mediante hashes durante la captura exclusiva y verifica DB/WAL/SHM/journal/secret originales antes y
después de Prepare. Un rollback journal con contenido se rechaza, no se ignora. En `processing`, copia
solo los DB/WAL ya aislados; SQLite reconstruye allí el SHM y lee las transacciones confirmadas del WAL,
descartando las no confirmadas según su protocolo. Solo esta copia puede consolidarse. Desde ella,
`Database.backup()` genera baseline/runtime; comprueba integridad, schema 13 y fingerprints de todas las
tablas. No usa `immutable` sobre una fuente con WAL ni copia una DB activa sin exclusión.

La copia `baseline\edge.db` y la copia `runtime\edge.db` permanecen en schema 13. No se aplica 0014,
no se inicializa Security Floor y no se invoca el orquestador durante `Prepare`. La credencial existente
se reenvuelve con DPAPI solamente en `runtime\edge-secret.bin`, bajo un directorio restringido a la
cuenta Windows actual. No hay provisioning, rotación ni impresión de secretos. El modo de lectura de
la credencial fuente es `development-file`, como el entorno de aceptación existente; use
`-SourceSecretStore windows-dpapi` solamente si esa fuente realmente utiliza DPAPI.

Resultado necesario:

```text
LAB_READY = true
ISOLATED_RUNTIME = true
SOURCE_UNCHANGED = true
BASELINE_SCHEMA = 13
RUNTIME_SCHEMA = 13
SECURITY_FLOOR_PRESENT = false
DATA_PRESERVED = true
UPGRADE_COMPLETED = false
```

Confirme que `RUNTIME_DB` termina en `RecoveryAcceptance\phase-1v-upgrade\runtime\edge.db`.
Si el laboratorio ya existe, el comando lo rechaza; no lo borre ni ejecute Cleanup. Para otro intento
autorizado puede usar `-LabName phase-1v-upgrade-02` **en todos los comandos**. Un Prepare fallido no
publica LAB_READY y conserva la copia incompleta para diagnóstico. Si la fuente ya tiene schema 14,
deténgase: no se fabricará una DB 1U ni se hará downgrade.

### B. Primer arranque productivo de la copia

En **Terminal Edge**:

```powershell
cd C:\Proyects\comanview
.\scripts\Phase1V-UpgradeLab.ps1 -Action Start
```

No use dot-sourcing, `dev:prepare`, `dev:local`, ni migrations manuales. `Start` lanza un proceso hijo
con el entry point real `apps/edge/src/index.ts` mediante Node/tsx, sin watcher ni código alternativo
de startup. Usa `NODE_ENV=production`, ambos stores DPAPI, Licensing habilitado con el keyring público
de aceptación, `Sync=false` y **sin Cloud URL ni token heredado**. DB, credencial, floor, backups,
directorio de trabajo y temporales apuntan exclusivamente al laboratorio. No ejecuta build ni suites.

Compruebe en la terminal:

```text
ISOLATED_RUNTIME = true
NODE_ENV = production
SYNC_ENABLED = false
CLOUD_URL_CONFIGURED = false
EDGE_SECRET_STORE = windows-dpapi
RECOVERY_SECURITY_STORE = windows-dpapi
```

Espere `UPGRADE COMPLETED` y el servidor escuchando en puerto 3000. Ese mensaje debe proceder del
startup productivo, que realiza snapshot → 0014 → Security Floor → validación. Ante cualquier error,
no reintente a ciegas: conserve ambas salidas y comunique `ERROR_CODE`/`RECOVERY_REQUIRED`.

### C. Verificar el primer arranque sin operar el POS

Con el Edge aislado todavía encendido, en **Terminal Verificación**:

```powershell
.\scripts\Phase1V-UpgradeLab.ps1 -Action VerifyFirstStart
```

Debe mostrar `HEALTH=UP`, `DATABASE=OK`, `RUNTIME_SCHEMA=14`, `BASELINE_SCHEMA=13`,
`SECURITY_FLOOR_VALID=true`, `RECOVERY_STATE=NORMAL`, `RECOVERY_EPOCH=0`, `DATA_PRESERVED=true`,
`SOURCE_UNCHANGED=true` y `FIRST_START_VERIFIED=true` (la salida utiliza espacios alrededor de `=`).

La verificación confirma que el PID que escucha es el hijo arrancado por este harness. Compara columnas
legacy e IDs/importes/estados de Orders, Payments, Cash, Event Log, Audit y otras tablas conservadas
contra el baseline 1U; comprueba binding, checksum DPAPI, floor monotónico y revocaciones. Verifica un
solo safety artifact cifrado schema 13 bajo `runtime\.upgrade-1v`. Solo registra evidencia no secreta en
`.first-start.json`: no escribe SQLite, credenciales ni Security Floor, y no repara un floor corrupto.
No vuelva a ejecutar VerifyFirstStart: la evidencia del primer arranque no se sobrescribe.

### D. Restart e idempotencia

En **Terminal Edge**, detenga el proceso con `Ctrl+C`. Luego vuelva a ejecutar:

```powershell
.\scripts\Phase1V-UpgradeLab.ps1 -Action Start
```

Debe iniciar normalmente sin otro `UPGRADE COMPLETED`. En **Terminal Verificación**:

```powershell
.\scripts\Phase1V-UpgradeLab.ps1 -Action VerifyRestart
```

Además de las comprobaciones anteriores, debe mostrar `RESTART_IDEMPOTENT=true`: exige un segundo
arranque real, schema 14, mismo epoch/binding/estado de seguridad y exactamente el mismo safety artifact.
No basta volver a consultar el mismo proceso. No haga ventas, login ni otras operaciones entre ambos
arranques; así la comparación de datos sigue siendo exacta. Ejecute estos pasos sin dejar el laboratorio
operando durante horas.

### E. Finalizar esta aceptación

Detenga únicamente el Edge aislado con `Ctrl+C`. Conserve el laboratorio y las dos salidas de verificación
para revisión. `Status` permite inspección adicional read-only. Este harness no ofrece Cleanup ni toca
el laboratorio anterior. No hay commit/push, validación global ni simulaciones destructivas en esta sección.
Los resultados manuales de C y D fueron revisados durante el desarrollo de la fase: aceptación PASS.
