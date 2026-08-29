import { z } from 'zod';

export const CloudPermissionSchema = z.enum([
  'CLOUD_LOCATION_VIEW',
  'CLOUD_OPERATIONAL_VIEW',
  'CLOUD_FINANCIAL_VIEW',
  'CLOUD_TENANT_READ_ALL',
  'CLOUD_TENANT_CREATE',
  'CLOUD_LOCATION_CREATE',
  'CLOUD_EDGE_PROVISION',
  'CLOUD_EDGE_REVOKE',
  'CLOUD_EDGE_REPLACE',
  'CLOUD_ADMIN_AUDIT_VIEW',
]);
export const CloudAdminRoleSchema = z.enum(['PLATFORM_ADMIN', 'PLATFORM_ADMIN_READ', 'SUPPORT_READ']);
export const CloudEdgeStatusSchema = z.enum(['ONLINE', 'OFFLINE', 'DEGRADED', 'UNPROVISIONED']);
export const CloudProjectionHealthSchema = z.object({
  degraded: z.boolean(),
  activeDeadLetterCount: z.number().int().nonnegative(),
  stalledEventCount: z.number().int().nonnegative(),
  incompleteSaleCount: z.number().int().nonnegative(),
  lastEventReceivedAt: z.string().datetime().nullable(),
  lastProjectionProcessedAt: z.string().datetime().nullable(),
});

export const CloudAdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  role: CloudAdminRoleSchema,
  permissions: z.array(CloudPermissionSchema),
  tenantGrants: z.array(z.string().uuid()),
});
export const CloudAdminSessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const CloudAdminLoginRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
});
export const CloudAdminSessionResponseSchema = z.object({
  user: CloudAdminUserSchema,
  session: CloudAdminSessionSchema,
});
export const CloudAdminLogoutResponseSchema = z.object({ revoked: z.literal(true) });

export const CloudPageSchema = z.object({ nextCursor: z.string().nullable() });
const TimestampSchema = z.string().datetime();
const NullableTimestampSchema = TimestampSchema.nullable();
const MoneyAmountSchema = z.number().int().safe();

export const CloudLocationSummarySchema = z.object({
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid().nullable(),
  edgeStatus: CloudEdgeStatusSchema,
  lastSeenAt: NullableTimestampSchema,
  reportedAt: NullableTimestampSchema,
  edgeVersion: z.string().nullable(),
  schemaVersion: z.string().nullable(),
  pendingEventCount: z.number().int().nonnegative().nullable(),
  projectionHealth: CloudProjectionHealthSchema,
});

export const CloudOrderSummarySchema = z.object({
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
  orderId: z.string().uuid(),
  orderType: z.string(),
  orderChannel: z.string(),
  status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']),
  tableIds: z.array(z.string().uuid()),
  paymentRequestedAt: NullableTimestampSchema,
  itemCount: z.number().int().nonnegative(),
  sentItemCount: z.number().int().nonnegative(),
  paidAmount: MoneyAmountSchema,
  tipAmount: MoneyAmountSchema,
  currency: z.string().nullable(),
  createdAt: TimestampSchema,
  closedAt: NullableTimestampSchema,
  cancelledAt: NullableTimestampSchema,
});

export const CloudPaymentSummarySchema = z.object({
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
  paymentId: z.string().uuid(),
  orderId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  method: z.enum(['CASH', 'CARD', 'OTHER']),
  amountApplied: MoneyAmountSchema.nonnegative(),
  tipAmount: MoneyAmountSchema.nonnegative(),
  currency: z.string(),
  status: z.enum(['COMPLETED', 'VOIDED']),
  completedAt: TimestampSchema,
  voidedAt: NullableTimestampSchema,
});

export const CloudSaleSummarySchema = z.object({
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
  orderId: z.string().uuid(),
  saleAmount: MoneyAmountSchema.nonnegative(),
  tipAmount: MoneyAmountSchema.nonnegative(),
  chargedTotal: MoneyAmountSchema.nonnegative(),
  currency: z.string().nullable(),
  completenessStatus: z.enum(['COMPLETE', 'INCOMPLETE']),
  closedAt: TimestampSchema,
});

