import type { ErrorCode, PublicErrorDetails } from '@comanview/contracts';
import { operationalErrorCopy } from './operationalErrorCopy.js';
import { navigationTarget, type TypedNavigationTarget } from './navigation.js';

export type GuidanceCode = ErrorCode | 'EDGE_UNREACHABLE' | 'INVALID_EDGE_RESPONSE' | 'UNKNOWN_EDGE_ERROR';
export type GuidanceSeverity = 'info' | 'success' | 'warning' | 'error' | 'critical';
export type GuidanceRetryability = 'none' | 'retry' | 'after-action' | 'contact-administrator';
export interface GuidanceAction { label: string; target: TypedNavigationTarget }
export interface UserGuidance {
  code: string;
  title: string;
  explanation: string;
  severity: GuidanceSeverity;
  retryability: GuidanceRetryability;
  action?: GuidanceAction;
  diagnosticReference?: string;
}
type GuidanceCopy = Omit<UserGuidance, 'code' | 'diagnosticReference'>;
export type UserGuidanceOverride = Partial<Omit<GuidanceCopy, 'action'>> & { action?: GuidanceAction | null };

const admin = navigationTarget.administration;
const system = navigationTarget.system;
const copy = (title:string, explanation:string, severity:GuidanceSeverity, retryability:GuidanceRetryability, action?:GuidanceAction):GuidanceCopy =>
  ({title,explanation,severity,retryability,...(action?{action}:{})});
const go = (label:string,target:TypedNavigationTarget):GuidanceAction => ({label,target});

