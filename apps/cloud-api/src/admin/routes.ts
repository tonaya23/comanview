import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLOUD_PERMISSIONS } from '@comanview/auth';
import type {
  CashMovementReadRecord,
  CashSessionReadRecord,
  CloudReadRepository,
  LocationOperationalRecord,
  OrderReadRecord,
  PageCursor,
  PaymentReadRecord,
  SaleReadRecord,
  ScopedLocation,
} from '@comanview/database';
import type { CloudAdminConfig } from '@comanview/config';
import {
  CloudAdminLoginRequestSchema,
  CloudAdminLogoutResponseSchema,
  CloudAdminSessionResponseSchema,
  CloudCashMovementListResponseSchema,
  CloudCashSessionListResponseSchema,
  CloudLocationListResponseSchema,
  CloudLocationOverviewSchema,
  CloudOrderDetailSchema,
  CloudOrderListResponseSchema,
  CloudPaymentListResponseSchema,
  CloudSaleListResponseSchema,
} from '@comanview/contracts';
import { CloudError } from '../app/CloudError.js';
import {
  CloudAdminAuthService,
  accessScope,
  requireCloudPermission,
  type CloudAdminPrincipal,
} from './CloudAdminAuthService.js';
import { evaluateEdgeStatus } from './edgeStatus.js';

const COOKIE_NAME = 'comanview_cloud_admin_session';
const UuidParamsSchema = z.object({ locationId: z.string().uuid() });
const OrderParamsSchema = UuidParamsSchema.extend({ orderId: z.string().uuid() });
const CashSessionParamsSchema = UuidParamsSchema.extend({ cashSessionId: z.string().uuid() });
const TimestampCursorSchema = z.object({
  kind: z.literal('timestamp'),
  timestamp: z.string().datetime(),
  id: z.string().uuid(),
});
const LocationCursorSchema = z.object({ kind: z.literal('location'), id: z.string().uuid() });
const BaseListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().min(1).optional(),
});
const UtcRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export interface CloudAdminRouteDependencies {
  auth: CloudAdminAuthService;
  read: Pick<CloudReadRepository, keyof CloudReadRepository>;
  config: CloudAdminConfig;
  now?: () => Date;
}

