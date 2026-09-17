import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  createEdgeClient,
  EdgeClientError,
  clearDevicePairing,
  createClientDevicePairing,
  createDeviceIdentity,
  getDeviceOnboardingState,
  loadDeviceIdentity,
  loadDevicePairing,
  markDeviceAuthorizationStatus,
  requestPairingWithIdentityRotation,
  saveDeviceIdentity,
  saveDevicePairing,
  type ClientDeviceIdentity,
  type ClientDevicePairing,
} from '@comanview/client-sdk';
import {
  Dialog,
  InlineAlert,
  LocalConnectionStatus,
  type LocalConnection,
  DeviceOnboardingCard,
} from '@comanview/ui';
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

import { initialNavigation, waiterNavigation, waiterContextProblem } from './waiterNavigation.js';

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
  const [deviceIdentity, setDeviceIdentity] = useState<ClientDeviceIdentity | null>(null);
  const [pairing, setPairing] = useState<ClientDevicePairing | null>(null);
  const [pairingDisplayName, setPairingDisplayName] = useState('Waiter');
  const [pairingPending, setPairingPending] = useState(false);
  const [tables, setTables] = useState<RestaurantTableResponse[]>([]);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [navigation, navigate] = useReducer(waiterNavigation, initialNavigation);
  const { categoryId, zoneId: selectedZone } = navigation;
  const setCategoryId = (id: string | null) => navigate({ type: 'category', id });
  const setSelectedZone = (id: string) => navigate({ type: 'zone', id });
  const [productSearch, setProductSearch] = useState('');
  const [order, storeOrder] = useState<OrderResponse | null>(null);
  const [configuration, setConfiguration] = useState<ConfigurationState | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [cancelTableOpen, setCancelTableOpen] = useState(false);
  const [cancelTableError, setCancelTableError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<LocalConnection>('CONNECTING');
  const [realtime, setRealtime] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice || !['Producto agregado.', 'Cambios guardados en el pedido.'].includes(notice)) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setNotice((current) => current === 'Producto agregado.' ? null : current);
  }, [navigation.view]);
  const viewRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    viewRef.current?.focus();
  }, [navigation.view]);
  const refreshSequence = useRef(0);
  const orderRef = useRef(order);
  orderRef.current = order;
  const setOrder = useCallback((next: OrderResponse | null) => {
    if (next && next.id === orderRef.current?.id && next.version < orderRef.current.version) return;
    orderRef.current = next;
    storeOrder(next);
  }, []);

  const invalidateContext = useCallback((message: string) => {
    orderRef.current = null;
    setOrder(null);
    navigate({ type: 'invalidated' });
    setConfiguration(null);
    setTablePickerOpen(false);
    setCancelTableOpen(false);
    setNotice(message);
  }, []);
  const clearSession = useCallback(() => {
    window.localStorage.removeItem(tokenKey);
    setUser(null);
    orderRef.current = null;
    setOrder(null);
    navigate({ type: 'reset' });
    setConfiguration(null);
    setTablePickerOpen(false);
    setCancelTableOpen(false);
    setError(null);
    setNotice(null);
    setConnection('CONNECTING');
    setTables([]);
  }, []);
  useEffect(() => {
    void loadDeviceIdentity().then(async (v) => {
      const identity = v ?? createDeviceIdentity('WAITER', 'Waiter');
      if (!v) await saveDeviceIdentity(identity);
      setDeviceIdentity(identity);
      setPairingDisplayName(identity.displayName);
    });
  }, []);
  useEffect(() => {
    void loadDevicePairing().then((value) => {
      if (value) setPairing(value);
    });
  }, []);
  useEffect(() => {
    if (!user || !deviceIdentity || deviceIdentity.authorizationStatus === 'ACTIVE') return;
    void markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE').then((active) => {
      if (active) setDeviceIdentity(active);
    });
  }, [user, deviceIdentity]);
  useEffect(() => {
    if (!pairing?.requestToken || !deviceIdentity) return;
    const poll = () =>
      void edge
        .getPairingStatus(pairing.pairingId, pairing.requestToken)
        .then(async (status) => {
          if (status.status === 'ACTIVE') {
            const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
            if (active) setDeviceIdentity(active);
            await clearDevicePairing(pairing.pairingId);
            setPairing(null);
            setLoginError(null);
            return;
          }
          const next = { ...pairing, currentStatus: status.status };
          await saveDevicePairing(next, pairing.pairingId);
          setPairing(next);
        })
        .catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => window.clearInterval(timer);
  }, [pairing?.pairingId, pairing?.requestToken]);

  const refreshTables = useCallback(async () => {
    try {
      const next = await edge.getTables();
      setTables(next);
      setConnection('CONNECTED');
      return next;
    } catch (problem) {
      setConnection(
        problem instanceof EdgeClientError && problem.code !== 'EDGE_UNREACHABLE'
          ? 'CONNECTED'
          : 'DISCONNECTED',
      );
      if (problem instanceof EdgeClientError && problem.status === 401) clearSession();
      throw problem;
    }
  }, [clearSession]);

  const refreshOrder = useCallback(async () => {
    const previous = orderRef.current;
    if (!previous) return;
    const sequence = ++refreshSequence.current;
    try {
      const current = await edge.getOrder(previous.id);
      if (
        sequence !== refreshSequence.current ||
        orderRef.current?.id !== previous.id ||
        current.version < orderRef.current.version
      )
        return;
      if (current.status !== 'OPEN') {
        invalidateContext(
          'Este pedido ya fue cerrado o cancelado. Volvimos a Mesas para que elijas dónde continuar.',
        );
        await refreshTables();
        return;
      }
      const currentTables = await refreshTables();
      // Ignore obsolete responses, including a poll begun before a command acknowledgement.
      if (
        sequence !== refreshSequence.current ||
        orderRef.current?.id !== previous.id ||
        current.version < orderRef.current.version
      )
        return;
      const reason = waiterContextProblem(previous, current, currentTables);
      if (reason) return invalidateContext(reason);
      orderRef.current = current;
      setOrder(current);
    } catch (problem) {
      if (orderRef.current?.id !== previous.id || sequence !== refreshSequence.current) return;
      if (problem instanceof EdgeClientError && problem.code === 'ORDER_NOT_FOUND')
        return invalidateContext('El pedido ya no está disponible. Volvimos a Mesas.');
      setError(waiterError(problem));
    }
  }, [refreshTables, invalidateContext]);

  useEffect(() => {
    if (!configuration?.editingItemId || !order) return;
    if (
      order.items.some((item) => item.id === configuration.editingItemId && item.status === 'DRAFT')
    )
      return;
    setConfiguration(null);
    setNotice('El producto cambió o ya fue enviado. Revisa el pedido actualizado antes de editar.');
  }, [order, configuration]);

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
    const fallback = window.setInterval(() => {
      void refreshTables().catch(() => undefined);
      void refreshOrder();
    }, 5_000);
    return () => window.clearInterval(fallback);
  }, [user, refreshTables, refreshOrder]);

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
      };
      socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(String(event.data));
          if (raw?.type === 'AUTHENTICATED') {
            setRealtime(true);
            void refreshTables().catch((problem) => setError(waiterError(problem)));
            void refreshOrder();
            return;
          }
          const message = OperationalRealtimeMessageSchema.safeParse(raw);
          if (!message.success) return;
          if (message.data.type === 'TABLES_CHANGED') {
            void refreshTables().catch((problem) => setError(waiterError(problem)));
            void refreshOrder();
          }
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
        setRealtime(false);
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
      const response = await edge.login({
        pin,
        deviceId: deviceIdentity.deviceId,
        deviceCredential: deviceIdentity.credential,
      });
      if (!response.user.permissions.includes(PermissionCodes.ORDER_VIEW)) {
        setLoginError('Este usuario no tiene acceso a comandería.');
        return;
      }
      window.localStorage.setItem(tokenKey, response.token);
      const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
      if (active) setDeviceIdentity(active);
      setUser(response.user);
      setPin('');
    } catch (problem) {
      setPin('');
      if (problem instanceof EdgeClientError && problem.code === 'DEVICE_REVOKED') {
        const revoked = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'REVOKED');
        if (revoked) setDeviceIdentity(revoked);
      } else if (
        problem instanceof EdgeClientError &&
        ['DEVICE_NOT_PAIRED', 'DEVICE_NOT_AUTHORIZED', 'DEVICE_CREDENTIAL_INVALID'].includes(
          problem.code,
        )
      ) {
        const unknown = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'UNKNOWN');
        if (unknown) setDeviceIdentity(unknown);
      }
      setLoginError(
        problem instanceof EdgeClientError && problem.code === 'DEVICE_REVOKED'
          ? 'Este dispositivo fue revocado. Empáralo nuevamente para crear una identidad nueva.'
          : problem instanceof EdgeClientError &&
              ['DEVICE_NOT_PAIRED', 'DEVICE_NOT_AUTHORIZED', 'DEVICE_CREDENTIAL_INVALID'].includes(
                problem.code,
              )
            ? 'Este dispositivo no está autorizado. Empáralo primero.'
            : 'PIN incorrecto o acceso temporalmente bloqueado.',
      );
    } finally {
      setLoginPending(false);
    }
  }
  async function beginPairing() {
    if (!deviceIdentity || pairingPending) return;
    setPairingPending(true);
    setLoginError(null);
    try {
      const displayName = pairingDisplayName.trim();
      if (!displayName) {
        setLoginError('Asigna un nombre a este dispositivo.');
        return;
      }
      const named =
        deviceIdentity.displayName === displayName
          ? deviceIdentity
          : { ...deviceIdentity, displayName };
      if (named !== deviceIdentity) {
        await saveDeviceIdentity(named);
        setDeviceIdentity(named);
      }
      const requested = await requestPairingWithIdentityRotation({
        identity: named,
        requestPairing: (identity) =>
          edge.createPairing({
            deviceId: identity.deviceId,
            deviceType: 'WAITER',
            displayName: identity.displayName,
            credential: identity.credential,
          }),
        onIdentityRotated: (identity) => setDeviceIdentity(identity),
      });
      const next = createClientDevicePairing(requested.pairing);
      await saveDevicePairing(next);
      setPairing(next);
    } catch (problem) {
      setLoginError(waiterError(problem));
    } finally {
      setPairingPending(false);
    }
  }
  async function retryPairing() {
    if (pairing) await clearDevicePairing(pairing.pairingId);
    setPairing(null);
    await beginPairing();
  }

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
      if (next.status !== 'OPEN' || !next.tableIds.includes(table.id))
        return invalidateContext(
          'El pedido o la asignación de mesa cambió. Revisa el mapa antes de continuar.',
        );
      // Keep a confirmed order even if the subsequent map refresh fails.
      setOrder(next);
      navigate({ type: 'selected', orderId: next.id });
      setNotice(null);
      const currentTables = await refreshTables();
      if (orderRef.current?.id !== next.id || orderRef.current.version > next.version) return;
      const reason = waiterContextProblem(next, next, currentTables);
      if (reason) invalidateContext(reason);
    } catch (problem) {
      setError(waiterError(problem));
      await refreshTables().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  function openConfiguration(product: ProductResponse, item?: OrderResponse['items'][number]) {
    if (!product || pending) return;
    setConfiguration({
      product,
      editingItemId: item?.id ?? null,
      selectedModifierIds:
        item?.productSnapshot.selectedModifiers.map((modifier) => modifier.modifierOptionId) ?? [],
      specialInstructions: item?.specialInstructions ?? '',
    });
    setConfigurationError(null);
  }

  async function saveConfiguration(input = configuration, quickAdd = false) {
    if (!input || !order || pending) return;
    const invalid = activeModifierGroups(input.product)
      .map((group) => modifierSelectionError(group, input.selectedModifierIds))
      .find(Boolean);
    if (invalid) return setConfigurationError(invalid);
    setPending(true);
    try {
      const request = {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        selectedModifierIds: input.selectedModifierIds,
        specialInstructions: input.specialInstructions,
      };
      const next = input.editingItemId
        ? await edge.updateDraftOrderItemConfiguration(
            order.id,
            input.editingItemId,
            request,
          )
        : await edge.addOrderItem(order.id, { ...request, productId: input.product.id });
      orderRef.current = next;
      setOrder(next);
      setConfiguration(null);
      setNotice(
        input.editingItemId
          ? 'Cambios guardados en el pedido.'
          : 'Producto agregado.',
      );
    } catch (problem) {
      if (quickAdd) setError(waiterError(problem));
      else setConfigurationError(waiterError(problem));
      if (problem instanceof EdgeClientError && problem.code === 'STALE_ORDER_VERSION')
        await refreshOrder();
    } finally {
      setPending(false);
    }
  }

  function addProduct(product: ProductResponse) {
    setNotice(null);
    setError(null);
    if (activeModifierGroups(product).length > 0) return openConfiguration(product);
    void saveConfiguration({ product, editingItemId: null, selectedModifierIds: [], specialInstructions: '' }, true);
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
      setNotice('Ronda enviada. El pedido quedó registrado; no repitas el envío.');
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
      invalidateContext('Mesa cancelada y liberada.');
      await refreshTables().catch((problem) =>
        setError('La cancelación se confirmó. ' + waiterError(problem)),
      );
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
  const deviceOnboardingState = getDeviceOnboardingState(deviceIdentity, pairing);

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
              <button
                disabled={loginPending || pin.length >= 12}
                type="button"
                key={digit}
                onClick={() => setPin(`${pin}${digit}`)}
              >
                {digit}
              </button>
            ))}
            <button
              aria-label="Borrar último dígito"
              type="button"
              onClick={() => setPin(pin.slice(0, -1))}
            >
              ←
            </button>
            <button
              disabled={loginPending || pin.length >= 12}
              type="button"
              onClick={() => setPin(`${pin}0`)}
            >
              0
            </button>
            <button
              aria-label="Iniciar sesión"
              className="confirm"
              disabled={loginPending || pin.length < 4}
            >
              ✓
            </button>
          </div>
          <div className="stable-feedback">{loginError ?? '\u00a0'}</div>
          <DeviceOnboardingCard
            productLabel="Waiter"
            state={deviceOnboardingState}
            displayName={pairingDisplayName}
            pairingCode={pairing?.pairingCode}
            pairingId={pairing?.pairingId}
            expiresAt={pairing?.expiresAt}
            pending={pairingPending}
            onDisplayName={setPairingDisplayName}
            onPair={() => void beginPairing()}
            onRetry={() => void retryPairing()}
          />
        </form>
      </main>
    );

  return (
    <div className="waiter-shell" aria-busy={pending}>
      <header className="topbar">
        <div>
          <span className="eyebrow">COMANVIEW WAITER</span>
          <strong>{user.displayName}</strong>
        </div>
        <span className="operator-context">Servicio de mesas</span>
        <button className="ghost" disabled={pending} onClick={() => void logout()}>
          Bloquear
        </button>
      </header>
      <LocalConnectionStatus local={connection} realtime={realtime} />
      {error && (
        <InlineAlert tone="error" urgent title="Revisa la operación">
          {error}
          <button aria-label="Cerrar aviso de error" onClick={() => setError(null)}>
            Cerrar aviso
          </button>
        </InlineAlert>
      )}
      {notice && (
        <InlineAlert tone="info">
          {notice}
          <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            Cerrar aviso
          </button>
        </InlineAlert>
      )}
      <section className="waiter-active-context" aria-label="Contexto de servicio">
        <div>
          <strong>{order ? tables.filter((table) => order.tableIds.includes(table.id)).map((table) => `${table.zone ?? 'Sin zona'} · ${table.name}`).join(' + ') : activeZone ?? 'Selecciona una mesa'}</strong>
          {order && <div className="waiter-context-detail"><small>{order.items.filter((item) => item.status === 'DRAFT').length} pendientes de enviar</small><details><summary>Identificación del pedido</summary>{order.id}</details></div>}
        </div>
        <button
          disabled={pending || navigation.view === 'tables'}
          onClick={() => navigate({ type: 'back' })}
        >
          ← {navigation.view === 'order' ? 'Productos' : 'Mesas'}
        </button>
      </section>
      <nav className="task-navigation" aria-label="Servicio de mesa">
        <button
          aria-current={navigation.view === 'tables' ? 'page' : undefined}
          disabled={pending}
          onClick={() => navigate({ type: 'tables' })}
        >
          Mesas
        </button>
        <button
          aria-current={navigation.view === 'products' ? 'page' : undefined}
          disabled={pending || !order}
          onClick={() => navigate({ type: 'products' })}
        >
          Productos
        </button>
        <button
          aria-current={navigation.view === 'order' ? 'page' : undefined}
          disabled={pending || !order}
          onClick={() => navigate({ type: 'order' })}
        >
          Pedido · {order?.items.filter((item) => item.status === 'DRAFT').length ?? 0} sin enviar
        </button>
      </nav>
      {navigation.view === 'tables' || !order ? (
        <main className="tables-view">
          <div className="view-heading">
            <div>
              <h1 tabIndex={-1} ref={viewRef}>
                Mesas
              </h1>
              <p>Toca una mesa libre para abrirla o una ocupada para entrar.</p>
            </div>
            <button
              disabled={pending}
              onClick={() => {
                void refreshTables().catch((problem) => setError(waiterError(problem)));
                void refreshOrder();
              }}
            >
              Actualizar
            </button>
          </div>
          <nav className="zone-tabs" aria-label="Zonas del restaurante">
            {zones.map((zone) => (
              <button
                key={zone}
                className={activeZone === zone ? 'active' : ''}
                aria-pressed={activeZone === zone}
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
          {!activeZone && (
            <InlineAlert title="No hay mesas disponibles">
              Pide a un responsable que configure una zona y mesas activas.
            </InlineAlert>
          )}
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
                      <span className="table-status">{tableStatusLabel(table.status)}</span>
                      <strong>{table.name}</strong>
                      {table.status !== 'FREE' && (
                        <span className="table-prep-summary">
                          {table.preparingItemCount} preparando · {table.readyItemCount} listo
                        </span>
                      )}
                      <small>
                        {table.capacity ? `${table.capacity} personas` : 'Capacidad no indicada'}
                        {table.activeOrderNumber ? ` · Pedido ${table.activeOrderNumber}` : ''}
                      </small>
                    </button>
                  ))}
              </div>
            </section>
          )}
        </main>
      ) : (
        <main className="order-view">
          {navigation.view === 'products' && (
            <section className="catalog-panel">
              <h1 tabIndex={-1} ref={viewRef}>
                Productos
              </h1>
              <p className="table-context">
                {tables
                  .filter((table) => order.tableIds.includes(table.id))
                  .map((table) => table.name)
                  .join(' + ')}
              </p>
              <nav className="categories" aria-label="Categorías">
                <button
                  aria-pressed={!categoryId}
                  className={!categoryId ? 'active' : ''}
                  onClick={() => setCategoryId(null)}
                >
                  Todo
                </button>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    aria-pressed={categoryId === category.id}
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
                  aria-label="Buscar producto"
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
                      onClick={() => addProduct(product)}
                  >
                    <strong>{product.name}</strong>
                    <span>{money(product.basePrice.amount, product.basePrice.currency)}</span>
                    {!product.available && <small>NO DISPONIBLE</small>}
                  </button>
                ))}
              </div>
              {shownProducts.length === 0 && (
                <p role="status">
                  No hay productos que coincidan. Revisa la búsqueda o la categoría.
                </p>
              )}
            </section>
          )}
          {navigation.view === 'order' && (
            <section className="order-panel" aria-label="Pedido actual">
              <h1 tabIndex={-1} ref={viewRef}>
                Pedido
              </h1>
              <div className="order-status-summary">
                <span className="draft-count">
                  {order.items.filter((item) => item.status === 'DRAFT').length} sin enviar
                </span>
                <span className="sent-count">
                  {order.items.filter((item) => item.status === 'SENT').length} enviados
                </span>
                <span>{order.rounds.length} rondas</span>
                <span>
                  {order.items.filter((item) => item.prepStatus === 'PREPARING').length} preparando
                </span>
                <span className="ready-count">
                  {order.items.filter((item) => item.prepStatus === 'READY').length} listo
                </span>
              </div>
              <div className="items">
                {order.items.map((item) => (
                  <article key={item.id} className={item.status.toLowerCase()}>
                    <div>
                      <strong>{item.productSnapshot.productName}</strong>
                      <span>
                        {item.status === 'DRAFT'
                          ? 'Sin enviar'
                          : item.prepStatus === 'READY'
                            ? 'Listo'
                            : item.prepStatus === 'PREPARING'
                              ? 'Preparando'
                              : 'Enviado'}
                      </span>
                    </div>
                    {item.productSnapshot.selectedModifiers.map((modifier) => (
                      <small key={modifier.modifierOptionId}>+ {modifier.name}</small>
                    ))}
                    {item.specialInstructions && <p>NOTA · {item.specialInstructions}</p>}
                    <footer>
                      <b>
                        {money(
                          item.lineTotal?.amount ??
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
                            disabled={
                              pending ||
                              !products.some(
                                (product) => product.id === item.productSnapshot.productId,
                              )
                            }
                            onClick={() =>
                              openConfiguration(
                                products.find(
                                  (product) => product.id === item.productSnapshot.productId,
                                )!,
                                item,
                              )
                            }
                          >
                            {item.specialInstructions || item.productSnapshot.selectedModifiers.length ? 'Editar' : 'Agregar nota'}
                          </button>
                          <button disabled={pending} onClick={() => void removeItem(item.id)}>
                            Eliminar
                          </button>
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
                {order.taxTotal && (
                  <div>
                    <span>Impuestos</span>
                    <strong>{money(order.taxTotal.amount, order.currency)}</strong>
                  </div>
                )}
                <div>
                  <span>Total</span>
                  <strong>{money(order.total.amount, order.currency)}</strong>
                </div>
                <button
                  className="send"
                  disabled={pending || !order.items.some((item) => item.status === 'DRAFT')}
                  onClick={() => void sendRound()}
                >
                  {pending ? 'Confirmando…' : 'Enviar ronda'}
                </button>
                {!order.items.some((item) => item.status === 'DRAFT') && (
                  <p className="action-reason">
                    Agrega productos sin enviar para enviar una nueva ronda.
                  </p>
                )}
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
                    disabled={pending}
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
                      disabled={pending}
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
            </section>
          )}
        </main>
      )}

      {cancelTableOpen && order && (
        <Dialog
          open
          title="Cancelar mesa"
          className="modal cancel-table-modal"
          cancelable={!pending}
          onClose={() => setCancelTableOpen(false)}
        >
          <header>
            <div>
              <small>LIBERAR SIN CONSUMO</small>
              <h2>Cancelar mesa</h2>
            </div>
            <button
              disabled={pending}
              aria-label="Cerrar cancelación"
              onClick={() => setCancelTableOpen(false)}
            >
              ×
            </button>
          </header>
          <p>
            Se cancelará el pedido y quedarán libres{' '}
            <strong>
              {tables
                .filter((table) => order.tableIds.includes(table.id))
                .map((table) => table.name)
                .join(' + ')}
            </strong>
            . El historial no se elimina.
          </p>
          <div className="stable-feedback error" role="alert">
            {cancelTableError ?? '\u00a0'}
          </div>
          <footer>
            <button className="ghost" disabled={pending} onClick={() => setCancelTableOpen(false)}>
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
        </Dialog>
      )}

      {configuration && (
        <Dialog
          open
          title={configuration.product.name}
          className="modal"
          cancelable={!pending}
          onClose={() => setConfiguration(null)}
        >
          <header>
            <div>
              <small>CONFIGURAR</small>
              <h2>{configuration.product.name}</h2>
            </div>
            <button
              disabled={pending}
              aria-label="Cerrar producto"
              onClick={() => setConfiguration(null)}
            >
              ×
            </button>
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
                        disabled={!option.available || pending}
                        aria-pressed={checked}
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
          <div className="stable-feedback error" role="alert">
            {configurationError ?? '\u00a0'}
          </div>
          <footer>
            <button className="ghost" disabled={pending} onClick={() => setConfiguration(null)}>
              Cancelar
            </button>
            <button className="primary" disabled={pending} onClick={() => void saveConfiguration()}>
              {configuration.editingItemId ? 'Guardar cambios' : 'Agregar'}
            </button>
          </footer>
        </Dialog>
      )}

      {tablePickerOpen && order && (
        <Dialog
          open
          title="Mover o unir mesas"
          className="modal table-picker"
          cancelable={!pending}
          onClose={() => setTablePickerOpen(false)}
        >
          <header>
            <div>
              <small>ASIGNACIÓN</small>
              <h2>Mover o unir mesas</h2>
            </div>
            <button
              disabled={pending}
              aria-label="Cerrar selección de mesas"
              onClick={() => setTablePickerOpen(false)}
            >
              ×
            </button>
          </header>
          <p>Selecciona una o varias mesas. El pedido y toda su historia se conservan.</p>
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
                    disabled={pending}
                    aria-pressed={selected}
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
          <div className="stable-feedback error" role="alert">
            {tableError ?? '\u00a0'}
          </div>
          <footer>
            <button className="ghost" disabled={pending} onClick={() => setTablePickerOpen(false)}>
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
        </Dialog>
      )}
    </div>
  );
}
