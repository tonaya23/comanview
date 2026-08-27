import type { Order, Round } from '@comanview/domain';
import type { KdsTransitionTarget } from '@comanview/domain';
import type {
  KdsPreparationStatus,
  KdsStationResponse,
  KdsTicketResponse,
  KdsTransitionRequest,
} from '@comanview/contracts';
import { KdsRepository, type KdsTicketView } from '@comanview/database';
import { AppError } from '../../../app/errorHandler.js';
import type { RealtimeHub } from '../../../infrastructure/realtime/RealtimeHub.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';

function mapTicket(ticket: KdsTicketView): KdsTicketResponse {
  return {
    ...ticket,
    sentAt: ticket.sentAt.toISOString(),
    preparingAt: ticket.preparingAt?.toISOString() ?? null,
    readyAt: ticket.readyAt?.toISOString() ?? null,
  };
}

export class KdsService {
  constructor(
    private readonly repository: KdsRepository,
    private readonly realtime: RealtimeHub,
  ) {}

  listStations(): KdsStationResponse[] {
    return this.repository.listStations();
  }

  listTickets(stationId: string, status?: KdsPreparationStatus): KdsTicketResponse[] {
    return this.repository.listTickets(stationId, status).map(mapTicket);
  }

  transition(
    roundId: string,
    stationId: string,
    target: KdsTransitionTarget,
    request: KdsTransitionRequest,
    operation: AuthorizedOperation,
  ): KdsTicketResponse {
    void operation;
    const expectedEvent = `KDS_TICKET_${target}`;
    if (this.repository.hasProcessedCommand(request.commandId)) {
      const result = this.repository.getCommandResult(request.commandId);
      if (
        result?.eventType === expectedEvent &&
        result.roundId === roundId &&
        result.stationId === stationId
      ) {
        return mapTicket(this.requireTicket(roundId, stationId));
      }
      throw new AppError(
        'COMMAND_ID_CONFLICT',
        409,
        'commandId was already used for a different operation.',
      );
    }

    this.requireTicket(roundId, stationId);
    const changed = this.repository.transitionTicket(roundId, stationId, target, request.commandId);
    const ticket = this.requireTicket(roundId, stationId);
    if (changed) {
      this.realtime.publish({
        type: 'KDS_TICKETS_CHANGED',
        stationIds: [stationId],
        reason: target,
        occurredAt: new Date().toISOString(),
      });
    }
    return mapTicket(ticket);
  }

  notifyRoundSent(order: Order, round: Round): void {
    const stationIds = [
      ...new Set(
        order.items
          .filter((item) => item.roundId?.equals(round.id) && item.snapshot.stationId)
          .map((item) => item.snapshot.stationId!.toString()),
      ),
    ];
    if (stationIds.length === 0) return;
    this.realtime.publish({
      type: 'KDS_TICKETS_CHANGED',
      stationIds,
      reason: 'ROUND_SENT',
      occurredAt: new Date().toISOString(),
    });
  }

  private requireTicket(roundId: string, stationId: string): KdsTicketView {
    const ticket = this.repository.getTicket(roundId, stationId);
    if (!ticket) {
      throw new AppError(
        'KDS_TICKET_NOT_FOUND',
        404,
        `KDS ticket for Round ${roundId} and station ${stationId} was not found.`,
      );
    }
    return ticket;
  }
}