/** Spanish presentation catalog. Edge owns codes and policy, never localized copy. */
export const ES_ERROR_GUIDANCE: Partial<Record<ErrorCode, GuidanceCopy>> = {
  ...Object.fromEntries(Object.entries(operationalErrorCopy).map(([code, explanation]) => [code, copy('Revisa la operación', explanation, 'warning', 'after-action')])),
  TABLE_OCCUPIED: copy('La mesa está ocupada','Otra operación ocupó esta mesa. Actualiza el mapa y entra al pedido vigente.','warning','retry'),
  TABLE_INACTIVE: copy('Mesa no disponible','Esta mesa ya no está activa. Revisa el mapa y selecciona otra mesa.','warning','after-action'),
  KDS_TICKET_NOT_FOUND: copy('Comanda no disponible','La comanda ya no está disponible. Actualiza la estación antes de continuar.','warning','retry'),
  KDS_INVALID_TRANSITION: copy('La comanda cambió','Consulta el estado actualizado de la comanda antes de continuar.','warning','retry'),
  KDS_INCONSISTENT_STATE: copy('No se pudo validar la comanda','No repitas la preparación sin revisar. Actualiza la estación y avisa al responsable si el problema continúa.','error','contact-administrator'),
  CURRENCY_LOCKED: copy('La moneda ya está fijada','Existe actividad financiera. La moneda se conserva para proteger los importes y el historial.','warning','none'),
  CURRENCY_PRICE_REENTRY_REQUIRED: copy('Revisa los precios antes de cambiar moneda','Los importes existentes no se convierten automáticamente. Revisa los requisitos para volver a introducir los precios en la nueva moneda.','warning','after-action',go('Revisar moneda',admin('day-currency'))),
  BUSINESS_DAY_POLICY_IN_USE: copy('La jornada todavía está en uso','No se puede cambiar esta configuración mientras existan operaciones que usan la jornada actual. Revisa los turnos y operaciones pendientes.','warning','after-action'),
  CASH_REGISTER_IN_USE: copy('La caja está en uso','Termina las operaciones de esta caja antes de modificarla o desactivarla.','warning','after-action'),
  TAX_PROFILE_IN_USE: copy('El impuesto está en uso','Revisa los productos y la configuración predeterminada antes de desactivar este impuesto.','warning','after-action',go('Revisar impuestos',admin('taxes'))),
  STATION_HAS_PENDING_WORK: copy('La estación tiene trabajo pendiente','Completa su trabajo pendiente antes de desactivarla.','warning','after-action'),
  ZONE_IN_USE: copy('La zona está en uso','Revisa sus mesas y operaciones antes de desactivarla.','warning','after-action',go('Revisar zonas y mesas',admin('zones-tables'))),
  TABLE_HAS_ACTIVE_ORDER: copy('La mesa tiene una venta abierta','Termina la venta antes de cambiar esta configuración de la mesa.','warning','after-action'),
  PERSONNEL_VERSION_CONFLICT: copy('Los datos de la persona cambiaron','Tu edición se conserva. Actualiza la lista y revisa el estado actual antes de volver a guardar.','warning','retry'),
  PERSONNEL_LAST_OWNER: copy('Debe quedar un propietario activo','No puedes desactivar al último propietario autorizado.','warning','none'),
  CONTRACTUAL_OWNER_PROTECTED: copy('Este propietario está protegido','Esta operación no está permitida para el propietario de la instalación.','warning','contact-administrator'),
  PERSONNEL_PIN_NOT_UNIQUE: copy('Elige otro PIN','El PIN elegido no está disponible. Introduce uno diferente de 4 a 12 dígitos.','warning','after-action'),
  PERSONNEL_SECURITY_UNAVAILABLE: copy('Seguridad temporalmente no disponible','Estamos validando la seguridad de la sesión. Las operaciones permanecen bloqueadas hasta confirmar el estado vigente; no necesitas volver a iniciar sesión.','warning','retry'),
  PERSONNEL_SECURITY_NOT_INITIALIZED: copy('La seguridad del personal no está lista','La instalación requiere revisión antes de autorizar operaciones. Contacta al responsable.','critical','contact-administrator'),
  PERSONNEL_COMMAND_FIELDS_INVALID: copy('La solicitud de personal no es compatible','La solicitud contiene campos que esta operación no admite. No se aplicó el cambio; comparte la referencia con soporte.','error','contact-administrator'),
  USER_SECURITY_REPAIR_REQUIRED: copy('El acceso requiere reparación','Hay una transición de seguridad pendiente. Un responsable debe revisar y reparar el acceso antes de continuar.','critical','contact-administrator'),
  USER_REVIEW_REQUIRED: copy('La autorización requiere revisión','Los permisos guardados no corresponden a la autorización vigente. Solicita revisión al responsable.','error','contact-administrator'),
  CREDENTIAL_RESET_REQUIRED: copy('Es necesario renovar el PIN','La credencial guardada ya no es válida. Solicita un restablecimiento autorizado; no reutilices el PIN anterior.','error','contact-administrator'),
  USER_UNTRUSTED: copy('Acceso pendiente de autorización','Esta persona no tiene una identidad de seguridad validada para la instalación actual. Solicita revisión al responsable.','critical','contact-administrator'),
  USER_SECURITY_REVISION_CONFLICT: copy('La seguridad del acceso no coincide','Las revisiones de seguridad no son coherentes. La operación sigue bloqueada hasta una revisión autorizada.','critical','contact-administrator'),
  CURRENCY_REQUIRED: copy('Configura primero la moneda','Establece y guarda primero la moneda en Día y moneda para continuar.','warning','after-action',go('Configurar moneda',admin('day-currency'))),
  BUSINESS_DAY_POLICY_REQUIRED: copy('Configura el día de negocio','Define la zona horaria y la hora de cambio de día antes de continuar.','warning','after-action',go('Configurar día de negocio',admin('day-currency'))),
  DEFAULT_CASH_REGISTER_REQUIRED: copy('Elige una caja predeterminada','La operación necesita una caja activa como predeterminada.','warning','after-action',go('Configurar cajas',admin('registers'))),
  CASH_REGISTER_REQUIRED: copy('Configura una caja','Crea o activa una caja para realizar esta operación.','warning','after-action',go('Configurar cajas',admin('registers'))),
  CASH_SESSION_NOT_OPEN: copy('Abre una caja para continuar','Esta operación requiere una sesión de caja abierta.','warning','after-action'),
  TAX_CONFIGURATION_REQUIRED: copy('Completa la configuración de impuestos','Configura un impuesto predeterminado antes de continuar.','warning','after-action',go('Configurar impuestos',admin('taxes'))),
  TAX_PROFILE_REQUIRED: copy('Selecciona un impuesto','El producto necesita un perfil de impuestos activo.','warning','after-action',go('Configurar impuestos',admin('taxes'))),
  TIP_POLICY_NOT_DELEGATED: copy('Esta configuración se administra centralmente','La política actual no permite cambiar las propinas desde este restaurante.','info','contact-administrator'),
  TIP_PREFERENCES_OUTSIDE_POLICY: copy('Ajusta las opciones de propina','La selección local debe permanecer dentro de la política permitida.','warning','after-action',go('Revisar propinas',admin('tips'))),
  TIP_SELECTION_NOT_ALLOWED: copy('Esta propina no está permitida','Elige una opción admitida por la política actual.','warning','after-action',go('Revisar propinas',admin('tips'))),
  STATION_REQUIRED: copy('Configura una estación','Esta operación necesita una estación activa.','warning','after-action',go('Configurar estaciones',admin('stations'))),
  ZONE_REQUIRED: copy('Configura una zona','Crea una zona antes de agregar mesas.','warning','after-action',go('Configurar zonas y mesas',admin('zones-tables'))),
  DEVICE_NOT_AUTHORIZED: copy('Autoriza este dispositivo','Este equipo debe emparejarse antes de operar.','warning','after-action',go('Administrar dispositivos',system('devices'))),
  DEVICE_NOT_PAIRED: copy('Empareja este dispositivo','Inicia y completa una solicitud de emparejamiento.','warning','after-action',go('Administrar dispositivos',system('devices'))),
  DEVICE_REVOKED: copy('Dispositivo sin autorización','La autorización fue revocada. Debe iniciarse un emparejamiento nuevo.','error','after-action',go('Administrar dispositivos',system('devices'))),
  DEVICE_LIMIT_REACHED: copy('Límite de dispositivos alcanzado','Se alcanzó el límite de dispositivos activos para este tipo.','warning','contact-administrator'),
  PAIRING_CODE_INVALID: copy('Código incorrecto','El código de emparejamiento no es válido.','warning','retry'),
  PAIRING_EXPIRED: copy('Solicitud expirada','La solicitud de emparejamiento expiró. Genera una nueva desde el dispositivo.','warning','after-action',go('Administrar dispositivos',system('devices'))),
  PAIRING_ALREADY_CONSUMED: copy('Solicitud no disponible','La solicitud ya fue aprobada, cancelada o dejó de estar disponible.','warning','after-action',go('Administrar dispositivos',system('devices'))),
  BACKUP_DESTINATION_UNAVAILABLE: copy('Destino de respaldo no disponible','El destino externo no está disponible. Verifica la unidad o la ruta e inténtalo nuevamente.','error','retry',go('Revisar respaldo',system('backup-recovery'))),
  PERMISSION_DENIED: copy('No tienes permiso para esta acción','Solicita a un responsable un rol con el permiso necesario.','warning','contact-administrator'),
  LICENSE_CAPABILITY_DENIED: copy('Función no disponible en la licencia','La licencia actual no incluye esta capacidad. Contacta al administrador de la cuenta.','warning','contact-administrator'),
  LOCATION_LICENSE_REQUIRED: copy('Licencia requerida','La ubicación necesita una licencia válida para continuar.','critical','contact-administrator'),
  RECOVERY_REQUIRED: copy('La instalación requiere recuperación','La operación permanece bloqueada hasta validar una recuperación segura.','critical','after-action',go('Abrir recuperación',system('backup-recovery'))),
  STALE_ORDER_VERSION: copy('La venta cambió','Actualiza la venta para trabajar con su estado más reciente.','warning','retry'),
  ADMINISTRATION_VERSION_CONFLICT: copy('La configuración cambió','Actualiza la sección y vuelve a aplicar tu cambio sobre la versión vigente.','warning','retry'),
};