export function registerCloudAdminRoutes(
  app: FastifyInstance,
  dependencies: CloudAdminRouteDependencies,
): void {
  const now = dependencies.now ?? (() => new Date());

  app.post('/admin/v1/auth/login', async (request, reply) => {
    assertCloudAdminSameOrigin(request);
    const input = CloudAdminLoginRequestSchema.parse(request.body);
    const result = await dependencies.auth.login(input.email, input.password);
    reply.header('set-cookie', sessionCookie(result.token, dependencies.config));
    return CloudAdminSessionResponseSchema.parse(principalResponse(result.principal));
  });

  app.get('/admin/v1/auth/session', async (request) => {
    const principal = await authenticateCloudAdmin(request, dependencies.auth);
    return CloudAdminSessionResponseSchema.parse(principalResponse(principal));
  });

  app.post('/admin/v1/auth/logout', async (request, reply) => {
    assertCloudAdminSameOrigin(request);
    await dependencies.auth.logout(readCloudAdminCookie(request));
    reply.header('set-cookie', clearSessionCookie(dependencies.config));
    return CloudAdminLogoutResponseSchema.parse({ revoked: true });
  });

  app.get('/admin/v1/locations', async (request) => {
    const principal = await authenticateCloudAdmin(request, dependencies.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    const query = BaseListQuerySchema.extend({ status: z.enum(['ONLINE', 'OFFLINE', 'DEGRADED']).optional() })
      .parse(request.query);
    let after = query.cursor ? decodeLocationCursor(query.cursor) : undefined;
    const matches: ReturnType<typeof locationResponse>[] = [];
    let exhausted = false;
    while (matches.length <= query.limit && !exhausted) {
      const page = await dependencies.read.listLocations({
        scope: accessScope(principal),
        afterLocationId: after,
        limit: 100,
        lagCutoff: new Date(now().getTime() - dependencies.config.projectionLagThresholdMs),
      });
      for (const item of page.data) {
        const response = locationResponse(item, now(), dependencies.config);
        if (!query.status || response.edgeStatus === query.status) matches.push(response);
        after = item.locationId;
        if (matches.length > query.limit) break;
      }
      exhausted = !page.hasMore;
    }
    const data = matches.slice(0, query.limit);
    return CloudLocationListResponseSchema.parse({
      data,
      page: {
        nextCursor:
          matches.length > query.limit && data.length > 0
            ? encodeCursor({ kind: 'location', id: data[data.length - 1]!.locationId })
            : null,
      },
    });
  });

  app.get('/admin/v1/locations/:locationId/overview', async (request) => {
    const principal = await authenticateCloudAdmin(request, dependencies.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_OPERATIONAL_VIEW);
    const { locationId } = UuidParamsSchema.parse(request.params);
    const query = UtcRangeSchema.parse(request.query);
    const current = now();
    const to = query.to ? new Date(query.to) : current;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 86_400_000);
    assertRange(from, to);
    const record = await scopedLocation(dependencies, principal, locationId, current);
    const location = asScope(record);
    const canViewFinancial = principal.permissions.includes(CLOUD_PERMISSIONS.CLOUD_FINANCIAL_VIEW);
    const [orderCounts, recentOrders, completeSalesTotals, incompleteSaleCount, cashSession] =
      await Promise.all([
        dependencies.read.getOrderCounts(location),
        dependencies.read.listOrders({ location, limit: 5 }),
        canViewFinancial
          ? dependencies.read.getCompleteSalesTotals(location, from, to)
          : Promise.resolve([]),
        canViewFinancial
          ? dependencies.read.countIncompleteSales(location, from, to)
          : Promise.resolve(0),
        canViewFinancial
          ? dependencies.read.getCurrentOrLatestCashSession(location)
          : Promise.resolve(null),
      ]);
    return CloudLocationOverviewSchema.parse({
      location: locationResponse(record, current, dependencies.config),
      orderCounts,
      recentOrders: recentOrders.data.map(orderResponse),
      financial: canViewFinancial
        ? {
            completeSalesTotals,
            incompleteSaleCount,
            cashSession: cashSession ? cashSessionResponse(cashSession) : null,
          }
        : null,
      range: { from: from.toISOString(), to: to.toISOString() },
    });
  });

  app.get('/admin/v1/locations/:locationId/orders', async (request) => {
    const principal = await authenticateCloudAdmin(request, dependencies.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_OPERATIONAL_VIEW);
    const { locationId } = UuidParamsSchema.parse(request.params);
    const query = BaseListQuerySchema.merge(UtcRangeSchema).extend({
      status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(),
      orderType: z.enum(['COUNTER', 'TABLE', 'TAKEOUT']).optional(),
      orderChannel: z.enum(['POS', 'WAITER']).optional(),
    }).parse(request.query);
    const location = asScope(await scopedLocation(dependencies, principal, locationId, now()));
    const result = await dependencies.read.listOrders({
      location, limit: query.limit, cursor: decodeOptionalTimestampCursor(query.cursor),
      status: query.status, orderType: query.orderType, orderChannel: query.orderChannel,
      from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined,
    });
    return CloudOrderListResponseSchema.parse(listResponse(result, orderResponse, (item) => item.createdAt, (item) => item.orderId));
  });

  app.get('/admin/v1/locations/:locationId/orders/:orderId', async (request) => {
    const principal = await authenticateCloudAdmin(request, dependencies.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_OPERATIONAL_VIEW);
    const { locationId, orderId } = OrderParamsSchema.parse(request.params);
    const location = asScope(await scopedLocation(dependencies, principal, locationId, now()));
    const order = await dependencies.read.getOrder(location, orderId);
    if (!order) throw notFound();
    const canViewFinancial = principal.permissions.includes(CLOUD_PERMISSIONS.CLOUD_FINANCIAL_VIEW);
    const [payments, sale] = canViewFinancial
      ? await Promise.all([
          dependencies.read.getPaymentsForOrder(location, orderId),
          dependencies.read.getSaleForOrder(location, orderId),
        ])
      : [[], null];
    return CloudOrderDetailSchema.parse({
      order: orderResponse(order),
      financial: canViewFinancial
        ? { payments: payments.map(paymentResponse), sale: sale ? saleResponse(sale) : null }
        : null,
    });
  });

  app.get('/admin/v1/locations/:locationId/payments', async (request) => {
    const principal = await authenticateFinancial(request, dependencies.auth);
    const { locationId } = UuidParamsSchema.parse(request.params);
    const query = BaseListQuerySchema.merge(UtcRangeSchema).extend({
      status: z.enum(['COMPLETED', 'VOIDED']).optional(),
      method: z.enum(['CASH', 'CARD', 'OTHER']).optional(),
      orderId: z.string().uuid().optional(),
    }).parse(request.query);
    const location = asScope(await scopedLocation(dependencies, principal, locationId, now()));
    const result = await dependencies.read.listPayments({
      location, limit: query.limit, cursor: decodeOptionalTimestampCursor(query.cursor),
      status: query.status, method: query.method, orderId: query.orderId,
      from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined,
    });
    return CloudPaymentListResponseSchema.parse(listResponse(result, paymentResponse, (item) => item.completedAt, (item) => item.paymentId));
  });

  app.get('/admin/v1/locations/:locationId/sales', async (request) => {
    const principal = await authenticateFinancial(request, dependencies.auth);
    const { locationId } = UuidParamsSchema.parse(request.params);
    const query = BaseListQuerySchema.merge(UtcRangeSchema).extend({
      completenessStatus: z.enum(['COMPLETE', 'INCOMPLETE']).optional(),
      currency: z.string().length(3).optional(),
    }).parse(request.query);
    const location = asScope(await scopedLocation(dependencies, principal, locationId, now()));
    const result = await dependencies.read.listSales({
      location, limit: query.limit, cursor: decodeOptionalTimestampCursor(query.cursor),
      completenessStatus: query.completenessStatus, currency: query.currency,
      from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined,
    });
    return CloudSaleListResponseSchema.parse(listResponse(result, saleResponse, (item) => item.closedAt, (item) => item.orderId));
  });

  app.get('/admin/v1/locations/:locationId/cash-sessions', async (request) => {
    const principal = await authenticateFinancial(request, dependencies.auth);
    const { locationId } = UuidParamsSchema.parse(request.params);
    const query = BaseListQuerySchema.merge(UtcRangeSchema).extend({
      status: z.enum(['OPEN', 'CLOSED']).optional(),
      businessDate: z.string().date().optional(),
    }).parse(request.query);
    const location = asScope(await scopedLocation(dependencies, principal, locationId, now()));
    const result = await dependencies.read.listCashSessions({
      location, limit: query.limit, cursor: decodeOptionalTimestampCursor(query.cursor),
      status: query.status, businessDate: query.businessDate,
      from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined,
    });
    return CloudCashSessionListResponseSchema.parse(listResponse(result, cashSessionResponse, (item) => item.openedAt, (item) => item.cashSessionId));
  });

  app.get('/admin/v1/locations/:locationId/cash-sessions/:cashSessionId/movements', async (request) => {
    const principal = await authenticateFinancial(request, dependencies.auth);
    const { locationId, cashSessionId } = CashSessionParamsSchema.parse(request.params);
    const query = BaseListQuerySchema.parse(request.query);
    const location = asScope(await scopedLocation(dependencies, principal, locationId, now()));
    if (!(await dependencies.read.getCashSession(location, cashSessionId))) throw notFound();
    const result = await dependencies.read.listCashMovements({
      location, cashSessionId, limit: query.limit, cursor: decodeOptionalTimestampCursor(query.cursor),
    });
    return CloudCashMovementListResponseSchema.parse(listResponse(result, cashMovementResponse, (item) => item.occurredAt, (item) => item.cashMovementId));
  });
}