export const CloudCashSessionSummarySchema = z.object({
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  businessDate: z.string(),
  currency: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  openingFloatAmount: MoneyAmountSchema.nonnegative(),
  cashInAmount: MoneyAmountSchema.nonnegative(),
  cashOutAmount: MoneyAmountSchema.nonnegative(),
  expectedCashAmount: MoneyAmountSchema.nullable(),
  countedCashAmount: MoneyAmountSchema.nullable(),
  differenceAmount: MoneyAmountSchema.nullable(),
  openedAt: TimestampSchema,
  closedAt: NullableTimestampSchema,
  closedBy: z.string().uuid().nullable(),
});

export const CloudCashMovementSchema = z.object({
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
  cashMovementId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  movementType: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: MoneyAmountSchema.nonnegative(),
  currency: z.string(),
  reason: z.string(),
  actorUserId: z.string().uuid(),
  occurredAt: TimestampSchema,
});

export const CloudFinancialTotalSchema = z.object({
  currency: z.string(),
  saleAmount: MoneyAmountSchema.nonnegative(),
  tipAmount: MoneyAmountSchema.nonnegative(),
  chargedTotal: MoneyAmountSchema.nonnegative(),
});
export const CloudOrderCountsSchema = z.object({
  open: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
export const CloudLocationOverviewSchema = z.object({
  location: CloudLocationSummarySchema,
  orderCounts: CloudOrderCountsSchema,
  financial: z
    .object({
      completeSalesTotals: z.array(CloudFinancialTotalSchema),
      incompleteSaleCount: z.number().int().nonnegative(),
      cashSession: CloudCashSessionSummarySchema.nullable(),
    })
    .nullable(),
  recentOrders: z.array(CloudOrderSummarySchema),
  range: z.object({ from: TimestampSchema, to: TimestampSchema }),
});
export const CloudOrderDetailSchema = z.object({
  order: CloudOrderSummarySchema,
  financial: z
    .object({ payments: z.array(CloudPaymentSummarySchema), sale: CloudSaleSummarySchema.nullable() })
    .nullable(),
});

export const CloudLocationListResponseSchema = z.object({
  data: z.array(CloudLocationSummarySchema),
  page: CloudPageSchema,
});
export const CloudOrderListResponseSchema = z.object({
  data: z.array(CloudOrderSummarySchema),
  page: CloudPageSchema,
});
export const CloudPaymentListResponseSchema = z.object({
  data: z.array(CloudPaymentSummarySchema),
  page: CloudPageSchema,
});
export const CloudSaleListResponseSchema = z.object({
  data: z.array(CloudSaleSummarySchema),
  page: CloudPageSchema,
});
export const CloudCashSessionListResponseSchema = z.object({
  data: z.array(CloudCashSessionSummarySchema),
  page: CloudPageSchema,
});
export const CloudCashMovementListResponseSchema = z.object({
  data: z.array(CloudCashMovementSchema),
  page: CloudPageSchema,
});

export type CloudPermissionCode = z.infer<typeof CloudPermissionSchema>;
export type CloudAdminRoleCode = z.infer<typeof CloudAdminRoleSchema>;
export type CloudAdminLoginRequest = z.infer<typeof CloudAdminLoginRequestSchema>;
export type CloudAdminSessionResponse = z.infer<typeof CloudAdminSessionResponseSchema>;
export type CloudLocationSummary = z.infer<typeof CloudLocationSummarySchema>;
export type CloudLocationOverview = z.infer<typeof CloudLocationOverviewSchema>;
export type CloudOrderSummary = z.infer<typeof CloudOrderSummarySchema>;
export type CloudOrderDetail = z.infer<typeof CloudOrderDetailSchema>;
export type CloudPaymentSummary = z.infer<typeof CloudPaymentSummarySchema>;
export type CloudSaleSummary = z.infer<typeof CloudSaleSummarySchema>;
export type CloudCashSessionSummary = z.infer<typeof CloudCashSessionSummarySchema>;
export type CloudCashMovement = z.infer<typeof CloudCashMovementSchema>;