const transport: Record<Exclude<GuidanceCode, ErrorCode>, GuidanceCopy> = {
  EDGE_UNREACHABLE: copy('No hay conexión con la operación local','Verifica que el servicio local esté disponible y vuelve a intentar.','error','retry'),
  INVALID_EDGE_RESPONSE: copy('No pudimos interpretar la respuesta','Actualiza la pantalla. Si continúa, comparte la referencia de diagnóstico con soporte.','error','retry'),
  UNKNOWN_EDGE_ERROR: copy('No pudimos completar la operación','Vuelve a intentarlo. Si continúa, comparte la referencia de diagnóstico con soporte.','error','retry'),
};
const fallback = copy('No pudimos completar la operación','Vuelve a intentarlo. Si el problema continúa, contacta a soporte.','error','retry');

export function getUserGuidance(
  problem: {code?:string;details?:PublicErrorDetails|undefined} | string | null | undefined,
  override: UserGuidanceOverride = {},
): UserGuidance {
  const code = typeof problem === 'string' ? problem : problem?.code ?? 'UNKNOWN_ERROR';
  const base = ES_ERROR_GUIDANCE[code as ErrorCode] ?? transport[code as keyof typeof transport] ?? fallback;
  const {action:baseAction,...baseCopy}=base;
  const {action:overrideAction,...overrideCopy}=override;
  const action = overrideAction === null ? undefined : overrideAction ?? baseAction;
  const diagnosticReference = typeof problem === 'object' && problem?.details?.diagnosticId
    ? problem.details.diagnosticId : undefined;
  return {...baseCopy,...overrideCopy,code,...(action?{action}:{}),...(diagnosticReference?{diagnosticReference}:{})};
}
