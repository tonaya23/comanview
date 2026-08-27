import { CashRepository } from '@comanview/database';
import { CashRegister, CashSession, EntityId } from '@comanview/domain';
import { Money } from '@comanview/money';
import type {
  CashSessionResponse,
  CurrentCashSessionResponse,
  OpenCashSessionRequest,
} from '@comanview/contracts';
import type { EdgeOperationalContext } from '../../../app/operationalContext.js';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';

export class CashService {
  constructor(
    private readonly cashRepo: CashRepository,
    private readonly context: EdgeOperationalContext,
  ) {}

  ensureDefaultRegister(): void {
    this.cashRepo.saveRegister(
      new CashRegister({
        id: EntityId.fromString(this.context.cashRegisterId),
        tenantId: EntityId.fromString(this.context.tenantId),
        locationId: EntityId.fromString(this.context.locationId),
        name: 'Caja principal',
        currency: this.context.currency,
        active: true,
        createdAt: new Date(),
      }),
    );
  }

  getCurrentSession(): CurrentCashSessionResponse {
    const session = this.cashRepo.getOpenSession(EntityId.fromString(this.context.cashRegisterId));
    return { session: session ? this.mapSession(session) : null };
  }

  openSession(
    request: OpenCashSessionRequest,
    operation: AuthorizedOperation,
  ): CashSessionResponse {
    const existingForCommand = this.cashRepo.getSessionByCommandId(request.commandId);
    if (existingForCommand) {
      if (
        existingForCommand.openingFloat.amount !== request.openingFloatAmount ||
        existingForCommand.businessDate !== request.businessDate
      ) {
        throw new AppError(
          'COMMAND_ID_CONFLICT',
          409,
          'commandId was already used with different CashSession data.',
        );
      }
      return this.mapSession(existingForCommand);
    }

    const registerId = EntityId.fromString(this.context.cashRegisterId);
    if (this.cashRepo.getOpenSession(registerId)) {
      throw new AppError('CASH_SESSION_ALREADY_OPEN', 409, 'La caja ya tiene una sesión abierta.');
    }

    const session = CashSession.open({
      cashRegisterId: registerId,
      tenantId: EntityId.fromString(this.context.tenantId),
      locationId: EntityId.fromString(this.context.locationId),
      openingFloat: Money.fromMinorUnits(request.openingFloatAmount, this.context.currency),
      businessDate: request.businessDate,
      openedBy: EntityId.fromString(operation.actor.userId),
      commandId: request.commandId,
    });
    this.cashRepo.openSession(session);
    return this.mapSession(session);
  }

  private mapSession(session: CashSession): CashSessionResponse {
    return {
      id: session.id.toString(),
      cashRegisterId: session.cashRegisterId.toString(),
      status: session.status,
      openingFloat: session.openingFloat.toJSON(),
      expectedCash: this.cashRepo.calculateExpectedCash(session).toJSON(),
      businessDate: session.businessDate,
      openedAt: session.openedAt.toISOString(),
      openedBy: session.openedBy.toString(),
      closedAt: session.closedAt?.toISOString() ?? null,
    };
  }
}
