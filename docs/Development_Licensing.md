# Signed Licensing local (Fase 1T)

Fase 1T requiere PostgreSQL Cloud, un Edge provisionado por 1S y material Ed25519 exclusivo del entorno de desarrollo. No se incluye ninguna clave privada en el repositorio.

## Material de firma efímero

Genera un par local fuera del workspace y conserva el PEM privado únicamente en variables de la terminal Cloud. Configura Cloud con:

```text
COMANVIEW_CLOUD_SIGNING_KID=<identificador de desarrollo>
COMANVIEW_CLOUD_SIGNING_PRIVATE_KEY_PEM=<PEM PKCS8 privado>
```

Configura Edge con un JSON de keyring público que contenga el mismo `kid`:

```text
COMANVIEW_LICENSE_PUBLIC_KEYRING={"<kid>":"<PEM SPKI público>"}
COMANVIEW_LICENSE_ENFORCEMENT_ENABLED=true
```

El keyring admite simultáneamente claves `current` y `next`. Nunca copies la private key a Edge, SQLite, PostgreSQL, `.env`, documentación, logs ni datos seed.

## Orden operacional

1. Ejecuta migrations Cloud `0000` a `0004` y Edge `0000` a `0012` mediante los scripts existentes.
2. Inicia Cloud API con PostgreSQL, Cloud Admin Auth y el secret Ed25519 configurados.
3. En Super Admin crea un plan técnico con las capabilities requeridas y asigna una licencia a la Location antes de generar el provisioning code.
4. Provisiona Edge mediante el flujo 1S y configura su keyring público.
5. Edge obtiene `LICENSE`, `FEATURE_FLAGS` y `CONFIGURATION` mediante pull autenticado; `/licensing/status` y `/licensing/configuration` requieren Auth local.

El plan se administra como datos. Ningún código comercial o PIN conocido debe formar parte de una instalación productiva.

## Comprobaciones de desarrollo

- Cambiar `ACTIVE`, `PAST_DUE`, `GRACE_PERIOD`, `SUSPENDED` o `TERMINATED` en Super Admin incrementa la revisión y genera un documento nuevo para el Edge ACTIVE.
- Cambiar plan demuestra expansión/reducción de capabilities sin que POS consulte `planCode`.
- Configurar propinas actualiza exclusivamente el stream `CONFIGURATION`.
- Apagar Cloud no interrumpe el hot path local; Edge usa last-known-good y la política temporal firmada.
- Al expirar grace con turno abierto se conserva Guaranteed Shift. Sin turno, las Orders OPEN preexistentes pasan a Protected Operations y pueden liquidarse con una CashSession `LICENSE_RECOVERY` única.

## Estado de validación manual de Fase 1T

Se validó con Cloud y Edge reales la emisión, descarga, verificación, persistencia y ACK de los streams `LICENSE`, `FEATURE_FLAGS` y `CONFIGURATION`. También se comprobó el arranque offline con last-known-good, la reconvergencia al restaurar Cloud, el cambio de configuración sin reiniciar Edge, las transiciones `ACTIVE → SUSPENDED → ACTIVE` y la conservación del historial de revisiones.

Durante la validación se corrigió el ACK outbox de SQLite: `better-sqlite3` requiere que el instante usado por `pendingAcks` se enlace como epoch milliseconds (`Date.getTime()`), no como un objeto `Date`. Los fallos de pull/ACK ahora se registran únicamente con código, etapa, status y metadatos operativos seguros; nunca se incluyen credenciales, headers, tokens, firmas, envelopes, PEM, hashes ni contenido del secret store.

La validación manual de venta normal, Guaranteed Shift, Protected Orders, `LICENSE_RECOVERY` y reducción diferida de capabilities queda pendiente de Fase 1U. Un binding recién provisionado todavía no dispone de installation readiness/device pairing y el login POS es rechazado correctamente con `DEVICE_NOT_AUTHORIZED`. Estas rutas están cubiertas por tests automáticos de 1T y no se introduce ningún bypass de autenticación para probarlas.

Fase 1T no incluye billing provider, Cloud realtime, comandos remotos, Device Pairing (1U), Backup/Recovery (1V), OTA (1W) ni Public Storefront (1X).
