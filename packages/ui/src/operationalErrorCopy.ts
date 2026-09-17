import type { ErrorCode } from '@comanview/contracts';
/** Shared operational copy; no command decisions depend on these messages. */
export const operationalErrorCopy = {
  TAX_REVISION_INCONSISTENT:
    'La revisión fiscal no coincide con su evidencia. Solicita revisión administrativa.',
  TAX_SNAPSHOT_IMMUTABLE: 'El detalle de impuestos está protegido; no se modificó la venta.',
  PRECHECK_REQUIRES_OPEN_ORDER:
    'La precuenta solo está disponible mientras la venta sigue abierta.',
  RECEIPT_REQUIRES_CLOSED_ORDER: 'Cierra la venta antes de generar el recibo.',
  PRODUCT_UNAVAILABLE:
    'Este producto ya no está disponible. Actualiza el catálogo e intenta de nuevo.',
  PRODUCT_INACTIVE: 'Este producto fue retirado del catálogo.',
  INVALID_MODIFIER_SELECTION: 'Revisa las opciones obligatorias y los límites de selección.',
  MODIFIER_UNAVAILABLE:
    'Una opción seleccionada ya no está disponible. Revisa tu selección con el catálogo vigente.',
  MODIFIER_INACTIVE:
    'Una opción seleccionada fue retirada del catálogo. Revisa tu selección con el catálogo vigente.',
  ORDER_ITEM_SENT: 'El producto ya fue enviado y no puede eliminarse como borrador.',
  ORDER_PAID_AMOUNT_EXCEEDS_TOTAL:
    'La edición dejaría el total por debajo de lo ya pagado. Conserva o aumenta el importe.',
  ORDER_ITEM_SPECIAL_INSTRUCTIONS_FROZEN:
    'La nota quedó protegida porque el producto ya fue enviado.',
  SPECIAL_INSTRUCTIONS_TOO_LONG: 'La nota especial no puede superar 500 caracteres.',
  NO_DRAFT_ITEMS: 'No hay productos nuevos por enviar.',
  ORDER_NOT_FOUND: 'La venta actual ya no está disponible en el servicio local.',
  CASH_SESSION_ALREADY_OPEN: 'Esta caja ya tiene una sesión abierta.',
  PAYMENT_OVERPAYMENT: 'El pago supera el saldo pendiente de la venta.',
  INVALID_CASH_TENDERED: 'El efectivo recibido no cubre consumo y propina.',
  INVALID_PAYMENT_AMOUNT: 'Ingresa un monto de pago válido.',
  INVALID_TIP: 'La propina indicada no es válida.',
  TIPS_DISABLED: 'Las propinas están desactivadas en esta ubicación.',
  ORDER_BALANCE_NOT_ZERO: 'La venta todavía tiene saldo pendiente y no puede cerrarse.',
  ORDER_HAS_DRAFT_ITEMS: 'Envía o elimina los productos pendientes antes de cerrar la venta.',
  PAYMENT_CURRENCY_MISMATCH: 'La moneda del pago no coincide con la venta.',
  COMMAND_ID_CONFLICT: 'La operación ya fue utilizada con datos diferentes. Intenta nuevamente.',
  AUTHENTICATION_REQUIRED: 'La sesión local ya no está disponible. Inicia sesión nuevamente.',
  AUTH_SESSION_INVALID: 'La sesión local expiró o fue revocada. Inicia sesión nuevamente.',
  DEVICE_CREDENTIAL_INVALID:
    'La identidad guardada de este dispositivo no es válida. Empareja el dispositivo nuevamente.',
  DEVICE_LIMITS_UNAVAILABLE:
    'Los límites de dispositivos todavía no están disponibles en la licencia local.',
  PAIRING_RATE_LIMITED: 'Hubo demasiados intentos. Espera un momento antes de volver a intentarlo.',
  INSTALLATION_AUTHORIZATION_INVALID:
    'La autorización de instalación no es válida para este dispositivo.',
  INSTALLATION_BOOTSTRAP_CLOSED: 'La instalación inicial ya fue completada y no puede repetirse.',
  OVERRIDE_REQUIRED: 'Esta operación requiere autorización de gerente o propietario.',
  OVERRIDE_PIN_INVALID: 'El PIN de autorización no es válido.',
  OVERRIDE_USER_INACTIVE: 'El usuario autorizador no está activo.',
  OVERRIDE_PERMISSION_DENIED: 'El usuario indicado no puede autorizar esta operación.',
  REASON_REQUIRED: 'Indica un motivo para realizar esta operación.',
  AUDIT_PERSISTENCE_FAILED: 'No se pudo guardar la auditoría; la operación no fue aplicada.',
  INVALID_CASH_MOVEMENT: 'El movimiento requiere importe positivo y motivo.',
  INVALID_CASH_COUNT: 'El efectivo contado debe ser un importe válido no negativo.',
  CASH_SESSION_ALREADY_CLOSED: 'El turno de caja ya fue cerrado.',
  CASH_SESSION_HAS_PENDING_PAYMENTS: 'Existen pagos pendientes; resuélvelos antes del Corte Z.',
} satisfies Partial<Record<ErrorCode, string>>;
