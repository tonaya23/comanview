import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createEdgeClient, EdgeClientError, clearDevicePairing, createClientDevicePairing, createDeviceIdentity,
  getDeviceOnboardingState, loadDeviceIdentity, loadDevicePairing, markDeviceAuthorizationStatus,
  requestPairingWithIdentityRotation, saveDeviceIdentity, saveDevicePairing,
  type ClientDeviceIdentity, type ClientDevicePairing } from '@comanview/client-sdk';
import { DeviceOnboardingCard } from '@comanview/ui';
import {
  PermissionCodes,
  OperationalRealtimeMessageSchema,
  type AuthUserResponse,
  type CategoryResponse,
  type OrderResponse,
  type ProductResponse,
  type RestaurantTableResponse,
} from '@comanview/contracts';
import {
  activeModifierGroups,
  emptyTableCancellationBlocker,
  modifierSelectionError,
  money,
  visibleProducts,
  waiterError,
  tableStatusLabel,
} from './waiterLogic.js';

const tokenKey = 'comanview.waiter.sessionToken';
const edge = createEdgeClient({
  baseUrl: '/api',
  getAccessToken: () => window.localStorage.getItem(tokenKey),
});

interface ConfigurationState {
  product: ProductResponse;
  editingItemId: string | null;
  selectedModifierIds: string[];
  specialInstructions: string;
}