export async function authenticateCloudAdmin(request: FastifyRequest, auth: CloudAdminAuthService) {
  return auth.authenticateToken(readCloudAdminCookie(request));
}

async function authenticateFinancial(request: FastifyRequest, auth: CloudAdminAuthService) {
  const principal = await authenticateCloudAdmin(request, auth);
  requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_FINANCIAL_VIEW);
  return principal;
}

async function scopedLocation(
  dependencies: CloudAdminRouteDependencies,
  principal: CloudAdminPrincipal,
  locationId: string,
  current: Date,
) {
  const record = await dependencies.read.getLocation(
    locationId,
    accessScope(principal),
    new Date(current.getTime() - dependencies.config.projectionLagThresholdMs),
  );
  if (!record) throw notFound();
  return record;
}

function locationResponse(record: LocationOperationalRecord, now: Date, config: CloudAdminConfig) {
  return {
    tenantId: record.tenantId, locationId: record.locationId, edgeId: record.edgeId,
    edgeStatus: record.edgeId ? evaluateEdgeStatus(record, now, config.heartbeatStaleThresholdMs) : 'UNPROVISIONED',
    lastSeenAt: iso(record.lastSeenAt), reportedAt: iso(record.reportedAt),
    edgeVersion: record.edgeVersion, schemaVersion: record.schemaVersion,
    pendingEventCount: record.pendingEventCount,
    projectionHealth: {
      degraded: record.activeDeadLetterCount > 0 || record.stalledEventCount > 0 ||
        record.incompleteSaleCount > 0 || record.checkpointDegraded,
      activeDeadLetterCount: record.activeDeadLetterCount,
      stalledEventCount: record.stalledEventCount,
      incompleteSaleCount: record.incompleteSaleCount,
      lastEventReceivedAt: iso(record.lastEventReceivedAt),
      lastProjectionProcessedAt: iso(record.lastProjectionProcessedAt),
    },
  };
}

