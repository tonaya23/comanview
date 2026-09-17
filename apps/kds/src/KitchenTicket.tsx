import { useId } from 'react';
import type { KdsTicketResponse } from '@comanview/contracts';
import { formatElapsed, timerTone } from './kdsLogic.js';

export function nextKitchenAction(
  status: KdsTicketResponse['status'],
): 'PREPARING' | 'READY' | null {
  return status === 'PENDING' ? 'PREPARING' : status === 'PREPARING' ? 'READY' : null;
}
export function kitchenActionReason({
  busy,
  connected,
  authorized,
  stationAvailable,
}: {
  busy: boolean;
  connected: boolean;
  authorized: boolean;
  stationAvailable: boolean;
}): string | null {
  if (busy) return 'Espera la confirmación de la operación en curso.';
  if (!stationAvailable) return 'Selecciona una estación disponible antes de continuar.';
  if (!authorized)
    return 'Solo puedes consultar. Pide a un responsable permiso para actualizar preparación.';
  if (!connected) return 'Espera a recuperar la conexión local y actualizar las comandas.';
  return null;
}
export function KitchenTicket({
  ticket,
  now,
  reason,
  onTransition,
}: {
  ticket: KdsTicketResponse;
  now: number;
  reason: string | null;
  onTransition(target: 'PREPARING' | 'READY'): void;
}) {
  const labelId = useId(),
    reasonId = useId();
  const target = nextKitchenAction(ticket.status);
  const tone = timerTone(ticket.sentAt, ticket.status, ticket.readyAt, now);
  const urgency =
    ticket.status === 'READY'
      ? 'Preparación terminada'
      : tone === 'LATE'
        ? 'Demora alta'
        : tone === 'WARNING'
          ? 'Revisar espera'
          : 'En tiempo';
  return (
    <article
      className={`ticket timer-${tone.toLowerCase()}`}
      aria-labelledby={labelId}
      data-ticket-id={ticket.ticketId}
      tabIndex={-1}
    >
      <div className="ticket-heading">
        <div>
          <strong id={labelId}>Pedido {ticket.orderNumber}</strong>
          <span>
            Ronda {ticket.roundNumber} ·{' '}
            {
              { TABLE: 'Servicio de mesa', COUNTER: 'Mostrador', TAKEOUT: 'Para llevar' }[
                ticket.orderType
              ]
            }
          </span>
          <span>
            {{ PENDING: 'Pendiente', PREPARING: 'Preparando', READY: 'Listo' }[ticket.status]}
          </span>
        </div>
        <div className="ticket-clock">
          <time
            aria-label={`${ticket.status === 'READY' ? 'Tiempo de preparación' : 'Tiempo desde envío'} ${formatElapsed(ticket.sentAt, ticket.status, ticket.readyAt, now)}`}
          >
            {formatElapsed(ticket.sentAt, ticket.status, ticket.readyAt, now)}
          </time>
          <strong className="urgency">{urgency}</strong>
        </div>
      </div>
      <div className="items">
        {ticket.items.map((item) => (
          <div key={item.orderItemId} className="item">
            <h3>
              <b>{item.quantity}×</b> {item.productName}
            </h3>
            {item.modifiers.map((modifier) => (
              <div key={modifier.modifierOptionId} className="modifier">
                + {modifier.name}
              </div>
            ))}
            {item.specialInstructions && (
              <div className="instructions">
                <span>NOTA</span>
                {item.specialInstructions}
              </div>
            )}
          </div>
        ))}
      </div>
      {target && (
        <>
          <button
            className={`action ${target === 'PREPARING' ? 'start' : 'ready'}`}
            disabled={Boolean(reason)}
            aria-describedby={reason ? reasonId : undefined}
            aria-label={`${target === 'PREPARING' ? 'Comenzar preparación' : 'Marcar listo'} · Pedido ${ticket.orderNumber} · Ronda ${ticket.roundNumber}`}
            onClick={() => onTransition(target)}
          >
            {target === 'PREPARING' ? 'COMENZAR' : 'LISTO'}
          </button>
          {reason && (
            <p id={reasonId} className="action-reason">
              {reason}
            </p>
          )}
        </>
      )}
    </article>
  );
}
