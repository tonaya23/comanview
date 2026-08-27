import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CashSessionSchema,
  CashMovementSchema,
  CashReportSnapshotSchema,
  CashClosingPreviewSchema,
  CloseCashSessionResponseSchema,
  CurrentCashSessionSchema,
  CreateCashMovementRequestSchema,
  GenerateXReportRequestSchema,
  PreviewCashClosingRequestSchema,
  CloseCashSessionRequestSchema,
  OpenCashSessionRequestSchema,
  type OpenCashSessionRequest,
  type CreateCashMovementRequest,
  type GenerateXReportRequest,
  type PreviewCashClosingRequest,
  type CloseCashSessionRequest,
} from '@comanview/contracts';
import { CashService } from '../application/CashService.js';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { operationFrom } from '../../auth/http/AuthGuard.js';

export function cashRoutes(cashService: CashService, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/current',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_SESSION_VIEW),
        schema: { response: { 200: CurrentCashSessionSchema } },
      },
      async (_request, reply) => reply.send(cashService.getCurrentSession()),
    );

    fastify.post(
      '/',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_SESSION_OPEN),
        schema: {
          body: OpenCashSessionRequestSchema,
          response: { 201: CashSessionSchema, 200: CashSessionSchema },
        },
      },
      async (request, reply) => {
        const session = cashService.openSession(
          request.body as OpenCashSessionRequest,
          operationFrom(request, PERMISSIONS.CASH_SESSION_OPEN),
        );
        reply.status(201).send(session);
      },
    );

    fastify.post(
      '/current/movements',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_MOVEMENT_CREATE),
        schema: {
          body: CreateCashMovementRequestSchema,
          response: { 201: CashMovementSchema, 200: CashMovementSchema },
        },
      },
      async (request, reply) => {
        const movement = cashService.createMovement(
          request.body as CreateCashMovementRequest,
          operationFrom(request, PERMISSIONS.CASH_MOVEMENT_CREATE),
        );
        reply.status(201).send(movement);
      },
    );

    fastify.post(
      '/current/x-report',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_REPORT_X),
        schema: {
          body: GenerateXReportRequestSchema,
          response: { 201: CashReportSnapshotSchema, 200: CashReportSnapshotSchema },
        },
      },
      async (request, reply) => {
        const report = cashService.generateXReport(
          request.body as GenerateXReportRequest,
          operationFrom(request, PERMISSIONS.CASH_REPORT_X),
        );
        reply.status(201).send(report);
      },
    );

    fastify.post(
      '/current/close-preview',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_SESSION_CLOSE),
        schema: {
          body: PreviewCashClosingRequestSchema,
          response: { 200: CashClosingPreviewSchema },
        },
      },
      async (request, reply) =>
        reply.send(
          cashService.previewClose(
            request.body as PreviewCashClosingRequest,
            operationFrom(request, PERMISSIONS.CASH_SESSION_CLOSE),
          ),
        ),
    );

    fastify.post(
      '/current/close',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_SESSION_CLOSE),
        schema: {
          body: CloseCashSessionRequestSchema,
          response: { 200: CloseCashSessionResponseSchema },
        },
      },
      async (request, reply) =>
        reply.send(
          cashService.closeSession(
            request.body as CloseCashSessionRequest,
            operationFrom(request, PERMISSIONS.CASH_SESSION_CLOSE),
          ),
        ),
    );
  };
}
