import {
  AuditPersistenceError,
  CashRepository,
  PrintJobRepository,
  type CashFinancialSummary,
  type NewAuditEntry,
  type NewPrintJob,
} from '@comanview/database';
import { CashMovement, CashRegister, CashSession, EntityId } from '@comanview/domain';
import { Money } from '@comanview/money';
import type {
  CashClosingPreviewResponse,
  CashMovementResponse,
  CashReportSnapshotResponse,
  CashSessionResponse,
  CloseCashSessionRequest,
  CloseCashSessionResponse,
  CreateCashMovementRequest,
  CurrentCashSessionResponse,
  GenerateXReportRequest,
  OpenCashSessionRequest,
  PreviewCashClosingRequest,
} from '@comanview/contracts';
import type { CashReportPrintPayload } from '@comanview/printing';
import type { EdgeOperationalContext } from '../../../app/operationalContext.js';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';

const moneyJson = (money: Money) => money.toJSON();

export class CashService {
  constructor(
    private readonly cashRepo: CashRepository,
    private readonly printRepo: PrintJobRepository,
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
        blindCashCount: true,
        createdAt: new Date(),
      }),
    );
  }

  getCurrentSession(): CurrentCashSessionResponse {
    const session = this.cashRepo.getOpenSession(
      EntityId.fromString(this.context.cashRegisterId),
    );
    return { session: session ? this.mapSession(session) : null };
  }

  openSession(request: OpenCashSessionRequest, operation: AuthorizedOperation): CashSessionResponse {
    const existingForCommand = this.cashRepo.getSessionByCommandId(request.commandId);
    if (existingForCommand) {
      if (
        existingForCommand.openingFloat.amount !== request.openingFloatAmount ||
        existingForCommand.businessDate !== request.businessDate ||
        existingForCommand.openedBy.toString() !== operation.actor.userId
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

  createMovement(
    request: CreateCashMovementRequest,
    operation: AuthorizedOperation,
  ): CashMovementResponse {
    const existing = this.cashRepo.getMovementByCommandId(request.commandId);
    if (existing) {
      if (
        existing.type !== request.type ||
        existing.amount.amount !== request.amount ||
        existing.reason !== request.reason.trim() ||
        existing.actorUserId.toString() !== operation.actor.userId
      ) {
        throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used differently.');
      }
      const session = this.cashRepo.getSessionById(existing.cashSessionId);
      if (!session) throw new AppError('CASH_SESSION_NOT_OPEN', 409, 'CashSession not found.');
      return this.mapMovement(existing, this.cashRepo.calculateExpectedCash(session));
    }
    const session = this.requireOpenSession();
    const movement = CashMovement.create({
      cashSessionId: session.id,
      type: request.type,
      amount: Money.fromMinorUnits(request.amount, session.openingFloat.currency),
      reason: request.reason,
      actorUserId: EntityId.fromString(operation.actor.userId),
      commandId: request.commandId,
    });
    const eventId = EntityId.generate().toString();
    const audit = this.auditEntry(operation, {
      action: 'CASH_MOVEMENT_CREATED',
      entityType: 'CASH_MOVEMENT',
      entityId: movement.id.toString(),
      reason: movement.reason,
      commandId: movement.commandId,
      before: null,
      after: { type: movement.type, amount: movement.amount.toJSON() },
      amountAffected:
        movement.type === 'CASH_IN' ? movement.amount.amount : -movement.amount.amount,
      currency: movement.amount.currency,
      eventId,
    });
    try {
      this.cashRepo.saveMovement(movement, audit);
    } catch (error) {
      this.rethrowAuditFailure(error);
    }
    return this.mapMovement(movement, this.cashRepo.calculateExpectedCash(session));
  }

  generateXReport(
    request: GenerateXReportRequest,
    operation: AuthorizedOperation,
  ): CashReportSnapshotResponse {
    const existing = this.cashRepo.getReportByCommandId(request.commandId);
    if (existing) {
      if (existing.reportType !== 'X' || existing.generatedBy !== operation.actor.userId) {
        throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used differently.');
      }
      return existing.snapshot as CashReportSnapshotResponse;
    }
    const session = this.requireOpenSession();
    const generatedAt = new Date();
    const reportId = EntityId.generate().toString();
    const printJobId = EntityId.generate().toString();
    const report = this.buildReport(
      session,
      this.cashRepo.calculateFinancialSummary(session),
      'X',
      reportId,
      generatedAt,
      operation.actor.userId,
      null,
      printJobId,
    );
    const audit = this.auditEntry(operation, {
      action: 'CASH_X_REPORT_GENERATED',
      entityType: 'CASH_REPORT',
      entityId: reportId,
      reason: 'X report generated',
      commandId: request.commandId,
      before: null,
      after: { cashSessionId: session.id.toString(), expectedCash: report.expectedCash },
      amountAffected: null,
      currency: session.openingFloat.currency,
      eventId: null,
    });
    try {
      this.cashRepo.saveXReport({
        id: reportId,
        cashSessionId: session.id.toString(),
        snapshot: report,
        generatedAt,
        generatedBy: operation.actor.userId,
        commandId: request.commandId,
        audit,
        printJob: this.createReportPrintJob(report, request.commandId),
      });
    } catch (error) {
      this.rethrowAuditFailure(error);
    }
    return report;
  }

  previewClose(
    request: PreviewCashClosingRequest,
    _operation: AuthorizedOperation,
  ): CashClosingPreviewResponse {
    const session = this.requireOpenSession();
    this.assertNoPendingPayments(session);
    const counted = Money.fromMinorUnits(request.countedCashAmount, session.openingFloat.currency);
    const summary = this.cashRepo.calculateFinancialSummary(session);
    return {
      cashSessionId: session.id.toString(),
      cashRegisterId: session.cashRegisterId.toString(),
      businessDate: session.businessDate,
      currency: session.openingFloat.currency,
      openingFloat: moneyJson(session.openingFloat),
      salesByMethod: this.moneyRecord(summary.salesByMethod),
      tipsByMethod: this.moneyRecord(summary.tipsByMethod),
      paymentCountByMethod: summary.paymentCountByMethod,
      cashIn: moneyJson(summary.cashIn),
      cashOut: moneyJson(summary.cashOut),
      expectedCash: moneyJson(summary.expectedCash),
      countedCash: moneyJson(counted),
      difference: moneyJson(counted.subtract(summary.expectedCash)),
      voidCount: summary.voidCount,
      discountTotal: Money.zero(session.openingFloat.currency).toJSON(),
      compTotal: Money.zero(session.openingFloat.currency).toJSON(),
      openedAt: session.openedAt.toISOString(),
      openedBy: session.openedBy.toString(),
    };
  }

  closeSession(
    request: CloseCashSessionRequest,
    operation: AuthorizedOperation,
  ): CloseCashSessionResponse {
    const existing = this.cashRepo.getReportByCommandId(request.commandId);
    if (existing) {
      const report = existing.snapshot as CashReportSnapshotResponse;
      if (
        existing.reportType !== 'Z' ||
        report.countedCash?.amount !== request.countedCashAmount ||
        report.closedBy !== operation.actor.userId
      ) {
        throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used differently.');
      }
      const session = this.cashRepo.getSessionById(EntityId.fromString(existing.cashSessionId));
      if (!session) throw new AppError('CASH_SESSION_NOT_OPEN', 409, 'CashSession not found.');
      return { session: this.mapSession(session), report };
    }
    const session = this.requireOpenSession();
    this.assertNoPendingPayments(session);
    const summary = this.cashRepo.calculateFinancialSummary(session);
    session.close({
      countedCash: Money.fromMinorUnits(request.countedCashAmount, session.openingFloat.currency),
      expectedCash: summary.expectedCash,
      closedBy: EntityId.fromString(operation.actor.userId),
      commandId: request.commandId,
    });
    const reportId = EntityId.generate().toString();
    const printJobId = EntityId.generate().toString();
    const report = this.buildReport(
      session,
      summary,
      'Z',
      reportId,
      session.closedAt!,
      operation.actor.userId,
      session.countedCash,
      printJobId,
    );
    const eventId = EntityId.generate().toString();
    const audit = this.auditEntry(operation, {
      action: 'CASH_SESSION_CLOSED',
      entityType: 'CASH_SESSION',
      entityId: session.id.toString(),
      reason: 'CashSession Z closure',
      commandId: request.commandId,
      before: { status: 'OPEN' },
      after: {
        status: 'CLOSED',
        expectedCash: report.expectedCash,
        countedCash: report.countedCash,
        difference: report.difference,
      },
      amountAffected: report.difference?.amount ?? null,
      currency: session.openingFloat.currency,
      eventId,
    });
    try {
      this.cashRepo.closeSession({
        session,
        reportId,
        snapshot: report,
        audit,
        printJob: this.createReportPrintJob(report, request.commandId),
      });
    } catch (error) {
      this.rethrowAuditFailure(error);
    }
    return { session: this.mapSession(session), report };
  }

  private requireOpenSession(): CashSession {
    const session = this.cashRepo.getOpenSession(EntityId.fromString(this.context.cashRegisterId));
    if (!session) {
      throw new AppError('CASH_SESSION_NOT_OPEN', 409, 'No existe una CashSession OPEN.');
    }
    return session;
  }

  private assertNoPendingPayments(session: CashSession): void {
    if (this.cashRepo.hasPendingPayments(session.id.toString())) {
      throw new AppError(
        'CASH_SESSION_HAS_PENDING_PAYMENTS',
        409,
        'La CashSession tiene Payments PENDING y no puede cerrarse.',
      );
    }
  }

  private mapSession(session: CashSession): CashSessionResponse {
    const register = this.cashRepo.getRegister(session.cashRegisterId);
    const blindCashCount = register?.blindCashCount ?? true;
    return {
      id: session.id.toString(),
      cashRegisterId: session.cashRegisterId.toString(),
      status: session.status,
      openingFloat: session.openingFloat.toJSON(),
      expectedCash:
        session.status === 'CLOSED'
          ? (session.expectedCashAtClose?.toJSON() ?? null)
          : blindCashCount
            ? null
            : this.cashRepo.calculateExpectedCash(session).toJSON(),
      blindCashCount,
      businessDate: session.businessDate,
      openedAt: session.openedAt.toISOString(),
      openedBy: session.openedBy.toString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      closedBy: session.closedBy?.toString() ?? null,
      countedCash: session.countedCash?.toJSON() ?? null,
      expectedCashAtClose: session.expectedCashAtClose?.toJSON() ?? null,
      difference: session.difference?.toJSON() ?? null,
    };
  }

  private mapMovement(movement: CashMovement, expectedCash: Money): CashMovementResponse {
    return {
      id: movement.id.toString(),
      cashSessionId: movement.cashSessionId.toString(),
      type: movement.type,
      amount: movement.amount.toJSON(),
      reason: movement.reason,
      actorUserId: movement.actorUserId.toString(),
      occurredAt: movement.occurredAt.toISOString(),
      commandId: movement.commandId,
      expectedCash: expectedCash.toJSON(),
    };
  }

  private buildReport(
    session: CashSession,
    summary: CashFinancialSummary,
    reportType: 'X' | 'Z',
    reportId: string,
    generatedAt: Date,
    generatedBy: string,
    countedCash: Money | null,
    printJobId: string,
  ): CashReportSnapshotResponse {
    return {
      reportId,
      reportType,
      cashSessionId: session.id.toString(),
      cashRegisterId: session.cashRegisterId.toString(),
      businessDate: session.businessDate,
      currency: session.openingFloat.currency,
      openingFloat: moneyJson(session.openingFloat),
      salesByMethod: this.moneyRecord(summary.salesByMethod),
      tipsByMethod: this.moneyRecord(summary.tipsByMethod),
      paymentCountByMethod: summary.paymentCountByMethod,
      cashIn: moneyJson(summary.cashIn),
      cashOut: moneyJson(summary.cashOut),
      expectedCash: moneyJson(summary.expectedCash),
      countedCash: countedCash?.toJSON() ?? null,
      difference: countedCash?.subtract(summary.expectedCash).toJSON() ?? null,
      voidCount: summary.voidCount,
      discountTotal: Money.zero(session.openingFloat.currency).toJSON(),
      compTotal: Money.zero(session.openingFloat.currency).toJSON(),
      openedAt: session.openedAt.toISOString(),
      openedBy: session.openedBy.toString(),
      generatedAt: generatedAt.toISOString(),
      generatedBy,
      closedAt: reportType === 'Z' ? generatedAt.toISOString() : null,
      closedBy: reportType === 'Z' ? generatedBy : null,
      printJobId,
    };
  }

  private moneyRecord(values: Record<'CASH' | 'CARD' | 'OTHER', Money>) {
    return {
      CASH: values.CASH.toJSON(),
      CARD: values.CARD.toJSON(),
      OTHER: values.OTHER.toJSON(),
    };
  }

  private createReportPrintJob(
    report: CashReportSnapshotResponse,
    commandId: string,
  ): NewPrintJob {
    const target = this.printRepo.getDefaultTarget();
    const payload: CashReportPrintPayload = {
      kind: report.reportType === 'X' ? 'X_REPORT' : 'Z_REPORT',
      cashSessionId: report.cashSessionId,
      businessDate: report.businessDate,
      capturedAt: report.generatedAt,
      openingFloat: report.openingFloat,
      cashSales: report.salesByMethod.CASH,
      cardSales: report.salesByMethod.CARD,
      otherSales: report.salesByMethod.OTHER,
      cashTips: report.tipsByMethod.CASH,
      cardTips: report.tipsByMethod.CARD,
      otherTips: report.tipsByMethod.OTHER,
      cashIn: report.cashIn,
      cashOut: report.cashOut,
      expectedCash: report.expectedCash,
      countedCash: report.countedCash,
      difference: report.difference,
    };
    return {
      printJobId: report.printJobId!,
      tenantId: this.context.tenantId,
      locationId: this.context.locationId,
      orderId: null,
      cashSessionId: report.cashSessionId,
      roundId: null,
      stationId: null,
      targetId: target?.targetId ?? null,
      jobType: report.reportType === 'X' ? 'X_REPORT' : 'Z_REPORT',
      payload,
      createdAt: new Date(report.generatedAt),
      parentJobId: null,
      dedupeKey: `cash-report:${commandId}`,
    };
  }

  private auditEntry(
    operation: AuthorizedOperation,
    detail: Pick<
      NewAuditEntry,
      | 'action'
      | 'entityType'
      | 'entityId'
      | 'reason'
      | 'commandId'
      | 'before'
      | 'after'
      | 'amountAffected'
      | 'currency'
      | 'eventId'
    >,
  ): NewAuditEntry {
    return {
      auditId: EntityId.generate().toString(),
      occurredAt: operation.requestedAt,
      tenantId: operation.actor.tenantId,
      locationId: operation.actor.locationId,
      deviceId: operation.actor.deviceId,
      sessionId: operation.actor.sessionId,
      actorUserId: operation.actor.userId,
      actorRole: operation.actor.roles[0] ?? null,
      authorizedByUserId: operation.authorizedBy?.userId ?? null,
      authorizedByRole: operation.authorizedBy?.roles[0] ?? null,
      outcome: 'SUCCESS',
      ...detail,
    };
  }

  private rethrowAuditFailure(error: unknown): never {
    if (error instanceof AuditPersistenceError) {
      throw new AppError(
        'AUDIT_PERSISTENCE_FAILED',
        500,
        'The required audit record could not be persisted.',
      );
    }
    throw error;
  }
}
