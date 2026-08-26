import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createEdgeClient, EdgeClientError } from '@comanview/client-sdk';
import type {
  CashSessionResponse,
  CategoryResponse,
  OrderResponse,
  PaymentConfigResponse,
  PaymentMethod,
  ProductResponse,
  TipSelection,
} from '@comanview/contracts';
import {
  ALL_CATEGORIES,
  formatMoney,
  getErrorMessage,
  getLocalBusinessDate,
  getVisibleCategories,
  getVisibleProducts,
  minorUnitsToInput,
  parseMoneyInputToMinorUnits,
  percentageAmountHalfUp,
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
  const [cashSession, setCashSession] = useState<CashSessionResponse | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfigResponse | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showOpenCash, setShowOpenCash] = useState(false);
  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('0.00');
  const [cashTendered, setCashTendered] = useState('0.00');
  const [tipMode, setTipMode] = useState<'NONE' | 'PERCENTAGE' | 'FIXED_AMOUNT'>('NONE');
  const [tipBasisPoints, setTipBasisPoints] = useState(1000);
  const [fixedTip, setFixedTip] = useState('0.00');

  const updateOrder = useCallback((next: OrderResponse) => {
    setOrder(next);
    window.localStorage.setItem(currentOrderStorageKey, next.id);
    setConnection('CONNECTED');
  }, []);

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

  const refreshOperationalState = useCallback(async () => {
    try {
      const [nextCategories, nextProducts, currentCash, config] = await Promise.all([
        edge.getCategories(),
        edge.getProducts(),
        edge.getCurrentCashSession(),
        edge.getPaymentConfig(),
      ]);
      setCategories(nextCategories);
      setProducts(nextProducts);
      setCashSession(currentCash.session);
      setPaymentConfig(config);
      setConnection('CONNECTED');
    } catch (stateError) {
      if (stateError instanceof EdgeClientError && stateError.code === 'EDGE_UNREACHABLE')
        setConnection('DISCONNECTED');
      setError(getErrorMessage(stateError));
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const restoreCurrentOrder = useCallback(async () => {
    const id = window.localStorage.getItem(currentOrderStorageKey);
    if (!id) return;
    try {
      setOrder(await edge.getOrder(id));
    } catch (restoreError) {
      window.localStorage.removeItem(currentOrderStorageKey);
      if (!(restoreError instanceof EdgeClientError && restoreError.code === 'ORDER_NOT_FOUND'))
        setError(getErrorMessage(restoreError));
    }
  }, []);

  useEffect(() => {
    let wasConnected = false;
    const check = async () => {
      const connected = await refreshConnection();
      if (connected && !wasConnected) {
        wasConnected = true;
        await Promise.all([refreshOperationalState(), restoreCurrentOrder()]);
      } else if (!connected) {
        wasConnected = false;
        setLoadingCatalog(false);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshConnection, refreshOperationalState, restoreCurrentOrder]);

  const visibleCategories = useMemo(() => getVisibleCategories(categories), [categories]);
  const visibleProducts = useMemo(
    () => getVisibleProducts(products, selectedCategoryId),
    [products, selectedCategoryId],
  );
  const draftItems = order?.items.filter((item) => item.status === 'DRAFT') ?? [];
  const sentItems = order?.items.filter((item) => item.status === 'SENT') ?? [];
  const amountMinor = parseMoneyInputToMinorUnits(paymentAmount) ?? 0;
  const fixedTipMinor = parseMoneyInputToMinorUnits(fixedTip) ?? 0;
  const tipPreview =
    tipMode === 'PERCENTAGE'
      ? percentageAmountHalfUp(amountMinor, tipBasisPoints)
      : tipMode === 'FIXED_AMOUNT'
        ? fixedTipMinor
        : 0;
  const tenderedMinor = parseMoneyInputToMinorUnits(cashTendered) ?? 0;
  const changePreview = Math.max(0, tenderedMinor - amountMinor - tipPreview);
  const isBusy = pendingAction !== null;
  const canOperateOrder = order?.status === 'OPEN' && connection === 'CONNECTED' && !isBusy;

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  async function mutate(name: string, action: () => Promise<OrderResponse>, message: string) {
    setPendingAction(name);
    clearFeedback();
    try {
      const next = await action();
      updateOrder(next);
      setNotice(message);
      return next;
    } catch (problem) {
      if (problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE')
        setConnection('DISCONNECTED');
      if (problem instanceof EdgeClientError && problem.code === 'STALE_ORDER_VERSION' && order) {
        try {
          updateOrder(await edge.getOrder(order.id));
        } catch {
          /* original error is clearer */
        }
      }
      setError(getErrorMessage(problem));
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function createOrder() {
    if (
      order?.status === 'OPEN' &&
      order.items.length > 0 &&
      !window.confirm('La venta actual permanecerá abierta en Edge. ¿Quieres iniciar otra venta?')
    )
      return;
    const currency = products.find((product) => product.active)?.basePrice.currency ?? 'MXN';
    await mutate(
      'create-order',
      () => edge.createOrder({ orderType: 'COUNTER', channel: 'POS', currency }),
      'Nueva venta creada en Edge.',
    );
  }
  async function addProduct(product: ProductResponse) {
    if (!order) return;
    await mutate(
      `add-${product.id}`,
      () =>
        edge.addOrderItem(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
          productId: product.id,
        }),
      `${product.name} agregado.`,
    );
  }
  async function removeItem(itemId: string) {
    if (!order) return;
    await mutate(
      `remove-${itemId}`,
      () => edge.removeOrderItem(order.id, itemId, { expectedVersion: order.version }),
      'Producto retirado del borrador.',
    );
  }
  async function sendRound() {
    if (!order) return;
    await mutate(
      'send-round',
      () => edge.sendRound(order.id, { expectedVersion: order.version }),
      `Ronda ${order.rounds.length + 1} enviada a Edge.`,
    );
  }

  async function openCash(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoneyInputToMinorUnits(openingFloat);
    if (amount === null) {
      setError('Ingresa un fondo inicial válido, con máximo dos decimales.');
      return;
    }
    setPendingAction('open-cash');
    clearFeedback();
    try {
      const session = await edge.openCashSession({
        commandId: crypto.randomUUID(),
        openingFloatAmount: amount,
        businessDate: getLocalBusinessDate(),
      });
      setCashSession(session);
      setShowOpenCash(false);
      setNotice('Caja abierta y persistida en Edge.');
    } catch (problem) {
      setError(getErrorMessage(problem));
    } finally {
      setPendingAction(null);
    }
  }

  function beginPayment() {
    if (!order) return;
    const balance = minorUnitsToInput(order.balanceDue.amount);
    setPaymentAmount(balance);
    setCashTendered(balance);
    setTipMode('NONE');
    setShowPayment(true);
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    const applied = parseMoneyInputToMinorUnits(paymentAmount);
    const tendered = parseMoneyInputToMinorUnits(cashTendered);
    if (!applied || applied > order.balanceDue.amount) {
      setError('El monto debe ser mayor a cero y no superar el saldo pendiente.');
      return;
    }
    if (paymentMethod === 'CASH' && (tendered === null || tendered < applied + tipPreview)) {
      setError('El efectivo recibido debe cubrir el pago y la propina.');
      return;
    }
    let tip: TipSelection = { type: 'NONE' };
    if (tipMode === 'PERCENTAGE') tip = { type: 'PERCENTAGE', basisPoints: tipBasisPoints };
    if (tipMode === 'FIXED_AMOUNT') tip = { type: 'FIXED_AMOUNT', amount: fixedTipMinor };
    const next = await mutate(
      'payment',
      () =>
        edge.createPayment(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
          method: paymentMethod,
          amountApplied: applied,
          tip,
          cashTendered: paymentMethod === 'CASH' ? tendered : null,
        }),
      `${paymentMethod === 'CASH' ? 'Pago en efectivo' : 'Pago con tarjeta'} confirmado por Edge.`,
    );
    if (next) {
      setShowPayment(false);
      try {
        setCashSession((await edge.getCurrentCashSession()).session);
      } catch {
        /* payment remains confirmed */
      }
    }
  }

  async function closeOrder() {
    if (!order) return;
    if (draftItems.length > 0) {
      setError('Envía o elimina los productos pendientes antes de cerrar la venta.');
      return;
    }
    if (
      await mutate(
        'close-order',
        () =>
          edge.closeOrder(order.id, {
            commandId: crypto.randomUUID(),
            expectedVersion: order.version,
          }),
        'Venta cobrada y cerrada en Edge.',
      )
    )
      setShowPayment(false);
  }

  async function retryConnection() {
    clearFeedback();
    setConnection('CHECKING');
    if (await refreshConnection())
      await Promise.all([refreshOperationalState(), restoreCurrentOrder()]);
  }

  return (
    <div className="pos-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <strong>ComanView</strong>
            <span>Point of Sale</span>
          </div>
        </div>
        <div className="topbar-statuses">
          <button
            className={`cash-status ${cashSession ? 'cash-status--open' : ''}`}
            type="button"
            onClick={() => !cashSession && setShowOpenCash(true)}
          >
            <strong>{cashSession ? 'Caja abierta' : 'Caja cerrada'}</strong>
            <span>
              {cashSession
                ? `${cashSession.businessDate} · Esperado ${formatMoney(cashSession.expectedCash.amount, cashSession.expectedCash.currency)}`
                : 'Toca para abrir'}
            </span>
          </button>
          <div className={`connection connection--${connection.toLowerCase()}`} role="status">
            <span className="connection-dot" />
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
                  : 'Operaciones sin confirmar'}
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
        </div>
      </header>
      {connection === 'DISCONNECTED' && (
        <div className="critical-banner" role="alert">
          <strong>Edge no está disponible.</strong> Ninguna operación financiera se confirma sin la
          autoridad local.
        </div>
      )}
      {(error || notice) && (
        <div
          className={`feedback ${error ? 'feedback--error' : 'feedback--success'}`}
          role="status"
        >
          <span>{error ?? notice}</span>
          <button type="button" aria-label="Cerrar mensaje" onClick={clearFeedback}>
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
              <small>{products.filter((p) => p.active).length}</small>
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
                  {products.filter((p) => p.active && p.categoryId === category.id).length}
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
                  : (visibleCategories.find((c) => c.id === selectedCategoryId)?.name ??
                    'Productos')}
              </h2>
            </div>
            <span className="product-count">{visibleProducts.length} productos</span>
          </div>
          {loadingCatalog ? (
            <div className="empty-state">
              <span className="spinner" />
              <strong>Cargando catálogo desde Edge</strong>
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">◇</span>
              <strong>No hay productos disponibles</strong>
            </div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <button
                  type="button"
                  className={`product-card ${!product.available ? 'product-card--unavailable' : ''}`}
                  key={product.id}
                  disabled={!product.available || !canOperateOrder}
                  onClick={() => void addProduct(product)}
                >
                  <span className="product-card-accent" />
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
              ))}
            </div>
          )}
        </section>

        <aside className="order-panel" aria-label="Venta actual">
          <div className="order-header">
            <div>
              <span className="eyebrow">Venta actual</span>
              <h2>
                {order
                  ? order.status === 'CLOSED'
                    ? 'Venta cerrada'
                    : 'Mostrador'
                  : 'Sin venta abierta'}
              </h2>
              {order && (
                <span className="order-meta">
                  Versión {order.version} · {order.items.length} productos
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
              <span>＋</span>
              <strong>Inicia una venta de mostrador</strong>
              <p>Crea una Order local y agrega productos.</p>
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
                    <p>Selecciona un producto.</p>
                  </div>
                )}
                {draftItems.length > 0 && (
                  <section className="item-group">
                    <div className="item-group-heading">
                      <h3>
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
                            disabled={!canOperateOrder}
                            onClick={() => void removeItem(item.id)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </article>
                    ))}
                  </section>
                )}
                {sentItems.length > 0 && (
                  <section className="item-group">
                    <div className="item-group-heading">
                      <h3>
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
                {order.payments.length > 0 && (
                  <section className="payments-list">
                    <div className="item-group-heading">
                      <h3>Pagos</h3>
                      <span>{order.payments.length} registrados</span>
                    </div>
                    {order.payments.map((payment) => (
                      <div
                        className={`payment-row payment-row--${payment.status.toLowerCase()}`}
                        key={payment.id}
                      >
                        <div>
                          <strong>{payment.method}</strong>
                          <span>
                            {payment.status}
                            {payment.tipAmount.amount > 0
                              ? ` · Propina ${formatMoney(payment.tipAmount.amount, payment.tipAmount.currency)}`
                              : ''}
                          </span>
                        </div>
                        <strong>
                          {formatMoney(
                            payment.amountApplied.amount,
                            payment.amountApplied.currency,
                          )}
                        </strong>
                      </div>
                    ))}
                  </section>
                )}
              </div>
              <footer className="order-summary">
                <div className="round-summary">
                  <span>Rondas enviadas</span>
                  <strong>{order.rounds.length}</strong>
                </div>
                <div className="financial-lines">
                  <div>
                    <span>Total</span>
                    <strong>{formatMoney(order.total.amount, order.total.currency)}</strong>
                  </div>
                  <div>
                    <span>Pagado</span>
                    <strong>
                      {formatMoney(order.paidAmount.amount, order.paidAmount.currency)}
                    </strong>
                  </div>
                  <div className="balance-line">
                    <span>Saldo pendiente</span>
                    <strong>
                      {formatMoney(order.balanceDue.amount, order.balanceDue.currency)}
                    </strong>
                  </div>
                </div>
                {order.status === 'OPEN' && (
                  <div className="order-actions">
                    <button
                      type="button"
                      className="send-button"
                      disabled={draftItems.length === 0 || !canOperateOrder}
                      onClick={() => void sendRound()}
                    >
                      <span>{pendingAction === 'send-round' ? 'Enviando…' : 'Enviar ronda'}</span>
                      <small>{draftItems.length} DRAFT</small>
                    </button>
                    <button
                      type="button"
                      className="payment-button"
                      disabled={
                        order.balanceDue.amount === 0 ||
                        order.items.length === 0 ||
                        !canOperateOrder ||
                        !cashSession
                      }
                      onClick={beginPayment}
                    >
                      Cobrar
                    </button>
                    {order.balanceDue.amount === 0 && order.items.length > 0 && (
                      <>
                        <button
                          type="button"
                          className="close-order-button"
                          disabled={!canOperateOrder || draftItems.length > 0}
                          onClick={() => void closeOrder()}
                        >
                          {pendingAction === 'close-order' ? 'Cerrando…' : 'Cerrar venta'}
                        </button>
                        {draftItems.length > 0 && (
                          <p className="close-order-hint" role="status">
                            Envía o elimina los productos pendientes antes de cerrar la venta.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                {order.status === 'CLOSED' && (
                  <div className="closed-callout">✓ Venta cerrada y balanceada</div>
                )}
                {!cashSession && order.status === 'OPEN' && (
                  <button
                    type="button"
                    className="cash-required"
                    onClick={() => setShowOpenCash(true)}
                  >
                    Abre la caja para poder cobrar
                  </button>
                )}
              </footer>
            </>
          )}
        </aside>
      </main>

      {showOpenCash && (
        <div className="modal-backdrop">
          <section
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Inicio de turno</span>
                <h2 id="cash-title">Abrir caja</h2>
              </div>
              <button type="button" onClick={() => setShowOpenCash(false)}>
                ×
              </button>
            </div>
            <form onSubmit={(event) => void openCash(event)}>
              <label>
                Business date
                <input value={getLocalBusinessDate()} readOnly />
              </label>
              <label>
                Fondo inicial
                <input
                  inputMode="decimal"
                  value={openingFloat}
                  onChange={(event) => setOpeningFloat(event.target.value)}
                  autoFocus
                />
              </label>
              <p className="field-help">
                Se guarda en minor units exactos. El efectivo esperado parte de este fondo.
              </p>
              <button className="confirm-payment" disabled={isBusy} type="submit">
                {pendingAction === 'open-cash' ? 'Abriendo…' : 'Abrir CashSession'}
              </button>
            </form>
          </section>
        </div>
      )}

      {showPayment && order && (
        <div className="modal-backdrop">
          <section
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Cobro local</span>
                <h2 id="payment-title">Registrar pago</h2>
              </div>
              <button type="button" onClick={() => setShowPayment(false)}>
                ×
              </button>
            </div>
            <div className="payment-balance">
              <span>Saldo pendiente</span>
              <strong>{formatMoney(order.balanceDue.amount, order.balanceDue.currency)}</strong>
            </div>
            <form onSubmit={(event) => void submitPayment(event)}>
              <div className="method-selector">
                <button
                  type="button"
                  className={paymentMethod === 'CASH' ? 'active' : ''}
                  onClick={() => setPaymentMethod('CASH')}
                >
                  Efectivo
                </button>
                <button
                  type="button"
                  className={paymentMethod === 'CARD' ? 'active' : ''}
                  onClick={() => setPaymentMethod('CARD')}
                >
                  Tarjeta
                </button>
              </div>
              <label>
                Monto aplicado al consumo
                <input
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </label>
              {paymentConfig?.tipsEnabled && (
                <fieldset className="tip-options">
                  <legend>Propina separada</legend>
                  <button
                    type="button"
                    className={tipMode === 'NONE' ? 'active' : ''}
                    onClick={() => setTipMode('NONE')}
                  >
                    Sin propina
                  </button>
                  {paymentConfig.percentageOptionsBasisPoints.map((bps) => (
                    <button
                      type="button"
                      className={tipMode === 'PERCENTAGE' && tipBasisPoints === bps ? 'active' : ''}
                      key={bps}
                      onClick={() => {
                        setTipMode('PERCENTAGE');
                        setTipBasisPoints(bps);
                      }}
                    >
                      {bps / 100}%
                    </button>
                  ))}
                  <button
                    type="button"
                    className={tipMode === 'FIXED_AMOUNT' ? 'active' : ''}
                    onClick={() => setTipMode('FIXED_AMOUNT')}
                  >
                    Monto
                  </button>
                </fieldset>
              )}
              {tipMode === 'FIXED_AMOUNT' && (
                <label>
                  Propina fija
                  <input
                    inputMode="decimal"
                    value={fixedTip}
                    onChange={(event) => setFixedTip(event.target.value)}
                  />
                </label>
              )}
              {paymentConfig?.tipsEnabled && (
                <div className="calculation-row">
                  <span>Propina</span>
                  <strong>{formatMoney(tipPreview, order.currency)}</strong>
                </div>
              )}
              {paymentMethod === 'CASH' ? (
                <>
                  <label>
                    Efectivo recibido
                    <input
                      inputMode="decimal"
                      value={cashTendered}
                      onChange={(event) => setCashTendered(event.target.value)}
                    />
                  </label>
                  <div className="change-row">
                    <span>Cambio</span>
                    <strong>{formatMoney(changePreview, order.currency)}</strong>
                    <small>Edge confirma el valor definitivo</small>
                  </div>
                </>
              ) : (
                <div className="card-note">
                  <strong>Registro administrativo</strong>
                  <span>
                    Confirma que el datáfono aprobó el cargo. ComanView no controla la transacción
                    bancaria.
                  </span>
                </div>
              )}
              <button className="confirm-payment" disabled={isBusy} type="submit">
                {pendingAction === 'payment'
                  ? 'Confirmando con Edge…'
                  : `Registrar ${paymentMethod === 'CASH' ? 'efectivo' : 'tarjeta'}`}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
