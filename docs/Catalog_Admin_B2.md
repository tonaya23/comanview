# B2 — Products & Categories Admin

Estado: **B2 CLOSED — UX POLISH IMPLEMENTED — MANUAL ACCEPTANCE PASS**. Group B OPEN;
B1 CLOSED; B3 NOT STARTED.
Base: `111010b1fbb60f40b1540c67079219e72821839f`. Sin commit/push de B2.

## Superficie comercial

POS → Restaurante → **Catálogo → Productos / Categorías**. Navegación tipada dentro
del shell existente, no una URL nueva. Impuestos conserva sus perfiles/asignaciones
y enlaza «Administrar productos»; ya no contiene otro formulario de creación.
La superficie comercial se carga de forma diferida al entrar en Catálogo.

Productos: búsqueda local por nombre/SKU/barcode, categoría y Nuevo producto siempre
visibles. Estación, disponibilidad y «Mostrar retirados» se agrupan bajo «Filtros».
Por defecto se muestran solo productos en catálogo, incluidos los no disponibles.
Resumen de productos/no disponibles calculado sobre la vista filtrada, sin consultas
adicionales. Orden determinista por displayOrder/nombre/id, sin dashboard ni bulk.
Filas compactas con nombre, precio/moneda, categoría, estación, disponibilidad,
Editar y menú secundario. No UUID/revisiones como información primaria.

«En catálogo» = active=true; «Retirado» = active=false, únicamente alias comerciales.
Disponible/No disponible representan available de forma independiente. La acción
rápida de disponibilidad espera ACK; «Retirar del catálogo» requiere confirmación
explícita y envía SET_PRODUCT_ACTIVE false. «Reactivar» envía true sin modificar
available; si sigue false, el feedback lo explica. No hay borrado físico.

Crear: precio obligatorio y exacto mediante la utilidad decimal existente, moneda
del restaurante no editable, categoría del sistema, impuesto predeterminado,
sin estación, activo/disponible. OWNER con permisos puede elegir impuesto/estación;
sin esos permisos los controles son de consulta y CREATE omite el impuesto explícito
para que Edge aplique su default. No se crean perfiles fiscales ni estaciones aquí.
Se guía a moneda/default tax/configuración cuando falta un prerrequisito conocido.
Edge conserva la autoridad sobre permisos, readiness y validez de cada operación.

Editar abre una vista dedicada: la lista permanece montada pero oculta. Cabecera
con nombre, estado de guardado, Guardar y Volver; secciones Información, Precio e
impuestos, Preparación, Opciones y extras (solo explicación futura) y Estado.
Volver conserva búsqueda, categoría, estación, disponibilidad, retirados y apertura
de filtros, y devuelve foco a la fila de origen como contexto de lista. Un borrador
sin guardar requiere confirmación antes de descartarlo. Sin editor de modificadores.

Categorías: activas por defecto, «Mostrar inactivas», conteos totales/en catálogo
derivados en una pasada de la misma lectura de productos. Ver productos/Editar como
acciones principales; Desactivar/Reactivar en menú secundario. «Ordenar categorías»
muestra Subir/Bajar; cada movimiento envía el comando atómico con todas las categorías
y sus versiones, incluidas las ocultas, respetando el orden global.
«Sin categoría» permanece visible con «Del sistema» y explicación desplegable;
no se renderizan acciones imposibles de edición/desactivación.
Las categorías llamadas `Category` se conservan y muestran una advertencia condicional
sobre su nombre genérico («Revisar nombre», explicación bajo demanda), no una afirmación
de que sean errores ni un merge automático.
Un rechazo por productos activos ofrece la navegación filtrada a esos productos;
nunca desactiva en lote. Los nombres siguen las reglas de Edge, sin nueva unicidad.

## Escrituras, conflictos y continuidad

Solo contratos B1: `catalogCommand`, `executeTaxAdministration` y
`executeRestaurantAdministration`. Sin endpoints legacy ni escrituras DB.
El plan de edición envía información → categoría → precio → impuesto → estación →
disponibilidad → activo, omitiendo dominios sin cambio. Cada ACK proporciona la versión
del siguiente comando. No hay una transacción global frontend ni rollback ficticio.
Un fallo parcial enumera campos confirmados y pendientes y conserva el borrador.