export function App() {
  const [user, setUser] = useState<AuthUserResponse | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [deviceIdentity,setDeviceIdentity]=useState<ClientDeviceIdentity|null>(null);
  const [pairing,setPairing]=useState<ClientDevicePairing|null>(null);
  const [pairingDisplayName,setPairingDisplayName]=useState('Waiter');
  const [pairingPending,setPairingPending]=useState(false);
  const [tables, setTables] = useState<RestaurantTableResponse[]>([]);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [configuration, setConfiguration] = useState<ConfigurationState | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [cancelTableOpen, setCancelTableOpen] = useState(false);
  const [cancelTableError, setCancelTableError] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<'CONNECTED' | 'DISCONNECTED'>('CONNECTED');
  const orderRef = useRef(order);
  orderRef.current = order;

  const clearSession = useCallback(() => {
    window.localStorage.removeItem(tokenKey);
    setUser(null);
    setOrder(null);
    setTables([]);
  }, []);
  useEffect(()=>{void loadDeviceIdentity().then(async(v)=>{const identity=v??createDeviceIdentity('WAITER','Waiter');if(!v)await saveDeviceIdentity(identity);setDeviceIdentity(identity);setPairingDisplayName(identity.displayName);});},[]);
  useEffect(()=>{void loadDevicePairing().then(value=>{if(value)setPairing(value);});},[]);
  useEffect(()=>{if(!user||!deviceIdentity||deviceIdentity.authorizationStatus==='ACTIVE')return;
    void markDeviceAuthorizationStatus(deviceIdentity.deviceId,'ACTIVE').then(active=>{if(active)setDeviceIdentity(active);});
  },[user,deviceIdentity]);
  useEffect(()=>{if(!pairing?.requestToken||!deviceIdentity)return;const poll=()=>void edge.getPairingStatus(pairing.pairingId,pairing.requestToken)
    .then(async status=>{if(status.status==='ACTIVE'){const active=await markDeviceAuthorizationStatus(deviceIdentity.deviceId,'ACTIVE');if(active)setDeviceIdentity(active);await clearDevicePairing(pairing.pairingId);setPairing(null);setLoginError(null);return;}
      const next={...pairing,currentStatus:status.status};await saveDevicePairing(next,pairing.pairingId);setPairing(next);}).catch(()=>undefined);
    poll();const timer=window.setInterval(poll,2_000);return()=>window.clearInterval(timer);},[pairing?.pairingId,pairing?.requestToken]);

  const refreshTables = useCallback(async () => {
    try {
      setTables(await edge.getTables());
      setConnection('CONNECTED');
    } catch (problem) {
      setConnection('DISCONNECTED');
      if (problem instanceof EdgeClientError && problem.status === 401) clearSession();
      throw problem;
    }
  }, [clearSession]);

  const refreshOrder = useCallback(async () => {
    if (!orderRef.current) return;
    try {
      const current = await edge.getOrder(orderRef.current.id);
      if (current.status !== 'OPEN') {
        setOrder(null);
        await refreshTables();
      } else {
        setOrder(current);
      }
    } catch (problem) {
      setError(waiterError(problem));
    }
  }, [refreshTables]);

  useEffect(() => {
    const restore = async () => {
      try {
        if (!window.localStorage.getItem(tokenKey)) return;
        const current = await edge.getCurrentSession();
        if (!current.user.permissions.includes(PermissionCodes.ORDER_VIEW)) {
          clearSession();
          return;
        }
        setUser(current.user);
      } catch {
        clearSession();
      } finally {
        setRestoring(false);
      }
    };
    void restore();
  }, [clearSession]);

  useEffect(() => {
    if (!user) return;
    void Promise.all([edge.getCategories(), edge.getProducts(), refreshTables()])
      .then(([nextCategories, nextProducts]) => {
        setCategories(nextCategories.filter((category) => category.active));
        setProducts(nextProducts);
      })
      .catch((problem) => setError(waiterError(problem)));
    const fallback = window.setInterval(() => void refreshTables().catch(() => undefined), 5_000);
    return () => window.clearInterval(fallback);
  }, [user, refreshTables]);

  useEffect(() => {
    if (!user) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
      socket.onopen = () => {
        const token = window.localStorage.getItem(tokenKey);
        if (!token) return socket?.close();
        socket?.send(JSON.stringify({ type: 'AUTHENTICATE', token }));
        setConnection('CONNECTED');
      };
      socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(String(event.data));
          if (raw?.type === 'AUTHENTICATED') {
            void refreshTables();
            void refreshOrder();
            return;
          }
          const message = OperationalRealtimeMessageSchema.safeParse(raw);
          if (!message.success) return;
          if (message.data.type === 'TABLES_CHANGED') void refreshTables();
          if (
            message.data.type === 'ORDER_UPDATED' &&
            message.data.orderId === orderRef.current?.id
          ) {
            void refreshOrder();
          }
        } catch {
          /* fallback polling remains active */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnection('DISCONNECTED');
        retry = window.setTimeout(connect, 1_500);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [user, refreshOrder, refreshTables]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!deviceIdentity || pin.length < 4) return;
    setLoginPending(true);
    setLoginError(null);
    try {
      const response = await edge.login({ pin, deviceId: deviceIdentity.deviceId,deviceCredential:deviceIdentity.credential });
      if (!response.user.permissions.includes(PermissionCodes.ORDER_VIEW)) {
        setLoginError('Este usuario no tiene acceso a comandería.');
        return;
      }
      window.localStorage.setItem(tokenKey, response.token);
      const active=await markDeviceAuthorizationStatus(deviceIdentity.deviceId,'ACTIVE');
      if(active)setDeviceIdentity(active);
      setUser(response.user);
      setPin('');
    } catch (problem) {
      setPin('');
      if(problem instanceof EdgeClientError&&problem.code==='DEVICE_REVOKED'){const revoked=await markDeviceAuthorizationStatus(deviceIdentity.deviceId,'REVOKED');if(revoked)setDeviceIdentity(revoked);}
      else if(problem instanceof EdgeClientError&&['DEVICE_NOT_PAIRED','DEVICE_NOT_AUTHORIZED','DEVICE_CREDENTIAL_INVALID'].includes(problem.code)){const unknown=await markDeviceAuthorizationStatus(deviceIdentity.deviceId,'UNKNOWN');if(unknown)setDeviceIdentity(unknown);}
      setLoginError(problem instanceof EdgeClientError&&problem.code==='DEVICE_REVOKED'?'Este dispositivo fue revocado. Empáralo nuevamente para crear una identidad nueva.':problem instanceof EdgeClientError&&['DEVICE_NOT_PAIRED','DEVICE_NOT_AUTHORIZED','DEVICE_CREDENTIAL_INVALID'].includes(problem.code)?'Este dispositivo no está autorizado. Empáralo primero.':'PIN incorrecto o acceso temporalmente bloqueado.');
    } finally {
      setLoginPending(false);
    }
  }
  async function beginPairing(){if(!deviceIdentity||pairingPending)return;setPairingPending(true);setLoginError(null);try{
    const displayName=pairingDisplayName.trim();if(!displayName){setLoginError('Asigna un nombre a este dispositivo.');return;}
    const named=deviceIdentity.displayName===displayName?deviceIdentity:{...deviceIdentity,displayName};if(named!==deviceIdentity){await saveDeviceIdentity(named);setDeviceIdentity(named);}
    const requested=await requestPairingWithIdentityRotation({identity:named,
      requestPairing:(identity)=>edge.createPairing({deviceId:identity.deviceId,deviceType:'WAITER',displayName:identity.displayName,credential:identity.credential}),
      onIdentityRotated:(identity)=>setDeviceIdentity(identity)});
    const next=createClientDevicePairing(requested.pairing);await saveDevicePairing(next);setPairing(next);
  }catch(problem){setLoginError(waiterError(problem));}finally{setPairingPending(false);}}
  async function retryPairing(){if(pairing)await clearDevicePairing(pairing.pairingId);setPairing(null);await beginPairing();}

  async function logout() {
    try {
      await edge.logout();
    } catch {
      /* local lock still applies */
    }
    clearSession();
  }

  async function selectTable(table: RestaurantTableResponse) {
    setPending(true);
    setError(null);
    try {
      const next = table.activeOrderId
        ? await edge.getOrder(table.activeOrderId)
        : await edge.createOrder({
            commandId: crypto.randomUUID(),
            orderType: 'TABLE',
            channel: 'WAITER',
            currency: 'MXN',
            tableIds: [table.id],
          });
      setOrder(next);
      await refreshTables();
    } catch (problem) {
      setError(waiterError(problem));
      await refreshTables().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  function openConfiguration(product: ProductResponse, item?: OrderResponse['items'][number]) {
    setConfiguration({
      product,
      editingItemId: item?.id ?? null,
      selectedModifierIds:
        item?.productSnapshot.selectedModifiers.map((modifier) => modifier.modifierOptionId) ?? [],
      specialInstructions: item?.specialInstructions ?? '',
    });
    setConfigurationError(null);
  }

  async function saveConfiguration() {
    if (!configuration || !order) return;
    const invalid = activeModifierGroups(configuration.product)
      .map((group) => modifierSelectionError(group, configuration.selectedModifierIds))
      .find(Boolean);
    if (invalid) return setConfigurationError(invalid);
    setPending(true);
    try {
      const request = {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        selectedModifierIds: configuration.selectedModifierIds,
        specialInstructions: configuration.specialInstructions,
      };
      const next = configuration.editingItemId
        ? await edge.updateDraftOrderItemConfiguration(
            order.id,
            configuration.editingItemId,
            request,
          )
        : await edge.addOrderItem(order.id, { ...request, productId: configuration.product.id });
      setOrder(next);
      setConfiguration(null);
    } catch (problem) {
      setConfigurationError(waiterError(problem));
      if (problem instanceof EdgeClientError && problem.code === 'STALE_ORDER_VERSION')
        await refreshOrder();
    } finally {
      setPending(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!order) return;
    setPending(true);
    try {
      setOrder(await edge.removeOrderItem(order.id, itemId, { expectedVersion: order.version }));
    } catch (problem) {
      setError(waiterError(problem));
      await refreshOrder();
    } finally {
      setPending(false);
    }
  }

  async function sendRound() {
    if (!order) return;
    setPending(true);
    setError(null);
    try {
      setOrder(
        await edge.sendRound(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
        }),
      );
    } catch (problem) {
      setError(waiterError(problem));
      await refreshOrder();
    } finally {
      setPending(false);
    }
  }

  async function updateTables() {
    if (!order) return;
    setPending(true);
    setTableError(null);
    try {
      setOrder(
        await edge.updateOrderTables(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
          tableIds: selectedTableIds,
        }),
      );
      setTablePickerOpen(false);
      await refreshTables();
    } catch (problem) {
      setTableError(waiterError(problem));
      await refreshTables().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  async function cancelEmptyTable() {
    if (!order) return;
    const blocker = emptyTableCancellationBlocker(order);
    if (blocker) {
      setCancelTableError(blocker);
      return;
    }
    setPending(true);
    setCancelTableError(null);
    try {
      await edge.cancelEmptyTableOrder(order.id, {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
      });
      setCancelTableOpen(false);
      setOrder(null);
      await refreshTables();
    } catch (problem) {
      setCancelTableError(waiterError(problem));
      await refreshOrder();
    } finally {
      setPending(false);
    }
  }

  async function requestPayment() {
    if (!order || order.paymentRequestedAt) return;
    setPending(true);
    setError(null);
    try {
      setOrder(
        await edge.requestOrderPayment(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
        }),
      );
      await refreshTables();
    } catch (problem) {
      setError(waiterError(problem));
      if (problem instanceof EdgeClientError && problem.code === 'STALE_ORDER_VERSION') {
        await refreshOrder();
      }
    } finally {
      setPending(false);
    }
  }

  const zones = useMemo(
    () => [
      ...new Set(tables.filter((table) => table.active).map((table) => table.zone ?? 'SIN ZONA')),
    ],
    [tables],
  );
  const activeZone =
    selectedZone && zones.includes(selectedZone) ? selectedZone : (zones[0] ?? null);
  const cancelBlocker = order ? emptyTableCancellationBlocker(order) : null;
  const shownProducts = useMemo(
    () => visibleProducts(products, categoryId, productSearch),
    [products, categoryId, productSearch],
  );
  const deviceOnboardingState=getDeviceOnboardingState(deviceIdentity,pairing);

  if (restoring) return <main className="login-shell">Restaurando sesión local…</main>;
  if (!user)
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={(event) => void login(event)}>
          <span className="eyebrow">COMANVIEW WAITER</span>
          <h1>Acceso de mesero</h1>
          <div className="pin-display">{pin ? '•'.repeat(pin.length) : 'Ingresa tu PIN'}</div>
          <div className="pin-pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button type="button" key={digit} onClick={() => setPin(`${pin}${digit}`)}>
                {digit}
              </button>
            ))}
            <button type="button" onClick={() => setPin(pin.slice(0, -1))}>
              ←
            </button>
            <button type="button" onClick={() => setPin(`${pin}0`)}>
              0
            </button>
            <button className="confirm" disabled={loginPending || pin.length < 4}>
              ✓
            </button>
          </div>
          <div className="stable-feedback">{loginError ?? '\u00a0'}</div>
          <DeviceOnboardingCard productLabel="Waiter" state={deviceOnboardingState} displayName={pairingDisplayName}
            pairingCode={pairing?.pairingCode} pairingId={pairing?.pairingId} expiresAt={pairing?.expiresAt}
            pending={pairingPending} onDisplayName={setPairingDisplayName} onPair={()=>void beginPairing()} onRetry={()=>void retryPairing()}/>
        </form>
      </main>
    );

  return (
    <div className="waiter-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">COMANVIEW WAITER</span>
          <strong>{user.displayName}</strong>
        </div>
        <div className={`connection ${connection.toLowerCase()}`}>
          {connection === 'CONNECTED' ? '● EDGE LOCAL' : '● SIN EDGE'}
        </div>
        <button className="ghost" onClick={() => void logout()}>
          Bloquear
        </button>
      </header>
      {error && (
        <div className="banner" role="alert">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      {!order ? (
        <main className="tables-view">
          <div className="view-heading">
            <div>
              <h1>Mesas</h1>
              <p>Toca una mesa libre para abrirla o una ocupada para entrar.</p>
            </div>
            <button onClick={() => void refreshTables()}>Actualizar</button>
          </div>
          <nav className="zone-tabs" aria-label="Zonas del restaurante">
            {zones.map((zone) => (
              <button
                key={zone}
                className={activeZone === zone ? 'active' : ''}
                onClick={() => setSelectedZone(zone)}
              >
                {zone}
                <small>
                  {
                    tables.filter((table) => table.active && (table.zone ?? 'SIN ZONA') === zone)
                      .length
                  }
                </small>
              </button>
            ))}
          </nav>
          {activeZone && (
            <section className="zone">
              <div className="zone-heading">
                <h2>{activeZone}</h2>
                <span>
                  {
                    tables.filter(
                      (table) =>
                        table.active &&
                        (table.zone ?? 'SIN ZONA') === activeZone &&
                        table.status === 'FREE',
                    ).length
                  }{' '}
                  libres
                </span>
              </div>
              <div className="table-grid">
                {tables
                  .filter((table) => (table.zone ?? 'SIN ZONA') === activeZone && table.active)
                  .map((table) => (
                    <button
                      key={table.id}
                      disabled={pending}
                      className={`table-card ${table.status.toLowerCase()}`}
                      onClick={() => void selectTable(table)}
                    >
                      <span className="table-status">
                        {tableStatusLabel(table.status)}
                      </span>
                      <strong>{table.name}</strong>
                      {table.status !== 'FREE' && (
                        <span className="table-prep-summary">
                          {table.preparingItemCount} preparando · {table.readyItemCount} listo
                        </span>
                      )}
                      <small>
                        {table.capacity ? `${table.capacity} personas` : 'Capacidad no indicada'}
                        {table.activeOrderNumber ? ` · Order #${table.activeOrderNumber}` : ''}
                      </small>
                    </button>
                  ))}
              </div>
            </section>
          )}
        </main>
      ) : (
        <main className="order-view">
          <section className="catalog-panel">
            <div className="order-mobile-heading">
              <button
                className="ghost"
                onClick={() => {
                  setOrder(null);
                  void refreshTables();
                }}
              >
                ← Mesas
              </button>
              <strong>
                Orden #
                {tables.find((table) => order.tableIds.includes(table.id))?.activeOrderNumber ??
                  order.id.slice(0, 6)}
              </strong>
            </div>
            <nav className="categories">
              <button className={!categoryId ? 'active' : ''} onClick={() => setCategoryId(null)}>
                Todo
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  className={categoryId === category.id ? 'active' : ''}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </nav>
            <label className="product-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={productSearch}
                placeholder="Buscar producto..."
                onChange={(event) => setProductSearch(event.target.value)}
              />
            </label>
            <div className="products">
              {shownProducts.map((product) => (
                <button
                  key={product.id}
                  disabled={!product.available || pending}
                  onClick={() => openConfiguration(product)}
                >
                  <strong>{product.name}</strong>
                  <span>{money(product.basePrice.amount, product.basePrice.currency)}</span>
                  {!product.available && <small>NO DISPONIBLE</small>}
                </button>
              ))}
            </div>
          </section>
          <aside className="order-panel">
            <div className="order-title">
              <div>
                <small>MESAS</small>
                <h2>
                  {tables
                    .filter((table) => order.tableIds.includes(table.id))
                    .map((table) => table.name)
                    .join(' + ')}
                </h2>
                <span className="order-state">
                  {order.status} · Order #
                  {tables.find((table) => table.activeOrderId === order.id)?.activeOrderNumber ??
                    order.id.slice(0, 6)}
                </span>
              </div>
            </div>
            <div className="order-status-summary">
              <span className="draft-count">
                {order.items.filter((item) => item.status === 'DRAFT').length} DRAFT
              </span>
              <span className="sent-count">
                {order.items.filter((item) => item.status === 'SENT').length} SENT
              </span>
              <span>{order.rounds.length} rondas</span>
              <span>{order.items.filter((item) => item.prepStatus === 'PREPARING').length} preparando</span>
              <span className="ready-count">
                {order.items.filter((item) => item.prepStatus === 'READY').length} listo
              </span>
            </div>
            <div className="items">
              {order.items.map((item) => (
                <article key={item.id} className={item.status.toLowerCase()}>
                  <div>
                    <strong>{item.productSnapshot.productName}</strong>
                    <span>{item.status === 'SENT' ? item.prepStatus : item.status}</span>
                  </div>
                  {item.productSnapshot.selectedModifiers.map((modifier) => (
                    <small key={modifier.modifierOptionId}>+ {modifier.name}</small>
                  ))}
                  {item.specialInstructions && <p>NOTA · {item.specialInstructions}</p>}
                  <footer>
                    <b>
                      {money(
                        item.productSnapshot.basePrice.amount +
                          item.productSnapshot.selectedModifiers.reduce(
                            (sum, mod) => sum + mod.priceDelta.amount,
                            0,
                          ),
                        order.currency,
                      )}
                    </b>
                    {item.status === 'DRAFT' && (
                      <span>
                        <button
                          onClick={() =>
                            openConfiguration(
                              products.find(
                                (product) => product.id === item.productSnapshot.productId,
                              )!,
                              item,
                            )
                          }
                        >
                          Editar
                        </button>
                        <button onClick={() => void removeItem(item.id)}>Eliminar</button>
                      </span>
                    )}
                  </footer>
                </article>
              ))}
              {order.items.length === 0 && <div className="empty">Agrega el primer producto</div>}
            </div>
            <div className="order-footer">
              <div>
                <span>Subtotal</span>
                <strong>{money(order.subtotal.amount, order.currency)}</strong>
              </div>
              <button
                className="send"
                disabled={pending || !order.items.some((item) => item.status === 'DRAFT')}
                onClick={() => void sendRound()}
              >
                Enviar ronda
              </button>
              <div className="secondary-order-actions">
                {user.permissions.includes(PermissionCodes.ORDER_REQUEST_PAYMENT) && (
                  <button
                    className="payment-request-button"
                    disabled={pending || Boolean(order.paymentRequestedAt)}
                    onClick={() => void requestPayment()}
                  >
                    {order.paymentRequestedAt ? 'Cuenta solicitada' : 'Solicitar cuenta'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedTableIds([...order.tableIds]);
                    setTablePickerOpen(true);
                    setTableError(null);
                  }}
                >
                  Cambiar / unir mesa
                </button>
                {user.permissions.includes(PermissionCodes.ORDER_CANCEL_EMPTY) && (
                  <button
                    className="danger-link"
                    onClick={() => {
                      setCancelTableError(cancelBlocker);
                      setCancelTableOpen(true);
                    }}
                  >
                    Cancelar mesa
                  </button>
                )}
              </div>
            </div>
          </aside>
        </main>
      )}

      {cancelTableOpen && order && (
        <div className="modal-backdrop">
          <section className="modal cancel-table-modal" role="dialog" aria-modal="true">
            <header>
              <div>
                <small>LIBERAR SIN CONSUMO</small>
                <h2>Cancelar mesa</h2>
              </div>
              <button onClick={() => setCancelTableOpen(false)}>×</button>
            </header>
            <p>
              Se cancelará la Order y quedarán libres{' '}
              <strong>
                {tables
                  .filter((table) => order.tableIds.includes(table.id))
                  .map((table) => table.name)
                  .join(' + ')}
              </strong>
              . El historial no se elimina.
            </p>
            <div className="stable-feedback error">{cancelTableError ?? '\u00a0'}</div>
            <footer>
              <button className="ghost" onClick={() => setCancelTableOpen(false)}>
                Volver
              </button>
              <button
                className="danger-confirm"
                disabled={pending || Boolean(cancelBlocker)}
                onClick={() => void cancelEmptyTable()}
              >
                {pending ? 'Cancelando…' : 'Cancelar y liberar'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {configuration && (
        <div className="modal-backdrop">
          <section className="modal">
            <header>
              <div>
                <small>CONFIGURAR</small>
                <h2>{configuration.product.name}</h2>
              </div>
              <button onClick={() => setConfiguration(null)}>×</button>
            </header>
            {activeModifierGroups(configuration.product).map((group) => (
              <fieldset key={group.modifierGroup.id}>
                <legend>
                  {group.modifierGroup.name}{' '}
                  <small>
                    {group.modifierGroup.minSelections}–{group.modifierGroup.maxSelections}
                  </small>
                </legend>
                <div className="options">
                  {group.modifierGroup.options
                    .filter((option) => option.active)
                    .map((option) => {
                      const checked = configuration.selectedModifierIds.includes(option.id);
                      return (
                        <button
                          type="button"
                          key={option.id}
                          disabled={!option.available}
                          className={checked ? 'selected' : ''}
                          onClick={() =>
                            setConfiguration({
                              ...configuration,
                              selectedModifierIds: checked
                                ? configuration.selectedModifierIds.filter((id) => id !== option.id)
                                : [...configuration.selectedModifierIds, option.id],
                            })
                          }
                        >
                          {option.name}
                          {!option.available && ' · AGOTADO'}
                        </button>
                      );
                    })}
                </div>
              </fieldset>
            ))}
            <label>
              Instrucciones especiales
              <textarea
                maxLength={500}
                value={configuration.specialInstructions}
                onChange={(event) =>
                  setConfiguration({ ...configuration, specialInstructions: event.target.value })
                }
                placeholder="Ej. salsa aparte"
              />
            </label>
            <div className="stable-feedback error">{configurationError ?? '\u00a0'}</div>
            <footer>
              <button className="ghost" onClick={() => setConfiguration(null)}>
                Cancelar
              </button>
              <button
                className="primary"
                disabled={pending}
                onClick={() => void saveConfiguration()}
              >
                {configuration.editingItemId ? 'Guardar cambios' : 'Agregar'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {tablePickerOpen && order && (
        <div className="modal-backdrop">
          <section className="modal table-picker">
            <header>
              <div>
                <small>ASIGNACIÓN</small>
                <h2>Mover o unir mesas</h2>
              </div>
              <button onClick={() => setTablePickerOpen(false)}>×</button>
            </header>
            <p>Selecciona una o varias mesas. La Order y toda su historia se conservan.</p>
            <div className="picker-grid">
              {tables
                .filter(
                  (table) =>
                    table.active && (table.status === 'FREE' || table.activeOrderId === order.id),
                )
                .map((table) => {
                  const selected = selectedTableIds.includes(table.id);
                  return (
                    <button
                      key={table.id}
                      className={selected ? 'selected' : ''}
                      onClick={() =>
                        setSelectedTableIds(
                          selected
                            ? selectedTableIds.filter((id) => id !== table.id)
                            : [...selectedTableIds, table.id],
                        )
                      }
                    >
                      {table.name}
                      <small>{table.zone}</small>
                    </button>
                  );
                })}
            </div>
            <div className="stable-feedback error">{tableError ?? '\u00a0'}</div>
            <footer>
              <button className="ghost" onClick={() => setTablePickerOpen(false)}>
                Cancelar
              </button>
              <button
                className="primary"
                disabled={pending || selectedTableIds.length === 0}
                onClick={() => void updateTables()}
              >
                Confirmar
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
