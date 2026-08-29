import {
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
  CloudTenantListResponseSchema,
  CanonicalCloudLocationListResponseSchema,
  ProvisionedEdgeListResponseSchema,
  GeneratedProvisioningCodeResponseSchema,
  InitiateEdgeReplacementResponseSchema,
  ProvisionedEdgeSchema,
  ProvisioningCodeSchema,
  CloudTenantSchema,
  CanonicalCloudLocationSchema,
  EdgeReplacementSchema,
  PendingEdgeReplacementResponseSchema,
  ErrorResponseSchema,
  type CloudAdminLoginRequest,
  type CloudAdminSessionResponse,
  type CloudCashMovement,
  type CloudCashSessionSummary,
  type CloudLocationOverview,
  type CloudLocationSummary,
  type CloudOrderDetail,
  type CloudOrderSummary,
  type CloudPaymentSummary,
  type CloudSaleSummary,
  type CloudTenant,
  type CanonicalCloudLocation,
  type ProvisionedEdge,
  type EdgeReplacement,
} from '@comanview/contracts';

interface Schema<T> { parse(value: unknown): T }
interface CloudAdminResponse { ok: boolean; status: number; json(): Promise<unknown> }
interface CloudAdminRequestInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  credentials?: 'include';
}
export type CloudAdminFetch = (
  input: string,
  init?: CloudAdminRequestInit,
) => Promise<CloudAdminResponse>;

export interface CloudAdminPage<T> { data: T[]; page: { nextCursor: string | null } }
export interface CloudAdminClientOptions { baseUrl?: string; fetch?: CloudAdminFetch }

export class CloudAdminClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CloudAdminClientError';
  }
}

export interface CloudAdminClient {
  login(input: CloudAdminLoginRequest): Promise<CloudAdminSessionResponse>;
  getSession(): Promise<CloudAdminSessionResponse>;
  logout(): Promise<{ revoked: true }>;
  getTenants(): Promise<{ data: CloudTenant[] }>;
  createTenant(input: { commandId: string; displayName: string; tenantId?: string }): Promise<CloudTenant>;
  getCanonicalLocations(tenantId: string): Promise<{ data: CanonicalCloudLocation[] }>;
  createLocation(tenantId: string, input: { commandId: string; displayName: string; timezone: string; locationId?: string }): Promise<CanonicalCloudLocation>;
  getEdges(locationId: string): Promise<{ data: ProvisionedEdge[] }>;
  generateProvisioningCode(locationId: string, commandId: string): Promise<{ code: string; expiresAt: string; provisioningCodeId: string }>;
  revokeProvisioningCode(codeId: string, commandId: string): Promise<unknown>;
  revokeEdge(edgeId: string, input: { commandId: string; reason: string }): Promise<ProvisionedEdge>;
  initiateReplacement(locationId: string, input: { commandId: string; oldEdgeId: string; reason: string }): Promise<{ replacementId: string; provisioningCode: { provisioningCodeId: string; code: string; expiresAt: string } }>;
  getPendingReplacement(locationId: string): Promise<{ replacement: EdgeReplacement | null }>;
  cancelReplacement(replacementId: string, input: { commandId: string; reason: string }): Promise<EdgeReplacement>;
  getLocations(query?: Record<string, string | number | undefined>): Promise<CloudAdminPage<CloudLocationSummary>>;
  getOverview(locationId: string, query?: Record<string, string | undefined>): Promise<CloudLocationOverview>;
  getOrders(locationId: string, query?: Record<string, string | number | undefined>): Promise<CloudAdminPage<CloudOrderSummary>>;
  getOrder(locationId: string, orderId: string): Promise<CloudOrderDetail>;
  getPayments(locationId: string, query?: Record<string, string | number | undefined>): Promise<CloudAdminPage<CloudPaymentSummary>>;
  getSales(locationId: string, query?: Record<string, string | number | undefined>): Promise<CloudAdminPage<CloudSaleSummary>>;
  getCashSessions(locationId: string, query?: Record<string, string | number | undefined>): Promise<CloudAdminPage<CloudCashSessionSummary>>;
  getCashMovements(locationId: string, cashSessionId: string, query?: Record<string, string | number | undefined>): Promise<CloudAdminPage<CloudCashMovement>>;
}

