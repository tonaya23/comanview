import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type {
  OrderResponse,
  PrintJobResponse,
  EffectiveCapabilitiesResponse,
} from '@comanview/contracts';
import {
  Button,
  Dialog,
  InlineAlert,
  ConfirmationDialog,
  TechnicalDetails,
  guidanceTone,
  type UserGuidance,
  type TypedNavigationTarget,
} from '@comanview/ui';
import { formatMoney } from './posLogic.js';

export type LocalConnection = 'CHECKING' | 'CONNECTED' | 'DISCONNECTED';
export function connectionPresentation(
  connection: LocalConnection,
  networkAvailable: boolean,
  degraded: boolean,
) {
  if (connection === 'DISCONNECTED')
    return {
      kind: 'local-unavailable',
      title: 'Sin conexión con la operación local',
      detail: 'No se pueden confirmar operaciones. Reconecta antes de volver a intentar.',
      tone: 'error' as const,
    };
  if (connection === 'CHECKING')
    return {
      kind: 'checking',
      title: 'Verificando conexión local',
      detail: 'Espera la confirmación del servicio local.',
      tone: 'info' as const,
    };
  if (degraded)
    return {
      kind: 'degraded',
      title: 'Conexión local con información pendiente',
      detail: 'No se pudo actualizar parte de la información. Revisa el aviso antes de operar.',
      tone: 'warning' as const,
    };
  if (!networkAvailable)
    return {
      kind: 'offline-operational',
      title: 'Operación local disponible',
      detail:
        'El navegador indica falta de red; el servicio local responde. La venta no depende de Internet.',
      tone: 'info' as const,
    };
  return {
    kind: 'connected',
    title: 'Conexión local disponible',
    detail: 'Las operaciones se confirman en este restaurante.',
    tone: 'success' as const,
  };
}
export function ConnectionStatus({
  connection,
  networkAvailable,
  degraded,
  onRetry,
}: {
  connection: LocalConnection;
  networkAvailable: boolean;
  degraded: boolean;
  onRetry(): void;
}) {
  const state = connectionPresentation(connection, networkAvailable, degraded);
  return (
    <div
      className={`pos-connection pos-connection--${state.tone}`}
      role="status"
      data-state={state.kind}
    >
      <details>
        <summary>{state.kind === 'local-unavailable' ? 'Sin conexión local' :
          state.kind === 'degraded' ? 'Información pendiente' :
          state.kind === 'checking' ? 'Verificando conexión' :
          state.kind === 'offline-operational' ? 'Local disponible · sin red' : 'Conexión local disponible'}</summary>
        <div className="pos-status-details">
        <strong>{state.title}</strong>
        <small>{state.detail}</small>
        {(connection === 'DISCONNECTED' || degraded) && (
        <Button type="button" variant="secondary" onClick={onRetry}>
          Revisar conexión
        </Button>
        )}
        </div>
      </details>
    </div>
  );
}
export function PosFeedback({
  message,
  guidance,
  success,
  onNavigate,
  canNavigate,
  onReview,
}: {
  message: string | null;
  guidance: UserGuidance | null;
  success?: string | null;
  onNavigate(target: TypedNavigationTarget): void;
  canNavigate(target: TypedNavigationTarget): boolean;
  onReview?(): void;
}) {
  if (!message && !success) return null;
  return (
    <InlineAlert
      tone={message ? (guidance ? guidanceTone(guidance) : 'error') : 'success'}
      {...(message && guidance ? { title: guidance.title } : {})}
      urgent={Boolean(message)}
    >
      <span>{message ?? success}</span>
      {message && guidance?.action && canNavigate(guidance.action.target) && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onNavigate(guidance.action!.target)}
        >
          {guidance.action.label}
        </Button>
      )}
      {message && guidance?.code === 'STALE_ORDER_VERSION' && onReview && (
        <Button type="button" variant="secondary" onClick={onReview}>
          Consultar venta actual
        </Button>
      )}
      {message && guidance?.diagnosticReference && (
        <TechnicalDetails>Referencia: {guidance.diagnosticReference}</TechnicalDetails>
      )}
    </InlineAlert>
  );
}
/** Describes existing disabling decisions; never decides whether a command is authorized. */
export function PosAction({
  reason,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { reason?: string | null }) {
  const id = useId();
  return (
    <div className="pos-action">
      <button
        {...props}
        aria-describedby={props.disabled && reason ? id : props['aria-describedby']}
      >
        {children}
      </button>
      {props.disabled && reason && <small id={id}>{reason}</small>}
    </div>
  );
}
export function PosDialog({
  title,
  busy,
  onClose,
  children,
  className = '',
}: {
  title: string;
  busy: boolean;
  onClose(): void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog
      open
      title={title}
      className={`pos-operational-dialog ${className}`}
      cancelable={!busy}
      onClose={onClose}
    >
      <Button
        type="button"
        variant="ghost"
        className="pos-dialog-close"
        aria-label={`Cerrar ${title}`}
        disabled={busy}
        onClick={onClose}
      >
        Cerrar
      </Button>
      {children}
    </Dialog>
  );
}
export function usePosConfirmation() {
  const [request, setRequest] = useState<{
    title: string;
    description: string;
    resolve(value: boolean): void;
  } | null>(null);
  const confirm = (title: string, description: string) =>
    new Promise<boolean>((resolve) => setRequest({ title, description, resolve }));
  return {
    confirm,
    confirmation: request && (
      <ConfirmationDialog
        open
        title={request.title}
        description={request.description}
        confirmLabel="Continuar"
        onConfirm={() => {
          setRequest(null);
          request.resolve(true);
        }}
        onClose={() => {
          setRequest(null);
          request.resolve(false);
        }}
      />
    ),
  };
}
export const paymentMethodLabel = (method: string) =>
  ({ CASH: 'Efectivo', CARD: 'Tarjeta', OTHER: 'Otro medio' })[method] ?? 'Otro medio';
export const paymentStatusLabel = (status: string) =>
  ({ COMPLETED: 'Confirmado', VOIDED: 'Anulado', PENDING: 'Pendiente', FAILED: 'No confirmado' })[
    status
  ] ?? 'Estado pendiente de revisión';
export const itemStatusLabel = (status: 'DRAFT' | 'SENT') =>
  status === 'DRAFT' ? 'Sin enviar' : 'Enviado · edición protegida';
export const licenseModeLabel = (mode: EffectiveCapabilitiesResponse['mode']) =>
  (
    ({
      FULL: 'Licencia activa',
      FULL_WITH_WARNING: 'Licencia con aviso',
      GRACE_OPERATING: 'Período de gracia',
      GUARANTEED_SHIFT: 'Turno protegido',
      PROTECTED_OPERATIONS: 'Solo ventas protegidas',
      GUARANTEED_SHIFT_RECOVERY: 'Recuperación del turno',
      SUSPENDED_BLOCKED: 'Licencia suspendida',
      TERMINATED_BLOCKED: 'Licencia terminada',
      POST_GRACE_BLOCKED: 'Período de gracia terminado',
      NO_VALID_LICENSE: 'Licencia pendiente de validación',
      CLOCK_SUSPECT: 'Revisión del reloj requerida',
    }) satisfies Record<EffectiveCapabilitiesResponse['mode'], string>
  )[mode];
export function PaymentSummary({
  order,
}: {
  order: Pick<OrderResponse, 'total' | 'paidAmount' | 'balanceDue'>;
}) {
  return (
    <dl className="pos-payment-summary" aria-label="Resumen de cobro">
      <div>
        <dt>Total de la venta</dt>
        <dd>{formatMoney(order.total.amount, order.total.currency)}</dd>
      </div>
      <div>
        <dt>Ya pagado</dt>
        <dd>{formatMoney(order.paidAmount.amount, order.paidAmount.currency)}</dd>
      </div>
      <div>
        <dt>Saldo pendiente</dt>
        <dd>{formatMoney(order.balanceDue.amount, order.balanceDue.currency)}</dd>
      </div>
    </dl>
  );
}
const printStatusLabel = (status: PrintJobResponse['status']) =>
  (
    ({
      PENDING: 'En cola',
      SENDING: 'Enviando a impresora',
      DELIVERED: 'Entregado al destino',
      CONFIRMED: 'Confirmado',
      FAILED: 'No se pudo imprimir',
      UNKNOWN: 'Resultado sin confirmar',
      CANCELLED: 'Impresión cancelada',
    }) satisfies Record<PrintJobResponse['status'], string>
  )[status];
const printTypeLabel = (kind: string) =>
  ({
    STATION_TICKET: 'Comanda',
    PRECHECK: 'Precuenta',
    CUSTOMER_RECEIPT: 'Recibo',
    X_REPORT: 'Corte X',
    Z_REPORT: 'Corte Z',
  })[kind] ?? 'Documento';
export function PrintingStatus({
  jobs,
  unavailable = false,
}: {
  jobs: PrintJobResponse[];
  unavailable?: boolean;
}) {
  if (!jobs.length && !unavailable) return null;
  const failed = jobs.some((job) => job.status === 'FAILED' || job.status === 'UNKNOWN');
  return (
    <section className="pos-print-status" aria-label="Estado de impresión">
      <InlineAlert
        tone={failed || unavailable ? 'warning' : 'info'}
        title={
          failed
            ? 'La impresión necesita atención'
            : unavailable
              ? 'Estado de impresión sin actualizar'
              : 'Impresión'
        }
      >
        <span>
          Una venta o ronda confirmada sigue registrada aunque el papel no salga. No repitas el
          envío para intentar imprimir.
        </span>
        {unavailable && <span>No se pudo consultar el estado reciente de la impresora.</span>}
      </InlineAlert>
      <details>
        <summary>Revisar impresión · {jobs.length} recientes</summary>
        <p>
          Comprueba papel, conexión y alimentación. Un resultado sin confirmar requiere revisar el
          papel antes de repetir cualquier operación.
        </p>
        <ul>
          {jobs.slice(0, 8).map((job) => (
            <li key={job.printJobId}>
              <strong>{printTypeLabel(job.jobType)}</strong>
              <span>{printStatusLabel(job.status)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
