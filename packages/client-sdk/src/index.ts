import {
  CategorySchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  OrderSchema,
  ProductSchema,
  CashSessionSchema,
  CurrentCashSessionSchema,
  PaymentConfigSchema,
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
  type PaymentConfigResponse,
  type CreatePaymentRequest,
  type VoidPaymentRequest,
  type CloseOrderRequest,
  type UpdateOrderItemSpecialInstructionsRequest,
} from '@comanview/contracts';

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export interface EdgeClientOptions {
  baseUrl?: string;
  fetch?: EdgeFetch;
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
  getCategories(): Promise<CategoryResponse[]>;
  getProducts(): Promise<ProductResponse[]>;
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
  sendRound(orderId: string, request: SendRoundRequest): Promise<OrderResponse>;
  getCurrentCashSession(): Promise<CurrentCashSessionResponse>;
  openCashSession(request: OpenCashSessionRequest): Promise<CashSessionResponse>;
  getPaymentConfig(): Promise<PaymentConfigResponse>;
  createPayment(orderId: string, request: CreatePaymentRequest): Promise<OrderResponse>;
  voidPayment(
    orderId: string,
    paymentId: string,
    request: VoidPaymentRequest,
  ): Promise<OrderResponse>;
  closeOrder(orderId: string, request: CloseOrderRequest): Promise<OrderResponse>;
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
  ): Promise<T> {
    let response: EdgeResponse;

    try {
      const requestInit: EdgeRequestInit = { ...init };
      if (init?.body) {
        requestInit.headers = { ...init.headers, 'content-type': 'application/json' };
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
    getHealth: () => request('/health', HealthResponseSchema),
    getCategories: () => request('/catalog/categories', CategorySchema.array()),
    getProducts: () => request('/catalog/products', ProductSchema.array()),
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
    sendRound: (orderId, body) =>
      request(`/orders/${orderId}/rounds`, OrderSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getCurrentCashSession: () => request('/cash-sessions/current', CurrentCashSessionSchema),
    openCashSession: (body) =>
      request('/cash-sessions', CashSessionSchema, {
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
  };
}
