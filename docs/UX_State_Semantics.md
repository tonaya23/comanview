# UX 1X — Semántica y responsabilidades

Guía breve de la implementación; no sustituye los contratos ni las reglas de dominio.

Estado: **1X CLOSED — MANUAL ACCEPTANCE PASS — TECHNICAL VALIDATION PASS**.
La aceptación manual de UX Round 2 fue confirmada por el usuario; el gate global final terminó PASS.
Véase `Acceptance_Phase_1X.md`. Sin nuevas capacidades de dominio.

Diferidos: **GROUP_B_CATALOG** (Commercial Catalog, categorías, página dedicada de productos,
configuración por producto y CSV/XLSX); **GROUP_C** (cancelación directa de DRAFT con productos
bajo reglas backend certificadas); **NICE_TO_HAVE** (long press, swipe actions y microanimaciones touch).

## Errores y guidance

- Edge/Cloud son autoridad sobre permisos, precondiciones, revisiones, licencias y resultados.
  Los códigos contractuales viven en `packages/contracts/src/errors.ts`.
- El SDK valida transporte y conserva solo detalles públicos permitidos. No transportar
  mensajes arbitrarios del servidor a la superficie comercial.
- `packages/ui/src/guidance.ts` posee `ErrorCode → UserGuidance` en español. Las apps resuelven
  destinos tipados según permisos; un acceso oculto/deshabilitado no reemplaza autorización backend.
- Los overrides son contextuales (por ejemplo conexión Cloud), no copias de todo el catálogo.
  Errores desconocidos usan fallback seguro. Referencias diagnósticas no son stacks ni secretos.
- IDs, revisiones y códigos necesarios para soporte se agrupan en detalles técnicos, no en
  instrucciones que obliguen al cajero a conocer arquitectura. No comparar textos humanos en lógica.

## Estados

| Estado | Presentación y acción |
| --- | --- |
| Loading / empty | Espera o ausencia de datos; no simular fallo ni éxito |
| Success | ACK confirmado; anuncio no urgente |
| Warning / degraded | Explicar qué parte requiere atención y qué continúa disponible |
| Recoverable error | Rechazo local a la acción; reintento explícito cuando sea seguro |
| Missing prerequisite | Explicar configuración faltante; destino permitido si existe |
| Permission denied | Solicitar acceso; no tratarlo como configuración faltante |
| Offline local | No confirmar operaciones sin respuesta; conservar contexto seguro |
| Realtime reconnect | HTTP puede funcionar; polling no equivale a conexión local caída |
| Recovery required | Operación protegida/bloqueada; no instalación vacía de fallback |
| Suspended licensing | Restricción de licencia distinta de capacidad no incluida |
| Stale / OCC | Consultar versión vigente, conservar intención segura y revisar antes de reenviar |

`stateTaxonomy.ts` define la taxonomía; alertas urgentes usan `alert`, feedback rutinario
`status`. `navigator.onLine` es una indicación del navegador, no prueba de conectividad Cloud.
Un refresh fallido después de un ACK no revierte ni convierte ese ACK en fallo de la operación.

## Componentes y lenguaje

Dialog, Button, Field, feedback, tokens de foco/estado y guidance viven en `@comanview/ui`.
Componentes de venta, cocina y administración permanecen en sus apps. No se sustituyó todo el CSS.
Preferir Venta/Pedido, Mostrador, Sin enviar, Enviado, Propietario, Turno de caja,
Función de estación y Copia externa. Los enums/payloads internos no cambian por traducir la UI.
PIN enmascarado; autorizaciones firmadas entregadas mediante copia explícita, nunca logs.
Los diálogos bloquean interacción exterior, atrapan foco y restauran el disparador cuando existe;
Escape se deshabilita durante operaciones que no admiten cancelación segura.

La matriz de viewports y el checklist están en `Acceptance_Phase_1X.md`. Pruebas DOM y revisión
de CSS no equivalen a aceptación manual, evaluación con lector de pantalla ni certificación WCAG.