function orderResponse(record: OrderReadRecord) {
  return { ...record, createdAt: record.createdAt.toISOString(), closedAt: iso(record.closedAt),
    cancelledAt: iso(record.cancelledAt), paymentRequestedAt: iso(record.paymentRequestedAt) };
}
function paymentResponse(record: PaymentReadRecord) {
  return { ...record, completedAt: record.completedAt.toISOString(), voidedAt: iso(record.voidedAt) };
}
function saleResponse(record: SaleReadRecord) {
  return { ...record, closedAt: record.closedAt.toISOString() };
}
function cashSessionResponse(record: CashSessionReadRecord) {
  return { ...record, openedAt: record.openedAt.toISOString(), closedAt: iso(record.closedAt) };
}
function cashMovementResponse(record: CashMovementReadRecord) {
  return { ...record, occurredAt: record.occurredAt.toISOString() };
}

function listResponse<T, R>(
  result: { data: T[]; hasMore: boolean },
  mapper: (item: T) => R,
  timestamp: (item: T) => Date,
  id: (item: T) => string,
) {
  const data = result.data.map(mapper);
  const last = result.data[result.data.length - 1];
  return {
    data,
    page: {
      nextCursor: result.hasMore && last
        ? encodeCursor({
            kind: 'timestamp',
            timestamp: timestamp(last).toISOString(),
            id: id(last),
          })
        : null,
    },
  };
}

function principalResponse(principal: CloudAdminPrincipal) {
  return {
    user: {
      id: principal.userId, email: principal.email, displayName: principal.displayName,
      role: principal.role, permissions: principal.permissions, tenantGrants: principal.tenantGrants,
    },
    session: {
      id: principal.session.id, createdAt: principal.session.createdAt.toISOString(),
      lastActivityAt: principal.session.lastActivityAt.toISOString(),
      expiresAt: principal.session.expiresAt.toISOString(),
    },
  };
}

export function readCloudAdminCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const item of header.split(';')) {
    const [name, ...parts] = item.trim().split('=');
    if (name === COOKIE_NAME) {
      try { return decodeURIComponent(parts.join('=')); }
      catch { return null; }
    }
  }
  return null;
}

function sessionCookie(token: string, config: CloudAdminConfig): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/admin/v1; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}${config.secureCookie ? '; Secure' : ''}`;
}
function clearSessionCookie(config: CloudAdminConfig): string {
  return `${COOKIE_NAME}=; Path=/admin/v1; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookie ? '; Secure' : ''}`;
}

export function assertCloudAdminSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  if (!origin) {
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      throw new CloudError('CLOUD_ADMIN_ORIGIN_FORBIDDEN', 403, 'Cross-origin request is forbidden.');
    }
    return;
  }
  const host = request.headers.host;
  try {
    const parsedOrigin = new URL(origin);
    const parsedHost = new URL(`${parsedOrigin.protocol}//${host ?? ''}`);
    if (!host || parsedOrigin.host !== parsedHost.host) throw new Error('origin mismatch');
  } catch {
    throw new CloudError('CLOUD_ADMIN_ORIGIN_FORBIDDEN', 403, 'Cross-origin request is forbidden.');
  }
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function decodeLocationCursor(value: string): string {
  try { return LocationCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))).id; }
  catch { throw new CloudError('INVALID_CURSOR', 422, 'Pagination cursor is invalid.'); }
}
function decodeOptionalTimestampCursor(value?: string): PageCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = TimestampCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return { timestamp: new Date(parsed.timestamp), id: parsed.id };
  } catch { throw new CloudError('INVALID_CURSOR', 422, 'Pagination cursor is invalid.'); }
}
function assertRange(from: Date, to: Date): void {
  if (from >= to) throw new CloudError('INVALID_TIME_RANGE', 422, 'UTC range must have from before to.');
}
function asScope(record: LocationOperationalRecord): ScopedLocation {
  if (!record.edgeId) throw new CloudError('CLOUD_LOCATION_UNPROVISIONED', 409, 'Location does not have an ACTIVE Edge yet.');
  return { tenantId: record.tenantId, locationId: record.locationId, edgeId: record.edgeId };
}
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
function notFound(): CloudError { return new CloudError('CLOUD_RESOURCE_NOT_FOUND', 404, 'Resource was not found.'); }
