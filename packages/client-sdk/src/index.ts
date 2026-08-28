import {
  CategorySchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  OrderSchema,
  ProductSchema,
  CashSessionSchema,
  CurrentCashSessionSchema,
  CashMovementSchema,
  CashReportSnapshotSchema,
  CashClosingPreviewSchema,
  CloseCashSessionResponseSchema,
  PaymentConfigSchema,
  PrintJobSchema,
  KdsStationSchema,
  KdsTicketSchema,
  LoginResponseSchema,
  CurrentSessionResponseSchema,
  LogoutResponseSchema,
  AuditListResponseSchema,
  RestaurantTableSchema,
  type AddOrderItemRequest,
  type CategoryResponse,
  type CreateOrderRequest,
  type HealthResponse,
  type OrderResponse,
  type ProductResponse,
  type RemoveOrderItemRequest,
  type SendRoundRequest,
  type CashSessionResponse,
  type CurrentCashSessionResponse,
  type OpenCashSessionRequest,
  type CreateCashMovementRequest,
  type CashMovementResponse,
  type GenerateXReportRequest,
  type CashReportSnapshotResponse,
  type PreviewCashClosingRequest,
  type CashClosingPreviewResponse,
  type CloseCashSessionRequest,
  type CloseCashSessionResponse,
  type PaymentConfigResponse,
  type CreatePaymentRequest,
  type VoidPaymentRequest,
  type CloseOrderRequest,
  type UpdateOrderItemSpecialInstructionsRequest,
  type UpdateDraftOrderItemConfigurationRequest,
  type PrintJobResponse,
  type RequestPrintJob,
  type KdsPreparationStatus,
  type KdsStationResponse,
  type KdsTicketResponse,
  type KdsTransitionRequest,
  type LoginRequest,
  type LoginResponse,
  type CurrentSessionResponse,
  type LogoutResponse,
  type AuditListQuery,
  type AuditListResponse,
  type RestaurantTableResponse,
  type UpdateOrderTablesRequest,
  type CancelEmptyTableOrderRequest,
  type RequestOrderPaymentRequest,
} from '@comanview/contracts';

export * from './cloudAdmin.js';

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export interface EdgeClientOptions {
  baseUrl?: string;
  fetch?: EdgeFetch;
  getAccessToken?: () => string | null;
}

export interface EdgeRequestInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface EdgeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type EdgeFetch = (input: string, init?: EdgeRequestInit) => Promise<EdgeResponse>;