Un ACK incierto retiene el comando exacto y su commandId; los campos del intento se
bloquean hasta reintentar. Los pasos ya confirmados no se repiten. Un rechazo definitivo
permite corregir una intención con un ID nuevo. Un conflicto exige consultar/comparar
y aceptar explícitamente la base actual antes de volver a guardar. El rebase conserva
solo campos editados localmente y adopta cambios remotos no relacionados. No last-write-wins.

El refresh usa `CatalogInvalidationController` de B1 y su lectura generation/epoch
antes/después. El snapshot actualizado del POS notifica a Admin; focus/reconexión y
retorno a Catálogo consultan de nuevo sin sustituir borradores. Filtros y búsqueda se
mantienen. Productos y Categorías permanecen montados al navegar dentro de Admin;
salir de Admin con cambios requiere confirmación; beforeunload advierte.
Un ACK confirmado seguido de un problema de lectura no se convierte en fallo de escritura.

Loading, catálogo vacío, búsqueda sin coincidencias, falta de permisos, lectura
no disponible, dependencia faltante y conflicto/error se presentan por separado.
Los errores de Edge se traducen con guidance 1X/B1, sin exponer mensajes internos.
El feedback conserva sección, entidad e intento lógico; cambiar de sección no muestra
el error de la otra. Abrir otro editor limpia el feedback anterior de esa sección.
El rechazo CATEGORY_HAS_ACTIVE_PRODUCTS identifica la categoría y ofrece «Ver productos»;
la navegación aplica esa categoría y limpia filtros incompatibles, sin descartar un
borrador sin confirmación. Un intento incierto conserva su comando y contexto al reintentar.
Un lector con CATALOG_VIEW no depende de ADMINISTRATION_VIEW para abrir el catálogo.

## Validación focal

Evidencia previa a este polish: **122/122 tests focales PASS** (38 nuevos B2: 17 Product UI,
8 Category UI, 2 integración shell y 11 de lógica/orquestación; 28 Admin Local;
48 CatalogCommandService; 8 SDK). Typecheck y build POS/UI PASS.
Layout automatizado: **2/2 viewports, 6/6 comprobaciones PASS**. `git diff --check` PASS.
En esa validación previa no se ejecutaron suites globales ni aceptación manual;
el estado manual final se registra abajo.

Validación B2-UX-POLISH: **76/76 tests focales PASS**: 37 CatalogAdministration
(10 escenarios de polish + 27 de regresión adaptados a navegación/copy), 11 de
orquestación y 28 Admin Local. POS typecheck/build PASS. UI compartida, backend,
SDK y comandos no modificados en este polish; no se repitieron sus suites ni los
362 tests de B1. Sin suites globales. `git diff --check` PASS.

Presentación con 28 productos sintéticos (retirados y no disponibles), 8 categorías:
**12/12 comprobaciones** en 1366×768 y 768×1024: lista, filtros abiertos, editor,
regreso a lista, categorías y modo ordenar. Filas de 64 px desktop y 114 px tablet;
sin overflow horizontal ni controles fuera del viewport. Menús/desplegables nativos,
controles de 44 px, foco visible, tabulación y Escape con retorno de foco; errores
asociados al formulario. La prueba jsdom usa click para la activación nativa de summary
(no emula Enter); esta evidencia automatizada no certifica por sí sola teclado/touch.

Revisión final para checkpoint: **6/6 smoke B1 PASS**, usando filtro focal sobre
CatalogCommandService: receipt replay/ACK perdido, OCC entre escritores, independencia
de estados, permisos/referencias, snapshots inmutables y protección/orden de categorías.
Los otros 42 casos figuran excluidos por el filtro, no son skips nuevos del código.
Se reutilizan los 76 tests del polish y los typecheck/build recientes de POS; los
resultados previos de UI y tooling siguen vigentes sin cambios posteriores relevantes.
Sin repetición global. Diff/hygiene revisados, sin secretos ni artefactos runtime/lab
detectados entre los archivos candidatos. Sin cambios en migraciones/contratos B1.
Sin blockers ni DECISION_REQUIRED; no se cambió producto durante esta revisión.

