import { useCallback, useEffect, useMemo, useState } from 'react';
import { createEdgeClient, EdgeClientError } from '@comanview/client-sdk';
import type { CategoryResponse, OrderResponse, ProductResponse } from '@comanview/contracts';
import {
  ALL_CATEGORIES,
  formatMoney,
  getErrorMessage,
  getVisibleCategories,
  getVisibleProducts,
} from './posLogic.js';

const edge = createEdgeClient({ baseUrl: import.meta.env['VITE_EDGE_API_URL'] ?? '/api' });
const currentOrderStorageKey = 'comanview.pos.currentOrderId';

type ConnectionState = 'CHECKING' | 'CONNECTED' | 'DISCONNECTED';

export function App() {
  const [connection, setConnection] = useState<ConnectionState>('CHECKING');
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(ALL_CATEGORIES);
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshConnection = useCallback(async () => {
    try {
      const health = await edge.getHealth();
      setConnection(health.status === 'UP' ? 'CONNECTED' : 'DISCONNECTED');
      return health.status === 'UP';
    } catch {
      setConnection('DISCONNECTED');
      return false;
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const [nextCategories, nextProducts] = await Promise.all([
        edge.getCategories(),
        edge.getProducts(),
      ]);
      setCategories(nextCategories);
      setProducts(nextProducts);
      setConnection('CONNECTED');
    } catch (catalogError) {
      if (catalogError instanceof EdgeClientError && catalogError.code === 'EDGE_UNREACHABLE') {
        setConnection('DISCONNECTED');
      }
      setError(getErrorMessage(catalogError));
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const restoreCurrentOrder = useCallback(async () => {
    const storedOrderId = window.localStorage.getItem(currentOrderStorageKey);
    if (!storedOrderId) return;

    try {
      setOrder(await edge.getOrder(storedOrderId));
    } catch (restoreError) {
      window.localStorage.removeItem(currentOrderStorageKey);
      if (!(restoreError instanceof EdgeClientError && restoreError.code === 'ORDER_NOT_FOUND')) {
        setError(getErrorMessage(restoreError));
      }
    }
  }, []);

  useEffect(() => {
    let wasConnected = false;

    const checkEdge = async () => {
      const connected = await refreshConnection();
      if (connected && !wasConnected) {
        wasConnected = true;
        await Promise.all([refreshCatalog(), restoreCurrentOrder()]);
      } else if (!connected) {
        wasConnected = false;
        setLoadingCatalog(false);
      }
    };

    void checkEdge();
    const healthTimer = window.setInterval(() => void checkEdge(), 5000);
    return () => window.clearInterval(healthTimer);
  }, [refreshCatalog, refreshConnection, restoreCurrentOrder]);

  const visibleCategories = useMemo(() => getVisibleCategories(categories), [categories]);
  const visibleProducts = useMemo(
    () => getVisibleProducts(products, selectedCategoryId),
    [products, selectedCategoryId],
  );
  const draftItems = order?.items.filter((item) => item.status === 'DRAFT') ?? [];
  const sentItems = order?.items.filter((item) => item.status === 'SENT') ?? [];

  const updateOrder = useCallback((nextOrder: OrderResponse) => {
    setOrder(nextOrder);
    window.localStorage.setItem(currentOrderStorageKey, nextOrder.id);
    setConnection('CONNECTED');
  }, []);

  async function runOrderMutation(
    actionName: string,
    mutation: () => Promise<OrderResponse>,
    successNotice: string,
  ) {
    setPendingAction(actionName);
    setError(null);
    setNotice(null);

    try {
      updateOrder(await mutation());
      setNotice(successNotice);
    } catch (mutationError) {
      if (mutationError instanceof EdgeClientError && mutationError.code === 'EDGE_UNREACHABLE') {
        setConnection('DISCONNECTED');
      }

      if (
        mutationError instanceof EdgeClientError &&
        mutationError.code === 'STALE_ORDER_VERSION' &&
        order
      ) {
        try {
          updateOrder(await edge.getOrder(order.id));
        } catch {
          // The original conflict remains the most actionable feedback.
        }
      }

      setError(getErrorMessage(mutationError));
    } finally {
      setPendingAction(null);
    }
  }

  async function createOrder() {
    if (order && order.items.length > 0) {
      const shouldReplace = window.confirm(
        'La venta actual permanecerá abierta en Edge. ¿Quieres iniciar otra venta?',
      );
      if (!shouldReplace) return;
    }

    const currency = products.find((product) => product.active)?.basePrice.currency ?? 'MXN';
    await runOrderMutation(
      'create-order',
      () => edge.createOrder({ orderType: 'COUNTER', channel: 'POS', currency }),
      'Venta creada y confirmada por Edge.',
    );
  }

  async function addProduct(product: ProductResponse) {
    if (!order) return;

    await runOrderMutation(
      `add-${product.id}`,
      () =>
        edge.addOrderItem(order.id, {
          commandId: window.crypto.randomUUID(),
          expectedVersion: order.version,
          productId: product.id,
        }),
      `${product.name} agregado a la venta.`,
    );
  }

  async function removeItem(itemId: string) {
    if (!order) return;

    await runOrderMutation(
      `remove-${itemId}`,
      () => edge.removeOrderItem(order.id, itemId, { expectedVersion: order.version }),
      'Producto retirado del borrador.',
    );
  }

  async function sendRound() {
    if (!order) return;

    await runOrderMutation(
      'send-round',
      () => edge.sendRound(order.id, { expectedVersion: order.version }),
      `Ronda ${order.rounds.length + 1} enviada y confirmada por Edge.`,
    );
  }

  async function retryConnection() {
    setError(null);
    setConnection('CHECKING');
    const connected = await refreshConnection();
    if (connected) {
      await Promise.all([refreshCatalog(), restoreCurrentOrder()]);
    }
  }

  const isBusy = pendingAction !== null;

  return (
    <div className="pos-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <div>
            <strong>ComanView</strong>
            <span>Point of Sale</span>
          </div>
        </div>

        <div className={`connection connection--${connection.toLowerCase()}`} role="status">
          <span className="connection-dot" aria-hidden="true" />
          <div>
            <strong>
              {connection === 'CONNECTED'
                ? 'Edge conectado'
                : connection === 'CHECKING'
                  ? 'Verificando Edge'
                  : 'Conexión local perdida'}
            </strong>
            <span>
              {connection === 'CONNECTED'
                ? 'Operación local disponible'
                : connection === 'CHECKING'
                  ? 'Un momento…'
                  : 'Las operaciones no pueden confirmarse'}
            </span>
          </div>
          {connection === 'DISCONNECTED' && (
            <button
              className="connection-retry"
              type="button"
              onClick={() => void retryConnection()}
            >
              Reintentar
            </button>
          )}
        </div>
      </header>

      {connection === 'DISCONNECTED' && (
        <div className="critical-banner" role="alert">
          <strong>Edge no está disponible.</strong> Puedes revisar la pantalla, pero ninguna venta
          se mostrará como confirmada hasta recuperar la conexión local.
        </div>
      )}

      {(error || notice) && (
        <div
          className={`feedback ${error ? 'feedback--error' : 'feedback--success'}`}
          role="status"
        >
          <span>{error ?? notice}</span>
          <button
            type="button"
            aria-label="Cerrar mensaje"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      <main className="workspace">
        <aside className="categories-panel" aria-label="Categorías">
          <div className="section-heading">
            <span className="eyebrow">Menú</span>
            <h1>Categorías</h1>
          </div>
          <nav className="category-list">
            <button
              type="button"
              className={
                selectedCategoryId === ALL_CATEGORIES ? 'category-button active' : 'category-button'
              }
              onClick={() => setSelectedCategoryId(ALL_CATEGORIES)}
            >
              <span>Todo</span>
              <small>{products.filter((product) => product.active).length}</small>
            </button>
            {visibleCategories.map((category) => (
              <button
                type="button"
                className={
                  selectedCategoryId === category.id ? 'category-button active' : 'category-button'
                }
                key={category.id}
                onClick={() => setSelectedCategoryId(category.id)}
              >
                <span>{category.name}</span>
                <small>
                  {
                    products.filter(
                      (product) => product.active && product.categoryId === category.id,
                    ).length
                  }
                </small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="products-panel" aria-labelledby="products-title">
          <div className="section-heading products-heading">
            <div>
              <span className="eyebrow">Catálogo local</span>
              <h2 id="products-title">
                {selectedCategoryId === ALL_CATEGORIES
                  ? 'Todos los productos'
                  : (visibleCategories.find((category) => category.id === selectedCategoryId)
                      ?.name ?? 'Productos')}
              </h2>
            </div>
            <span className="product-count">{visibleProducts.length} productos</span>
          </div>

          {loadingCatalog ? (
            <div className="empty-state" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <strong>Cargando catálogo desde Edge</strong>
              <p>Consultando la información local disponible.</p>
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                ◇
              </span>
              <strong>No hay productos en esta categoría</strong>
              <p>Prepara la base de desarrollo o selecciona otra categoría.</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshCatalog()}
              >
                Actualizar catálogo
              </button>
            </div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => {
                const disabled =
                  !product.available || !order || isBusy || connection !== 'CONNECTED';
                return (
                  <button
                    type="button"
                    className={`product-card ${!product.available ? 'product-card--unavailable' : ''}`}
                    key={product.id}
                    disabled={disabled}
                    onClick={() => void addProduct(product)}
                  >
                    <span className="product-card-accent" aria-hidden="true" />
                    <span className="product-name">{product.name}</span>
                    <span className="product-description">
                      {product.description || 'Producto del catálogo'}
                    </span>
                    <span className="product-footer">
                      <strong>
                        {formatMoney(product.basePrice.amount, product.basePrice.currency)}
                      </strong>
                      <span>
                        {product.available ? (order ? 'Agregar +' : 'Crea una venta') : 'Agotado'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="order-panel" aria-label="Venta actual">
          <div className="order-header">
            <div>
              <span className="eyebrow">Venta actual</span>
              <h2>{order ? 'Mostrador' : 'Sin venta abierta'}</h2>
              {order && (
                <span className="order-meta">
                  Versión {order.version} · {order.items.length}{' '}
                  {order.items.length === 1 ? 'producto' : 'productos'}
                </span>
              )}
            </div>
            <button
              type="button"
              className="new-order-button"
              disabled={isBusy || connection !== 'CONNECTED'}
              onClick={() => void createOrder()}
            >
              {pendingAction === 'create-order' ? 'Creando…' : order ? 'Nueva' : 'Crear venta'}
            </button>
          </div>

          {!order ? (
            <div className="order-empty">
              <span aria-hidden="true">＋</span>
              <strong>Inicia una venta de mostrador</strong>
              <p>Después podrás tocar los productos para agregarlos como DRAFT.</p>
              <button
                type="button"
                className="primary-button"
                disabled={isBusy || connection !== 'CONNECTED'}
                onClick={() => void createOrder()}
              >
                Crear venta COUNTER
              </button>
            </div>
          ) : (
            <>
              <div className="order-items">
                {order.items.length === 0 && (
                  <div className="order-empty compact">
                    <strong>La venta está vacía</strong>
                    <p>Selecciona un producto del catálogo.</p>
                  </div>
                )}

                {draftItems.length > 0 && (
                  <section className="item-group" aria-labelledby="draft-heading">
                    <div className="item-group-heading">
                      <h3 id="draft-heading">
                        <span className="status-dot status-dot--draft" />
                        Borrador
                      </h3>
                      <span>{draftItems.length} sin enviar</span>
                    </div>
                    {draftItems.map((item) => (
                      <article className="order-item order-item--draft" key={item.id}>
                        <div>
                          <strong>{item.productSnapshot.productName}</strong>
                          <span>DRAFT · aún no enviado</span>
                        </div>
                        <div className="order-item-actions">
                          <strong>
                            {formatMoney(
                              item.productSnapshot.basePrice.amount,
                              item.productSnapshot.basePrice.currency,
                            )}
                          </strong>
                          <button
                            type="button"
                            aria-label={`Eliminar ${item.productSnapshot.productName}`}
                            disabled={isBusy || connection !== 'CONNECTED'}
                            onClick={() => void removeItem(item.id)}
                          >
                            {pendingAction === `remove-${item.id}` ? '…' : 'Eliminar'}
                          </button>
                        </div>
                      </article>
                    ))}
                  </section>
                )}

                {sentItems.length > 0 && (
                  <section className="item-group" aria-labelledby="sent-heading">
                    <div className="item-group-heading">
                      <h3 id="sent-heading">
                        <span className="status-dot status-dot--sent" />
                        Enviado
                      </h3>
                      <span>{sentItems.length} confirmados</span>
                    </div>
                    {sentItems.map((item) => (
                      <article className="order-item order-item--sent" key={item.id}>
                        <div>
                          <strong>{item.productSnapshot.productName}</strong>
                          <span>SENT · historial protegido</span>
                        </div>
                        <strong>
                          {formatMoney(
                            item.productSnapshot.basePrice.amount,
                            item.productSnapshot.basePrice.currency,
                          )}
                        </strong>
                      </article>
                    ))}
                  </section>
                )}
              </div>

              <footer className="order-summary">
                <div className="round-summary">
                  <span>Rondas enviadas</span>
                  <strong>{order.rounds.length}</strong>
                </div>
                <div className="subtotal-row">
                  <div>
                    <span>Subtotal</span>
                    <small>Calculado por Edge</small>
                  </div>
                  <strong>{formatMoney(order.subtotal.amount, order.subtotal.currency)}</strong>
                </div>
                <button
                  type="button"
                  className="send-button"
                  disabled={draftItems.length === 0 || isBusy || connection !== 'CONNECTED'}
                  onClick={() => void sendRound()}
                >
                  <span>
                    {pendingAction === 'send-round' ? 'Enviando ronda…' : 'Enviar nueva ronda'}
                  </span>
                  <small>
                    {draftItems.length} {draftItems.length === 1 ? 'producto' : 'productos'} DRAFT
                  </small>
                </button>
              </footer>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