export class EdgeClientError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, code: string, status: number | null, details?: unknown) {
    super(message);
    this.name = 'EdgeClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface EdgeClient {
  getHealth(): Promise<HealthResponse>;
  login(request: LoginRequest): Promise<LoginResponse>;
  getCurrentSession(): Promise<CurrentSessionResponse>;
  logout(): Promise<LogoutResponse>;
  getAuditEntries(query?: Partial<AuditListQuery>): Promise<AuditListResponse>;
  getCategories(): Promise<CategoryResponse[]>;
  getProducts(): Promise<ProductResponse[]>;
  getTables(): Promise<RestaurantTableResponse[]>;
  createOrder(request: CreateOrderRequest): Promise<OrderResponse>;
  getOrder(orderId: string): Promise<OrderResponse>;
  addOrderItem(orderId: string, request: AddOrderItemRequest): Promise<OrderResponse>;
  removeOrderItem(
    orderId: string,
    itemId: string,
    request: RemoveOrderItemRequest,
  ): Promise<OrderResponse>;
  updateOrderItemSpecialInstructions(
    orderId: string,
    itemId: string,
    request: UpdateOrderItemSpecialInstructionsRequest,
  ): Promise<OrderResponse>;
  updateDraftOrderItemConfiguration(
    orderId: string,
    itemId: string,
    request: UpdateDraftOrderItemConfigurationRequest,
  ): Promise<OrderResponse>;
  sendRound(orderId: string, request: SendRoundRequest): Promise<OrderResponse>;
  updateOrderTables(orderId: string, request: UpdateOrderTablesRequest): Promise<OrderResponse>;
  cancelEmptyTableOrder(
    orderId: string,
    request: CancelEmptyTableOrderRequest,
  ): Promise<OrderResponse>;
  requestOrderPayment(orderId: string, request: RequestOrderPaymentRequest): Promise<OrderResponse>;
  getCurrentCashSession(): Promise<CurrentCashSessionResponse>;
  openCashSession(request: OpenCashSessionRequest): Promise<CashSessionResponse>;
  createCashMovement(request: CreateCashMovementRequest): Promise<CashMovementResponse>;
  generateXReport(request: GenerateXReportRequest): Promise<CashReportSnapshotResponse>;
  previewCashClosing(request: PreviewCashClosingRequest): Promise<CashClosingPreviewResponse>;
  closeCashSession(request: CloseCashSessionRequest): Promise<CloseCashSessionResponse>;
  getPaymentConfig(): Promise<PaymentConfigResponse>;
  createPayment(orderId: string, request: CreatePaymentRequest): Promise<OrderResponse>;
  voidPayment(
    orderId: string,
    paymentId: string,
    request: VoidPaymentRequest,
  ): Promise<OrderResponse>;
  closeOrder(orderId: string, request: CloseOrderRequest): Promise<OrderResponse>;
  requestPrecheck(orderId: string, request: RequestPrintJob): Promise<PrintJobResponse>;
  requestCustomerReceipt(orderId: string, request: RequestPrintJob): Promise<PrintJobResponse>;
  getRecentPrintJobs(): Promise<PrintJobResponse[]>;
  getKdsStations(): Promise<KdsStationResponse[]>;
  getKdsTickets(stationId: string, status?: KdsPreparationStatus): Promise<KdsTicketResponse[]>;
  startKdsTicket(
    roundId: string,
    stationId: string,
    request: KdsTransitionRequest,
  ): Promise<KdsTicketResponse>;
  markKdsTicketReady(
    roundId: string,
    stationId: string,
    request: KdsTransitionRequest,
  ): Promise<KdsTicketResponse>;
}