- Tests UI/estado nuevos: Product UI, Category UI, integración con Admin y plan de
  comandos; exact Money, permisos, retry, OCC, partial save, realtime y dirty state.
- Regresión de Admin Local y pruebas mínimas B1: CatalogCommandService y SDK
  commands/invalidation. No suite global ni repetición de los 362 tests de B1.
- Typecheck/build focal de POS y UI. Sin cambios de backend, contratos de dominio,
  migraciones, Security Floor, snapshots, impuestos o permisos autoritativos.
- `node apps/pos/scripts/catalogLayoutCheck.mjs`: Chrome headless aislado, datos
  sintéticos, puerto efímero, sin Edge/lab existente. Comprueba lista/editor/categorías
  en viewports reales de iframe de 1366×768 y 768×1024: sin overflow horizontal ni
  controles fuera del viewport. Deja evidencia temporal fuera del repositorio.
  No es aceptación manual ni prueba de autenticación/backend.

## Aceptación manual y cierre B2

**MANUAL ACCEPTANCE: PASS**, confirmada por el usuario en la revisión final.
La experiencia general de Productos/Categorías se considera suficientemente usable:
lista mejorada, retiro/reactivación más claros y distinción active/available comprendida.
El usuario no solicita más cambios UX antes de continuar. No se atribuyen nuevas
pruebas específicas ni nuevas ejecuciones al usuario fuera de esa confirmación.
La confusión detectada en la aceptación anterior motivó el polish ya implementado.

Se conserva el siguiente procedimiento como referencia QA/regresión, no como gate
pendiente ni como afirmación de ejecución individual de todos sus pasos:

Usar un lab aislado actualizado al working tree B2, con startup productivo hasta
schema 16 y su identidad/Floor/Device propios. OWNER autorizado; probar también
MANAGER sin TAX_PROFILE_MANAGE/STATION_MANAGE y un lector CATALOG_VIEW.
Configurar por UI moneda y default TaxProfile activo; estación activa opcional.
No SQL manual, seeds de catálogo, mezcla de labs ni cambios a instalaciones existentes.

1. Entrar en POS/Admin → Catálogo → Productos; verificar vacío y prerrequisitos.
2. Crear categorías/productos por UI; probar nombre, SKU/barcode, precio, filtros y orden.
3. Marcar no disponible: debe seguir en catálogo. Retirarlo desde ⋯ con confirmación;
   comprobar que desaparece por defecto. Mostrar retirados y reactivar: si no estaba
   disponible, debe seguir no disponible y explicarlo. Editar precio/impuesto/estación;
   comprobar permisos y que Volver conserva todos los filtros.
4. Mantener un borrador abierto y modificar el producto desde otra sesión autorizada:
   lista actualizada, borrador conservado, revisión explícita sin sobrescritura silenciosa.
5. Crear/renombrar/reordenar/desactivar categorías; categoría con productos activos
   debe bloquearse con guidance; «Sin categoría» permanece protegida.
6. Cambiar entre apartados y volver; confirmar persistencia tras restart del mismo lab.
7. Verificar teclado, foco, lectura comercial y comodidad real en desktop/tablet.
8. Provocar bloqueo de categoría con productos en catálogo; usar Ver productos y
   comprobar que su error no aparece en Productos. Revisar información del sistema,
   aviso legacy bajo demanda, Mostrar inactivas y modo Ordenar categorías.

**B2 CLOSED**; checkpoint pendiente de aprobación del reporte, sin commit/push.
Group B sigue OPEN; B1 CLOSED; B3 NOT STARTED. B3 modifiers, B4 CSV/XLSX,
B5 closure, imágenes, edición masiva y Group C no implementados.
La decisión B0 de quantity permanece congelada para B3a: una entrada por opción,
entero >=1, IDs duplicados rechazados, min/max cuentan SUM(quantity), sin maxPerOption.
No ModifierType nuevo ni flags de notas; specialInstructions conserva su comportamiento.