export function createCloudAdminClient(options: CloudAdminClientOptions = {}): CloudAdminClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const implementation = options.fetch ?? (globalThis as { fetch?: CloudAdminFetch }).fetch;
  if (!implementation) throw new Error('A fetch implementation is required');
  const cloudFetch = implementation;

  async function request<T>(path: string, schema: Schema<T>, init?: CloudAdminRequestInit): Promise<T> {
    let response: CloudAdminResponse;
    try {
      const requestInit: CloudAdminRequestInit = { ...init, credentials: 'include' };
      if (init?.body) requestInit.headers = { ...init.headers, 'content-type': 'application/json' };
      response = await cloudFetch(`${baseUrl}${path}`, requestInit);
    } catch (error) {
      throw new CloudAdminClientError('No fue posible conectar con ComanView Cloud.', 'CLOUD_UNREACHABLE', null, error);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new CloudAdminClientError('Cloud devolvió una respuesta inválida.', 'INVALID_CLOUD_RESPONSE', response.status); }
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(body);
      if (parsed.success) throw new CloudAdminClientError(parsed.data.message, parsed.data.error, response.status, parsed.data.details);
      throw new CloudAdminClientError('Cloud rechazó la operación.', 'UNKNOWN_CLOUD_ERROR', response.status, body);
    }
    try { return schema.parse(body); }
    catch (error) { throw new CloudAdminClientError('Cloud devolvió datos inesperados.', 'INVALID_CLOUD_RESPONSE', response.status, error); }
  }

  return {
    login: (input) => request('/admin/v1/auth/login', CloudAdminSessionResponseSchema, { method: 'POST', body: JSON.stringify(input) }),
    getSession: () => request('/admin/v1/auth/session', CloudAdminSessionResponseSchema),
    logout: () => request('/admin/v1/auth/logout', CloudAdminLogoutResponseSchema, { method: 'POST' }),
    getTenants: () => request('/admin/v1/tenants', CloudTenantListResponseSchema),
    createTenant: (input) => request('/admin/v1/tenants', CloudTenantSchema, { method: 'POST', body: JSON.stringify(input) }),
    getCanonicalLocations: (tenantId) => request(`/admin/v1/tenants/${tenantId}/locations`, CanonicalCloudLocationListResponseSchema),
    createLocation: (tenantId, input) => request(`/admin/v1/tenants/${tenantId}/locations`, CanonicalCloudLocationSchema, { method: 'POST', body: JSON.stringify(input) }),
    getEdges: (locationId) => request(`/admin/v1/locations/${locationId}/edges`, ProvisionedEdgeListResponseSchema),
    generateProvisioningCode: (locationId, commandId) => request(`/admin/v1/locations/${locationId}/provisioning-codes`, GeneratedProvisioningCodeResponseSchema, { method: 'POST', body: JSON.stringify({ commandId }) }),
    revokeProvisioningCode: (codeId, commandId) => request(`/admin/v1/provisioning-codes/${codeId}/revoke`, ProvisioningCodeSchema, { method: 'POST', body: JSON.stringify({ commandId }) }),
    revokeEdge: (edgeId, input) => request(`/admin/v1/edges/${edgeId}/revoke`, ProvisionedEdgeSchema, { method: 'POST', body: JSON.stringify(input) }),
    initiateReplacement: (locationId, input) => request(`/admin/v1/locations/${locationId}/replacements`, InitiateEdgeReplacementResponseSchema, { method: 'POST', body: JSON.stringify(input) }),
    getPendingReplacement: (locationId) => request(`/admin/v1/locations/${locationId}/replacements/pending`, PendingEdgeReplacementResponseSchema),
    cancelReplacement: (replacementId, input) => request(`/admin/v1/replacements/${replacementId}/cancel`, EdgeReplacementSchema, { method: 'POST', body: JSON.stringify(input) }),
    getLocations: (query) => request(`/admin/v1/locations${queryString(query)}`, CloudLocationListResponseSchema),
    getOverview: (locationId, query) => request(`/admin/v1/locations/${locationId}/overview${queryString(query)}`, CloudLocationOverviewSchema),
    getOrders: (locationId, query) => request(`/admin/v1/locations/${locationId}/orders${queryString(query)}`, CloudOrderListResponseSchema),
    getOrder: (locationId, orderId) => request(`/admin/v1/locations/${locationId}/orders/${orderId}`, CloudOrderDetailSchema),
    getPayments: (locationId, query) => request(`/admin/v1/locations/${locationId}/payments${queryString(query)}`, CloudPaymentListResponseSchema),
    getSales: (locationId, query) => request(`/admin/v1/locations/${locationId}/sales${queryString(query)}`, CloudSaleListResponseSchema),
    getCashSessions: (locationId, query) => request(`/admin/v1/locations/${locationId}/cash-sessions${queryString(query)}`, CloudCashSessionListResponseSchema),
    getCashMovements: (locationId, cashSessionId, query) => request(`/admin/v1/locations/${locationId}/cash-sessions/${cashSessionId}/movements${queryString(query)}`, CloudCashMovementListResponseSchema),
  };
}

function queryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  const values = Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return values.length ? `?${values.join('&')}` : '';
}