export function createEdgeClient(options: EdgeClientOptions = {}): EdgeClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const fetchImplementation =
    options.fetch ?? (globalThis as typeof globalThis & { fetch?: EdgeFetch }).fetch;

  if (!fetchImplementation) {
    throw new Error('A fetch implementation is required');
  }
  const edgeFetch: EdgeFetch = fetchImplementation;

  async function request<T>(
    path: string,
    schema: RuntimeSchema<T>,
    init?: EdgeRequestInit,
    authenticated = true,
  ): Promise<T> {
    let response: EdgeResponse;

    try {
      const requestInit: EdgeRequestInit = { ...init };
      const accessToken = authenticated ? options.getAccessToken?.() : null;
      if (accessToken) {
        requestInit.headers = { ...requestInit.headers, authorization: `Bearer ${accessToken}` };
      }
      if (init?.body) {
        requestInit.headers = { ...requestInit.headers, 'content-type': 'application/json' };
      }
      response = await edgeFetch(`${baseUrl}${path}`, requestInit);
    } catch (error) {
      throw new EdgeClientError(
        'No fue posible conectar con ComanView Edge.',
        'EDGE_UNREACHABLE',
        null,
        error,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EdgeClientError(
        'Edge devolvió una respuesta que no se pudo interpretar.',
        'INVALID_EDGE_RESPONSE',
        response.status,
      );
    }

    if (!response.ok) {
      const parsedError = ErrorResponseSchema.safeParse(body);
      if (parsedError.success) {
        throw new EdgeClientError(
          parsedError.data.message,
          parsedError.data.error,
          response.status,
          parsedError.data.details,
        );
      }

      throw new EdgeClientError(
        'Edge rechazó la operación.',
        'UNKNOWN_EDGE_ERROR',
        response.status,
        body,
      );
    }

    try {
      return schema.parse(body);
    } catch (error) {
      throw new EdgeClientError(
        'Edge devolvió datos con un formato inesperado.',
        'INVALID_EDGE_RESPONSE',
        response.status,
        error,
      );
    }
  }

  return {
    getHealth: () => request('/health', HealthResponseSchema, undefined, false),
    login: (body) =>
      request(
        '/auth/login',
        LoginResponseSchema,
        { method: 'POST', body: JSON.stringify(body) },
        false,
      ),
    getCurrentSession: () => request('/auth/session', CurrentSessionResponseSchema),
    logout: () => request('/auth/logout', LogoutResponseSchema, { method: 'POST' }),
    getAuditEntries: (query = {}) => {
      const parameters = Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
      return request(`/audit${parameters ? `?${parameters}` : ''}`, AuditListResponseSchema);
    },
    getCategories: () => request('/catalog/categories', CategorySchema.array()),
    getProducts: () => request('/catalog/products', ProductSchema.array()),
    getTables: () => request('/tables', RestaurantTableSchema.array()),
    createOrder: (body) =>
      request('/orders', OrderSchema, { method: 'POST', body: JSON.stringify(body) }),
    getOrder: (orderId) => request(`/orders/${orderId}`, OrderSchema),
    addOrderItem: (orderId, body) =>
      request(`/orders/${orderId}/items`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    removeOrderItem: (orderId, itemId, body) =>
      request(`/orders/${orderId}/items/${itemId}`, OrderSchema, {
        method: 'DELETE',
        body: JSON.stringify(body),
      }),
    updateOrderItemSpecialInstructions: (orderId, itemId, body) =>
      request(`/orders/${orderId}/items/${itemId}/instructions`, OrderSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    updateDraftOrderItemConfiguration: (orderId, itemId, body) =>
      request(`/orders/${orderId}/items/${itemId}/configuration`, OrderSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    sendRound: (orderId, body) =>
      request(`/orders/${orderId}/rounds`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateOrderTables: (orderId, body) =>
      request(`/orders/${orderId}/tables`, OrderSchema, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    cancelEmptyTableOrder: (orderId, body) =>
      request(`/orders/${orderId}/cancel-empty`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    requestOrderPayment: (orderId, body) =>
      request(`/orders/${orderId}/payment-request`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getCurrentCashSession: () => request('/cash-sessions/current', CurrentCashSessionSchema),
    openCashSession: (body) =>
      request('/cash-sessions', CashSessionSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createCashMovement: (body) =>
      request('/cash-sessions/current/movements', CashMovementSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    generateXReport: (body) =>
      request('/cash-sessions/current/x-report', CashReportSnapshotSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    previewCashClosing: (body) =>
      request('/cash-sessions/current/close-preview', CashClosingPreviewSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    closeCashSession: (body) =>
      request('/cash-sessions/current/close', CloseCashSessionResponseSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getPaymentConfig: () => request('/payments/config', PaymentConfigSchema),
    createPayment: (orderId, body) =>
      request(`/orders/${orderId}/payments`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    voidPayment: (orderId, paymentId, body) =>
      request(`/orders/${orderId}/payments/${paymentId}/void`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    closeOrder: (orderId, body) =>
      request(`/orders/${orderId}/close`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    requestPrecheck: (orderId, body) =>
      request(`/orders/${orderId}/precheck`, PrintJobSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    requestCustomerReceipt: (orderId, body) =>
      request(`/orders/${orderId}/receipt`, PrintJobSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getRecentPrintJobs: () => request('/printing/jobs', PrintJobSchema.array()),
    getKdsStations: () => request('/kds/stations', KdsStationSchema.array()),
    getKdsTickets: (stationId, status) => {
      const query = `stationId=${encodeURIComponent(stationId)}${status ? `&status=${status}` : ''}`;
      return request(`/kds/tickets?${query}`, KdsTicketSchema.array());
    },
    startKdsTicket: (roundId, stationId, body) =>
      request(`/kds/tickets/${roundId}/${stationId}/preparing`, KdsTicketSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    markKdsTicketReady: (roundId, stationId, body) =>
      request(`/kds/tickets/${roundId}/${stationId}/ready`, KdsTicketSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };
}
