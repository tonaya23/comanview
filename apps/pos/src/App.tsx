import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CatalogInvalidationController } from '@comanview/client-sdk';
import {
  createEdgeClient,
  EdgeClientError,
  invalidatesLocalSession,
  clearDevicePairing,
  createDeviceIdentity,
  createClientDevicePairing,
  createPairingAuthorizationData,
  getDeviceOnboardingState,
  loadDeviceIdentity,
  loadDevicePairing,
  markDeviceAuthorizationStatus,
  rotateDeviceIdentity,
  saveDeviceIdentity,
  saveDevicePairing,
  serializePairingAuthorizationData,
  type ClientDeviceIdentity,
  type ClientDevicePairing,
} from '@comanview/client-sdk';
import type {
  CashSessionResponse,
  CashReportSnapshotResponse,
  CashClosingPreviewResponse,
  CategoryResponse,
  OrderResponse,
  PaymentConfigResponse,
  PaymentMethod,
  PrintJobResponse,
  ProductResponse,
  TipSelection,
  AuthUserResponse,
  Device,
  PairingStatusResponse,
  PermissionCode,
  RestaurantTableResponse,
  EffectiveCapabilitiesResponse,
} from '@comanview/contracts';
import { OperationalRealtimeMessageSchema, PermissionCodes } from '@comanview/contracts';
import {
  getUserGuidance,
  Button,
  InlineAlert,
  TechnicalDetails,
  type UserGuidance,
  type AdministrationNavigationTarget,
  type TypedNavigationTarget,
} from '@comanview/ui';
import {
  PosAction,
  PosDialog,
  PosFeedback,
  ConnectionStatus,
  PrintingStatus,
  PaymentSummary,
  paymentMethodLabel,
  paymentStatusLabel,
  itemStatusLabel,
  licenseModeLabel,
  usePosConfirmation,
} from './PosOperationalUX.js';
import { roleLabel } from './AdministrationFields.js';
import {
  ALL_CATEGORIES,
  canCreateAnotherCounterOrder,
  canEditDraftItem,
  formatMoney,
  getActiveModifierGroups,
  getConfiguredProductTotal,
  getCashDifferencePresentation,
  getEffectiveModifierPrice,
  getErrorMessage,
  getLocalBusinessDate,
  getOpenTableAccounts,
  getTableStatusLabel,
  getModifierGroupValidationMessage,
  getSnapshotTotal,
  getUnsatisfiedModifierGroups,
  getVisibleCategories,
  getVisibleProducts,
  minorUnitsToInput,
  parseMoneyInputToMinorUnits,
  percentageAmountHalfUp,
} from './posLogic.js';
import {
  applyCashDenomination,
  canConfirmPaymentTender,
  createCashTenderInput,
  getCashDenominationPresets,
  getCashTenderPreview,
  setExactCashTender,
  setManualCashTender,
  undoCashDenomination,
} from './cashTenderInput.js';
import {
  getPairingUxState,
  pairingBelongsToIdentity,
  requestPairingWithRevokedIdentityRotation,
  shouldAcceptPairingPoll,
  shouldShowPairingOnLogin,
} from './devicePairingLifecycle.js';
import {
  clearPairingApproval,
  deviceAdminErrorMessage,
  isGlobalDeviceAdminError,
  loadDeviceAdminState,
  type DeviceAdminState,
} from './deviceAdmin.js';
import { DeviceAdminPanel } from './DeviceAdminPanel.js';
import { CashMovementTypeSelector } from './CashMovementTypeSelector.js';
import { AdministrationPanel } from './AdministrationPanel.js';
import {
  discardCounterSale,
  isDiscardableCounterSale,
  openCurrentCounterSale,
} from './counterSales.js';

const sessionTokenStorageKey = 'comanview.pos.sessionToken';
const edge = createEdgeClient({
  baseUrl: import.meta.env['VITE_EDGE_API_URL'] ?? '/api',
  getAccessToken: () => window.localStorage.getItem(sessionTokenStorageKey),
});
const currentOrderStorageKey = 'comanview.pos.currentOrderId';
type ConnectionState = 'CHECKING' | 'CONNECTED' | 'DISCONNECTED';

export function App() {
  const [authUser, setAuthUser] = useState<AuthUserResponse | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [deviceIdentity, setDeviceIdentity] = useState<ClientDeviceIdentity | null>(null);
  const [pairing, setPairing] = useState<ClientDevicePairing | null>(null);
  const [bootstrapAuthorization, setBootstrapAuthorization] = useState('');
  const [bootstrapPin, setBootstrapPin] = useState('');
  const [pairingCopyFeedback, setPairingCopyFeedback] = useState('');
  const [pairingDisplayName, setPairingDisplayName] = useState('POS principal');
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingNotice, setPairingNotice] = useState<string | null>(null);
  const [pairingPending, setPairingPending] = useState(false);
  const [bootstrapPending, setBootstrapPending] = useState(false);
  const [deviceAdminOpen, setDeviceAdminOpen] = useState(false);
  const [administrationOpen, setAdministrationOpen] = useState(false);
  const [administrationTarget, setAdministrationTarget] =
    useState<AdministrationNavigationTarget | null>(null);
  const [deviceAdmin, setDeviceAdmin] = useState<DeviceAdminState | null>(null);
  const [deviceAdminLoading, setDeviceAdminLoading] = useState(false);
  const [deviceAdminError, setDeviceAdminError] = useState<string | null>(null);
  const [deviceAdminNotice, setDeviceAdminNotice] = useState<string | null>(null);
  const [deviceAdminBusy, setDeviceAdminBusy] = useState<
    | `approve:${string}`
    | `cancel:${string}`
    | `revoke:${string}`
    | 'refresh'
    | 'backup-local'
    | 'backup-off-device'
    | 'backup-config'
    | 'recovery-key'
    | 'restore'
    | null
  >(null);
  const [approvalPairingId, setApprovalPairingId] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const pairingGenerationRef = useRef(0);
  const deviceIdentityRef = useRef<ClientDeviceIdentity | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('CHECKING');
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [emergencyRecovery, setEmergencyRecovery] = useState({
    backupId: '',
    artifactPath: '',
    recoveryKey: '',
    authorization: '',
  });
  const [emergencyRecoveryBusy, setEmergencyRecoveryBusy] = useState(false);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const catalogRefresh=useRef<CatalogInvalidationController|null>(null);
  useEffect(()=>{
    if(!authUser?.permissions.includes(PermissionCodes.CATALOG_VIEW))return;
    const refresh=new CatalogInvalidationController(edge,({categories,products})=>{setCategories(categories);setProducts(products);setLoadingCatalog(false);},()=>setLoadingCatalog(false));
    catalogRefresh.current=refresh;void refresh.check();
    const check=()=>{void refresh.check();};window.addEventListener('focus',check);
    return()=>{refresh.stop();catalogRefresh.current=null;window.removeEventListener('focus',check);};
  },[authUser]);
  const [tables, setTables] = useState<RestaurantTableResponse[]>([]);
  const [showOpenTables, setShowOpenTables] = useState(false);
  const [openCounterOrders, setOpenCounterOrders] = useState<OrderResponse[]>([]);
  const [showOpenCounterOrders, setShowOpenCounterOrders] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);
  const counterBusy = useRef(false);
  const operationalReadSequence = useRef(0);
  const deviceReadSequence = useRef(0);
  const [openTablesError, setOpenTablesError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState(ALL_CATEGORIES);
  const [productSearch, setProductSearch] = useState('');
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [cashSession, setCashSession] = useState<CashSessionResponse | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfigResponse | null>(null);
  const [licensing, setLicensing] = useState<EffectiveCapabilitiesResponse | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setErrorText] = useState<string | null>(null);
  const [errorGuidance, setErrorGuidance] = useState<UserGuidance | null>(null);
  function setError(text: string | null) {
    setErrorText(text);
    setErrorGuidance(null);
  }
  function reportError(problem: unknown) {
    if(problem instanceof EdgeClientError&&problem.code==='PERSONNEL_SECURITY_UNAVAILABLE'){
      setConnection('CHECKING');setOperationalDegraded(true);
    }
    setErrorText(getErrorMessage(problem));
    setErrorGuidance(
      getUserGuidance(problem instanceof EdgeClientError ? problem : 'UNKNOWN_EDGE_ERROR'),
    );
  }
  const { confirm: confirmOperation, confirmation: operationConfirmation } = usePosConfirmation();
  const [networkAvailable, setNetworkAvailable] = useState(navigator.onLine);
  const [operationalDegraded, setOperationalDegraded] = useState(false);
  const [printStatusUnavailable, setPrintStatusUnavailable] = useState(false);
  useEffect(() => {
    const update = () => setNetworkAvailable(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice || notice.startsWith('La venta actual ya está vacía.') || notice.startsWith('Hay una venta vacía abierta.')) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [showOpenCash, setShowOpenCash] = useState(false);
  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [cashGuidance, setCashGuidance] = useState<UserGuidance | null>(null);
  const [openCashError, setOpenCashErrorText] = useState<string | null>(null);
  function setOpenCashError(text: string | null) {
    setOpenCashErrorText(text);
    setCashGuidance(null);
  }
  const [showCashOperations, setShowCashOperations] = useState(false);
  const [cashModalError, setCashModalErrorText] = useState<string | null>(null);
  function setCashModalError(text: string | null) {
    setCashModalErrorText(text);
    setCashGuidance(null);
  }
  const [cashMovementType, setCashMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [cashMovementAmount, setCashMovementAmount] = useState('0.00');
  const [cashMovementReason, setCashMovementReason] = useState('');
  const [cashReport, setCashReport] = useState<CashReportSnapshotResponse | null>(null);
  const [countedCash, setCountedCash] = useState('');
  const [closingPreview, setClosingPreview] = useState<CashClosingPreviewResponse | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('0.00');
  const [cashTenderInput, setCashTenderInput] = useState(() => createCashTenderInput(0));
  const [tipMode, setTipMode] = useState<'NONE' | 'PERCENTAGE' | 'FIXED_AMOUNT' | 'REMAINDER'>(
    'NONE',
  );
  const [tipBasisPoints, setTipBasisPoints] = useState(1000);
  const [fixedTip, setFixedTip] = useState('0.00');
  const [configuredProduct, setConfiguredProduct] = useState<ProductResponse | null>(null);
  const [editingConfiguredItemId, setEditingConfiguredItemId] = useState<string | null>(null);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [modifierValidation, setModifierValidation] = useState<string | null>(null);
  const [configuredSpecialInstructions, setConfiguredSpecialInstructions] = useState('');
  const [printJobs, setPrintJobs] = useState<PrintJobResponse[]>([]);
  const [voidPaymentId, setVoidPaymentId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [overridePin, setOverridePin] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  const hasPermission = useCallback(
    (permission: PermissionCode) => authUser?.permissions.includes(permission) ?? false,
    [authUser],
  );

  const clearLocalSession = useCallback(() => {
    operationalReadSequence.current++;
    deviceReadSequence.current++;
    window.localStorage.removeItem(sessionTokenStorageKey);
    setAuthUser(null);
    setOrder(null);
    setCashSession(null);
    setPaymentConfig(null);
    setLicensing(null);
    setPrintJobs([]);
    setShowOpenCash(false);
    setOpenCashError(null);
    setShowCashOperations(false);
    setCashModalError(null);
    setShowPayment(false);
    setVoidPaymentId(null);
    setVoidReason('');
    setOverridePin('');
    setOverrideError(null);
  }, []);

  useEffect(() => {
    let disposed = false;
    const generation = ++pairingGenerationRef.current;
    void Promise.all([loadDeviceIdentity(), loadDevicePairing()]).then(
      async ([storedIdentity, storedPairing]) => {
        const identity = storedIdentity ?? createDeviceIdentity('POS', 'POS principal');
        if (!storedIdentity) await saveDeviceIdentity(identity);
        if (disposed || generation !== pairingGenerationRef.current) return;
        deviceIdentityRef.current = identity;
        setDeviceIdentity(identity);
        setPairingDisplayName(identity.displayName);
        if (!storedPairing) return;
        if (!pairingBelongsToIdentity(storedPairing, identity)) {
          await clearDevicePairing(storedPairing.pairingId);
          return;
        }
        if (storedPairing.currentStatus === 'ACTIVE') {
          const active = await markDeviceAuthorizationStatus(identity.deviceId, 'ACTIVE');
          if (active) {
            deviceIdentityRef.current = active;
            setDeviceIdentity(active);
          }
          await clearDevicePairing(storedPairing.pairingId);
          return;
        }
        setPairing(storedPairing);
      },
    );
    return () => {
      disposed = true;
      if (pairingGenerationRef.current === generation) pairingGenerationRef.current += 1;
    };
  }, []);
  useEffect(() => {
    deviceIdentityRef.current = deviceIdentity;
  }, [deviceIdentity]);
  useEffect(() => {
    if (!authUser || !deviceIdentity || deviceIdentity.authorizationStatus === 'ACTIVE') return;
    void markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE').then((active) => {
      if (active) {
        deviceIdentityRef.current = active;
        setDeviceIdentity(active);
      }
    });
  }, [authUser, deviceIdentity]);
  useEffect(() => {
    if (
      !pairing ||
      !deviceIdentity ||
      pairing.currentStatus !== 'PENDING' ||
      !pairingBelongsToIdentity(pairing, deviceIdentity)
    )
      return;
    const generation = ++pairingGenerationRef.current;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await edge.getPairingStatus(pairing.pairingId, pairing.requestToken);
        if (
          disposed ||
          !shouldAcceptPairingPoll({
            responsePairingId: status.pairingId,
            responseDeviceId: status.device.deviceId,
            expectedPairingId: pairing.pairingId,
            expectedDeviceId: pairing.deviceId,
            currentDeviceId: deviceIdentityRef.current?.deviceId ?? null,
            generation,
            currentGeneration: pairingGenerationRef.current,
          })
        )
          return;
        if (status.status === 'ACTIVE') {
          pairingGenerationRef.current += 1;
          setPairing(null);
          const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
          if (active) {
            deviceIdentityRef.current = active;
            setDeviceIdentity(active);
          }
          await clearDevicePairing(pairing.pairingId);
          if (!disposed) setPairingNotice('Dispositivo autorizado. Ya puedes iniciar sesión.');
          return;
        }
        const next = { ...pairing, currentStatus: status.status };
        setPairing(next);
        const saved = await saveDevicePairing(next, pairing.pairingId);
        if (generation !== pairingGenerationRef.current) {
          await clearDevicePairing(next.pairingId);
          return;
        }
        if (!saved) {
          pairingGenerationRef.current += 1;
          setPairing(null);
          return;
        }
        if (status.status === 'PENDING') timer = window.setTimeout(() => void poll(), 2_000);
      } catch {
        if (!disposed && generation === pairingGenerationRef.current)
          timer = window.setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (pairingGenerationRef.current === generation) pairingGenerationRef.current += 1;
    };
  }, [
    deviceIdentity?.deviceId,
    pairing?.pairingId,
    pairing?.requestToken,
    pairing?.deviceId,
    pairing?.currentStatus,
  ]);

  useEffect(() => {
    const restoreSession = async () => {
      if (!window.localStorage.getItem(sessionTokenStorageKey)) {
        setAuthChecking(false);
        return;
      }
      try {
        const current = await edge.getCurrentSession();
        setAuthUser(current.user);
      } catch (problem) {
        if(invalidatesLocalSession(problem))clearLocalSession();
        else reportError(problem);
      } finally {
        setAuthChecking(false);
      }
    };
    void restoreSession();
  }, [clearLocalSession]);

  const updateOrder = useCallback((next: OrderResponse) => {
    setOrder(next);
    window.localStorage.setItem(currentOrderStorageKey, next.id);
    if (next.orderType === 'COUNTER') {
      setOpenCounterOrders((current) =>
        next.status === 'OPEN'
          ? [next, ...current.filter(({ id }) => id !== next.id)]
          : current.filter(({ id }) => id !== next.id),
      );
    }
    setConnection('CONNECTED');
  }, []);

  const refreshConnection = useCallback(async () => {
    try {
      const health = await edge.getHealth();
      setRecoveryRequired(health.recoveryState === 'RECOVERY_REQUIRED');
      setConnection(health.status === 'UP' ? 'CONNECTED' : 'DISCONNECTED');
      return health.status === 'UP';
    } catch {
      setRecoveryRequired(false);
      setConnection('DISCONNECTED');
      return false;
    }
  }, []);

  const refreshOperationalState = useCallback(async () => {
    if (!authUser) return;
    const sequence = ++operationalReadSequence.current;
    try {
      const [
        nextTables,
        nextCounterOrders,
        currentCash,
        config,
        licenseStatus,
      ] = await Promise.all([
        authUser.permissions.includes(PermissionCodes.ORDER_VIEW)
          ? edge.getTables()
          : Promise.resolve([]),
        authUser.permissions.includes(PermissionCodes.ORDER_VIEW)
          ? edge.getOpenCounterOrders()
          : Promise.resolve([]),
        authUser.permissions.includes(PermissionCodes.CASH_SESSION_VIEW)
          ? edge.getCurrentCashSession()
          : Promise.resolve({ session: null }),
        authUser.permissions.includes(PermissionCodes.PAYMENT_CONFIG_VIEW)
          ? edge.getPaymentConfig()
          : Promise.resolve(null),
        edge.getLicensingStatus(),
      ]);
      if (sequence !== operationalReadSequence.current) return;
      void catalogRefresh.current?.check();
      setTables(nextTables);
      setOpenCounterOrders(nextCounterOrders);
      setCashSession(currentCash.session);
      setPaymentConfig(config);
      setLicensing(licenseStatus);
      setOperationalDegraded(false);
      setConnection('CONNECTED');
    } catch (stateError) {
      if (sequence !== operationalReadSequence.current) return;
      setOperationalDegraded(true);
      if (stateError instanceof EdgeClientError && stateError.code === 'EDGE_UNREACHABLE')
        setConnection('DISCONNECTED');
      if (invalidatesLocalSession(stateError)) clearLocalSession();
      reportError(stateError);
    } finally {
      setLoadingCatalog(false);
    }
  }, [authUser, clearLocalSession]);

  const restoreCurrentOrder = useCallback(async () => {
    if (!authUser?.permissions.includes(PermissionCodes.ORDER_VIEW)) return;
    const id = window.localStorage.getItem(currentOrderStorageKey);
    if (!id) return;
    try {
      setOrder(await edge.getOrder(id));
    } catch (restoreError) {
      window.localStorage.removeItem(currentOrderStorageKey);
      if (!(restoreError instanceof EdgeClientError && restoreError.code === 'ORDER_NOT_FOUND'))
        reportError(restoreError);
    }
  }, [authUser]);

  const refreshRealtimeTables = useCallback(async () => {
    if (!authUser?.permissions.includes(PermissionCodes.ORDER_VIEW)) return;
    try {
      setTables(await edge.getTables());
    } catch (problem) {
      if (invalidatesLocalSession(problem)) clearLocalSession();
    }
  }, [authUser, clearLocalSession]);

  const refreshRealtimeOrder = useCallback(
    async (orderId: string) => {
      if (orderRef.current?.id !== orderId) return;
      try {
        const next = await edge.getOrder(orderId);
        setOrder((current) => {
          if (!current || current.id !== next.id || next.version < current.version) return current;
          return next;
        });
      } catch (problem) {
        if (invalidatesLocalSession(problem)) clearLocalSession();
      }
    },
    [clearLocalSession],
  );

  useEffect(() => {
    let wasConnected = false;
    const check = async () => {
      const connected = await refreshConnection();
      if (connected && authUser && !wasConnected) {
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
  }, [authUser, refreshConnection, refreshOperationalState, restoreCurrentOrder]);

  useEffect(() => {
    if (!authUser?.permissions.includes(PermissionCodes.ORDER_VIEW)) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
      socket.onopen = () => {
        const token = window.localStorage.getItem(sessionTokenStorageKey);
        if (!token) return socket?.close();
        socket?.send(JSON.stringify({ type: 'AUTHENTICATE', token }));
      };
      socket.onmessage = (event) => {
        try {
          const raw = JSON.parse(String(event.data));
          if (raw?.type === 'AUTHENTICATED') {
            void catalogRefresh.current?.check();
            void refreshRealtimeTables();
            if (orderRef.current) void refreshRealtimeOrder(orderRef.current.id);
            return;
          }
          const message = OperationalRealtimeMessageSchema.safeParse(raw);
          if (!message.success) return;
          if(message.data.type==='CATALOG_CHANGED')catalogRefresh.current?.invalidate(message.data);
          if (message.data.type === 'TABLES_CHANGED') void refreshRealtimeTables();
          if (
            message.data.type === 'ORDER_UPDATED' &&
            message.data.orderId === orderRef.current?.id
          ) {
            void refreshRealtimeOrder(message.data.orderId);
          }
        } catch {
          /* REST polling and reconnect refetch remain the recovery path. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = (event) => {
        if(!stopped&&event?.code===1008){clearLocalSession();return;}
        if (!stopped) retry = window.setTimeout(connect, 1_500);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [authUser, refreshRealtimeOrder, refreshRealtimeTables]);

  useEffect(() => {
    if (
      connection !== 'CONNECTED' ||
      !authUser?.permissions.includes(PermissionCodes.PRINT_JOBS_VIEW)
    )
      return;
    const refresh = async () => {
      try {
        setPrintJobs(await edge.getRecentPrintJobs());
        setPrintStatusUnavailable(false);
      } catch {
        setPrintStatusUnavailable(true);
        // Printing is non-blocking; connectivity polling remains authoritative.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [authUser, connection]);

  const visibleCategories = useMemo(() => getVisibleCategories(categories), [categories]);
  const visibleProducts = useMemo(
    () => getVisibleProducts(products, selectedCategoryId, productSearch),
    [products, selectedCategoryId, productSearch],
  );
  const openTableAccounts = useMemo(() => getOpenTableAccounts(tables), [tables]);
  const draftItems = order?.items.filter((item) => item.status === 'DRAFT') ?? [];
  const sentItems = order?.items.filter((item) => item.status === 'SENT') ?? [];
  const amountMinor = parseMoneyInputToMinorUnits(paymentAmount) ?? 0;
  const fixedTipMinor = parseMoneyInputToMinorUnits(fixedTip) ?? 0;
  const tenderedMinor = parseMoneyInputToMinorUnits(cashTenderInput.value);
  const isRemainderTip = tipMode === 'REMAINDER';
  const remainderSettlesBalance = Boolean(order && amountMinor === order.balanceDue.amount);
  const remainderTipPreview =
    isRemainderTip && tenderedMinor !== null && tenderedMinor >= amountMinor
      ? tenderedMinor - amountMinor
      : 0;
  const tipPreview =
    tipMode === 'PERCENTAGE'
      ? percentageAmountHalfUp(amountMinor, tipBasisPoints)
      : tipMode === 'FIXED_AMOUNT'
        ? fixedTipMinor
        : remainderTipPreview;
  const cashRequiredMinor = amountMinor + tipPreview;
  const exactCashRequiredMinor = isRemainderTip ? amountMinor : cashRequiredMinor;
  const cashTenderPreview = getCashTenderPreview(
    cashTenderInput.value,
    cashRequiredMinor,
    isRemainderTip,
  );
  const remainderIntentAllowed =
    !isRemainderTip || (paymentMethod === 'CASH' && remainderSettlesBalance);
  const canConfirmTender =
    canConfirmPaymentTender(paymentMethod, cashTenderPreview.isSufficient) &&
    remainderIntentAllowed;
  const cashDenominations = getCashDenominationPresets(order?.currency ?? '');
  const visibleCashSummary = cashReport ?? closingPreview;
  const cashDifference = visibleCashSummary?.difference
    ? getCashDifferencePresentation(
        visibleCashSummary.difference.amount,
        visibleCashSummary.currency,
      )
    : null;
  const isBusy = pendingAction !== null;
  const licenseAllowsNewOrders =
    licensing !== null &&
    ['FULL', 'FULL_WITH_WARNING', 'GRACE_OPERATING', 'GUARANTEED_SHIFT'].includes(licensing.mode);
  const canOperateOrder =
    order?.status === 'OPEN' &&
    connection === 'CONNECTED' &&
    !isBusy &&
    (licenseAllowsNewOrders || Boolean(order && licensing?.mode === 'PROTECTED_OPERATIONS'));

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function setContextualCashError(problem: unknown, setLocalError: (message: string) => void) {
    if(problem instanceof EdgeClientError&&problem.code==='PERSONNEL_SECURITY_UNAVAILABLE'){
      reportError(problem);setLocalError(getErrorMessage(problem));return;
    }
    if (problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE') {
      setConnection('DISCONNECTED');
      reportError(problem);
      return;
    }
    if (invalidatesLocalSession(problem)) {
      clearLocalSession();
      reportError(problem);
      return;
    }
    setLocalError(getErrorMessage(problem));
    setCashGuidance(
      getUserGuidance(problem instanceof EdgeClientError ? problem : 'UNKNOWN_EDGE_ERROR'),
    );
  }

  async function mutate(
    name: string,
    action: () => Promise<OrderResponse>,
    message: string,
    handleError?: (problem: unknown) => boolean,
  ) {
    setPendingAction(name);
    clearFeedback();
    try {
      const next = await action();
      operationalReadSequence.current++;
      updateOrder(next);
      setNotice(message);
      return next;
    } catch (problem) {
      if (problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE')
        setConnection('DISCONNECTED');
      if (invalidatesLocalSession(problem)) clearLocalSession();
      if (problem instanceof EdgeClientError && problem.code === 'STALE_ORDER_VERSION' && order) {
        try {
          updateOrder(await edge.getOrder(order.id));
        } catch {
          /* original error is clearer */
        }
      }
      if (
        problem instanceof EdgeClientError &&
        [
          'INVALID_MODIFIER_SELECTION',
          'MODIFIER_UNAVAILABLE',
          'MODIFIER_INACTIVE',
          'PRODUCT_UNAVAILABLE',
          'PRODUCT_INACTIVE',
        ].includes(problem.code)
      ) {
        try {
          await catalogRefresh.current?.check(true);
          const nextProducts=catalogRefresh.current?.getSnapshot()?.products;
          if (configuredProduct&&nextProducts) {
            const nextConfigured =
              nextProducts.find(({ id }) => id === configuredProduct.id) ?? null;
            setConfiguredProduct(nextConfigured);
            if (nextConfigured) {
              const selectableIds = new Set(
                getActiveModifierGroups(nextConfigured).flatMap(({ modifierGroup }) =>
                  modifierGroup.options
                    .filter((option) => option.active && option.available)
                    .map(({ id }) => id),
                ),
              );
              setSelectedModifierIds((current) => current.filter((id) => selectableIds.has(id)));
            }
          }
        } catch {
          /* the authoritative mutation error remains the useful feedback */
        }
      }
      if (!handleError?.(problem)) reportError(problem);
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function createOrder() {
    if (counterBusy.current) return;
    if (!canCreateAnotherCounterOrder(order)) {
      setNotice('La venta actual ya está vacía. Úsala o descártala antes de crear otra.');
      return;
    }
    if (
      order?.status === 'OPEN' &&
      order.items.length > 0 &&
      !(await confirmOperation(
        'Iniciar otra venta',
        'La venta actual permanecerá abierta. Podrás recuperarla desde Ventas abiertas. ¿Continuar?',
      ))
    )
      return;
    const currency = products.find((product) => product.active)?.basePrice.currency ?? 'MXN';
    counterBusy.current = true;
    setPendingAction('create-order');
    try {
      const current = await edge.getOpenCounterOrders();
      setOpenCounterOrders(current);
      if (current.some(isDiscardableCounterSale)) {
        setCounterError(null);
        setShowOpenCounterOrders(true);
        setNotice('Hay una venta vacía abierta. Selecciónala para continuar o descartarla.');
        return;
      }
      await mutate(
        'create-order',
        () =>
          edge.createOrder({
            commandId: crypto.randomUUID(),
            orderType: 'COUNTER',
            channel: 'POS',
            currency,
          }),
        'Nueva venta creada.',
      );
    } catch (problem) {
      reportError(problem);
    } finally {
      counterBusy.current = false;
      setPendingAction(null);
    }
  }

  async function openCounterOrder(next: OrderResponse) {
    if (counterBusy.current) return;
    counterBusy.current = true;
    setPendingAction('open-counter');
    setCounterError(null);
    try {
      updateOrder(await openCurrentCounterSale(edge, next.id));
      setShowOpenCounterOrders(false);
      setNotice('Venta abierta recuperada.');
    } catch (problem) {
      setCounterError(
        problem instanceof EdgeClientError
          ? getErrorMessage(problem)
          : 'Esta venta ya no está abierta. Actualiza la lista.',
      );
    } finally {
      counterBusy.current = false;
      setPendingAction(null);
    }
  }

  async function refreshCounterSales() {
    if (counterBusy.current) return;
    counterBusy.current = true;
    setPendingAction('list-counter');
    setCounterError(null);
    try {
      setOpenCounterOrders(await edge.getOpenCounterOrders());
    } catch (problem) {
      setCounterError(getErrorMessage(problem));
    } finally {
      counterBusy.current = false;
      setPendingAction(null);
    }
  }

  async function cancelEmptyCounterOrder() {
    if (!order || !isDiscardableCounterSale(order) || counterBusy.current) return;
    if (
      !(await confirmOperation(
        'Descartar venta vacía',
        'Solo puede descartarse una venta de mostrador abierta, sin productos, rondas ni pagos. Esta venta dejará de aparecer en Ventas abiertas.',
      ))
    )
      return;
    counterBusy.current = true;
    setPendingAction('cancel-empty-counter');
    clearFeedback();
    try {
      const result = await discardCounterSale(edge, order, (cancelled) => {
        setOrder(null);
        orderRef.current = null;
        window.localStorage.removeItem(currentOrderStorageKey);
        setOpenCounterOrders((current) => current.filter((x) => x.id !== cancelled.id));
        setNotice('Venta vacía cancelada.');
      });
      if (result.remaining) setOpenCounterOrders(result.remaining);
      setCounterError(
        result.refreshFailed
          ? 'La venta fue cancelada. No se pudo actualizar la lista; pulsa Actualizar.'
          : null,
      );
      setShowOpenCounterOrders(false);
      if (result.refreshFailed) {
        setError('La venta fue cancelada. No se pudo actualizar la lista; abre Ventas abiertas para consultarla.');
      }
    } catch (problem) {
      reportError(problem);
    } finally {
      counterBusy.current = false;
      setPendingAction(null);
    }
  }

  async function openTableOrder(orderId: string, tableNames: string[]) {
    clearFeedback();
    setOpenTablesError(null);
    setPendingAction(`open-table-${orderId}`);
    try {
      updateOrder(await edge.getOrder(orderId));
      setShowOpenTables(false);
      setNotice(`${tableNames.join(' + ')} abierta para cobro.`);
    } catch (problem) {
      setOpenTablesError(getErrorMessage(problem));
      await refreshOperationalState();
    } finally {
      setPendingAction(null);
    }
  }
  async function addProduct(
    product: ProductResponse,
    modifierIds: string[] = [],
    specialInstructions?: string | null,
  ) {
    if (!order) return;
    const next = await mutate(
      `add-${product.id}`,
      () =>
        edge.addOrderItem(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
          productId: product.id,
          selectedModifierIds: modifierIds,
          specialInstructions,
        }),
      `${product.name} agregado.`,
    );
    if (next) {
      setConfiguredProduct(null);
      setEditingConfiguredItemId(null);
      setSelectedModifierIds([]);
      setModifierValidation(null);
      setConfiguredSpecialInstructions('');
    }
  }

  function chooseProduct(product: ProductResponse) {
    if (getActiveModifierGroups(product).length === 0) {
      void addProduct(product);
      return;
    }
    setConfiguredProduct(product);
    setEditingConfiguredItemId(null);
    setSelectedModifierIds([]);
    setModifierValidation(null);
    setConfiguredSpecialInstructions('');
  }

  function toggleModifier(groupId: string, optionId: string) {
    if (!configuredProduct) return;
    const group = getActiveModifierGroups(configuredProduct).find(
      ({ modifierGroup }) => modifierGroup.id === groupId,
    );
    if (!group) return;
    const option = group.modifierGroup.options.find(({ id }) => id === optionId);
    if (!option?.active || !option.available) return;

    const groupOptionIds = new Set(group.modifierGroup.options.map(({ id }) => id));
    const alreadySelected = selectedModifierIds.includes(optionId);
    const groupSelectionCount = selectedModifierIds.filter((id) => groupOptionIds.has(id)).length;
    if (group.modifierGroup.maxSelections === 1) {
      if (alreadySelected) return;
      setModifierValidation(null);
      setSelectedModifierIds((current) => [
        ...current.filter((id) => !groupOptionIds.has(id)),
        optionId,
      ]);
      return;
    }
    if (!alreadySelected && groupSelectionCount >= group.modifierGroup.maxSelections) {
      setModifierValidation(
        `${group.modifierGroup.name} permite máximo ${group.modifierGroup.maxSelections}.`,
      );
      return;
    }

    setModifierValidation(null);
    setSelectedModifierIds((current) => {
      if (alreadySelected) return current.filter((id) => id !== optionId);
      return [...current, optionId];
    });
  }

  async function submitConfiguredProduct() {
    if (!configuredProduct || !order) return;
    const missing = getUnsatisfiedModifierGroups(configuredProduct, selectedModifierIds);
    if (missing.length > 0) {
      setModifierValidation('Completa las selecciones indicadas antes de confirmar.');
      return;
    }
    if (!editingConfiguredItemId) {
      await addProduct(configuredProduct, selectedModifierIds, configuredSpecialInstructions);
      return;
    }

    const next = await mutate(
      `edit-${editingConfiguredItemId}`,
      () =>
        edge.updateDraftOrderItemConfiguration(order.id, editingConfiguredItemId, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
          selectedModifierIds,
          specialInstructions: configuredSpecialInstructions,
        }),
      `${configuredProduct.name} actualizado.`,
    );
    if (next) {
      setConfiguredProduct(null);
      setEditingConfiguredItemId(null);
      setSelectedModifierIds([]);
      setModifierValidation(null);
      setConfiguredSpecialInstructions('');
    }
  }

  function beginEditDraftItem(item: OrderResponse['items'][number]) {
    if (!canEditDraftItem(item.status)) return;
    const product = products.find(({ id }) => id === item.productSnapshot.productId);
    if (!product) {
      setError('El producto ya no está disponible en el catálogo local para editarlo.');
      return;
    }
    clearFeedback();
    setConfiguredProduct(product);
    setEditingConfiguredItemId(item.id);
    setSelectedModifierIds(
      item.productSnapshot.selectedModifiers.map(({ modifierOptionId }) => modifierOptionId),
    );
    setConfiguredSpecialInstructions(item.specialInstructions ?? '');
    setModifierValidation(null);
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
      () =>
        edge.sendRound(order.id, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
        }),
      `Ronda ${order.rounds.length + 1} enviada; pedido registrado. La impresión se verifica por separado.`,
    );
  }

  async function requestPrint(kind: 'PRECHECK' | 'CUSTOMER_RECEIPT') {
    if (!order) return;
    setPendingAction(kind === 'PRECHECK' ? 'precheck' : 'receipt');
    clearFeedback();
    try {
      const job =
        kind === 'PRECHECK'
          ? await edge.requestPrecheck(order.id, { commandId: crypto.randomUUID() })
          : await edge.requestCustomerReceipt(order.id, { commandId: crypto.randomUUID() });
      setNotice(
        `${kind === 'PRECHECK' ? 'Precuenta' : 'Recibo'} solicitado. La impresión se verifica por separado.`,
      );
      try {
        setPrintJobs(await edge.getRecentPrintJobs());
        setPrintStatusUnavailable(false);
      } catch {
        setPrintStatusUnavailable(true);
      }
    } catch (problem) {
      reportError(problem);
    } finally {
      setPendingAction(null);
    }
  }

  async function openCash(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoneyInputToMinorUnits(openingFloat);
    if (amount === null || amount < 0) {
      setOpenCashError('Ingresa un fondo inicial válido, con máximo dos decimales.');
      return;
    }
    setPendingAction('open-cash');
    clearFeedback();
    setOpenCashError(null);
    try {
      const session = await edge.openCashSession({
        commandId: crypto.randomUUID(),
        openingFloatAmount: amount,
        businessDate: getLocalBusinessDate(),
        purpose: licensing?.mode === 'PROTECTED_OPERATIONS' ? 'LICENSE_RECOVERY' : 'NORMAL',
      });
      operationalReadSequence.current++;
      setCashSession(session);
      setShowOpenCash(false);
      setOpenCashError(null);
      setNotice('Turno de caja abierto.');
    } catch (problem) {
      setContextualCashError(problem, setOpenCashError);
    } finally {
      setPendingAction(null);
    }
  }

  async function createCashMovement(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoneyInputToMinorUnits(cashMovementAmount);
    if (!amount || !cashMovementReason.trim()) {
      setCashModalError('Indica un importe mayor a cero y un motivo.');
      return;
    }
    setPendingAction('cash-movement');
    clearFeedback();
    setCashModalError(null);
    try {
      await edge.createCashMovement({
        commandId: crypto.randomUUID(),
        type: cashMovementType,
        amount,
        reason: cashMovementReason,
      });
      setCashMovementAmount('0.00');
      setCashMovementReason('');
      setNotice(cashMovementType === 'CASH_IN' ? 'Entrada registrada.' : 'Salida registrada.');
    } catch (problem) {
      setContextualCashError(problem, setCashModalError);
    } finally {
      setPendingAction(null);
    }
  }

  async function generateXReport() {
    setPendingAction('x-report');
    clearFeedback();
    setCashModalError(null);
    try {
      const report = await edge.generateXReport({ commandId: crypto.randomUUID() });
      setCashReport(report);
      setClosingPreview(null);
      setNotice('Corte X generado sin cerrar la caja.');
    } catch (problem) {
      setContextualCashError(problem, setCashModalError);
    } finally {
      setPendingAction(null);
    }
  }

  async function previewCashClose(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoneyInputToMinorUnits(countedCash);
    if (amount === null) {
      setCashModalError('Ingresa el efectivo contado con máximo dos decimales.');
      return;
    }
    setPendingAction('close-preview');
    clearFeedback();
    setCashModalError(null);
    try {
      setClosingPreview(await edge.previewCashClosing({ countedCashAmount: amount }));
      setCashReport(null);
    } catch (problem) {
      setContextualCashError(problem, setCashModalError);
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmCashClose() {
    const amount = parseMoneyInputToMinorUnits(countedCash);
    if (amount === null) return;
    setPendingAction('close-cash');
    clearFeedback();
    setCashModalError(null);
    try {
      const result = await edge.closeCashSession({
        commandId: crypto.randomUUID(),
        countedCashAmount: amount,
      });
      operationalReadSequence.current++;
      setCashSession(null);
      setClosingPreview(null);
      setCashReport(result.report);
      setCountedCash('');
      setNotice('Corte Z confirmado. El turno de caja quedó cerrado.');
    } catch (problem) {
      setContextualCashError(problem, setCashModalError);
    } finally {
      setPendingAction(null);
    }
  }

  function beginPayment() {
    if (!order) return;
    clearFeedback();
    if (!cashSession) {
      if (hasPermission(PermissionCodes.CASH_SESSION_OPEN)) {
        setOpenCashError(null);
        setShowOpenCash(true);
      } else {
        setError('La caja está cerrada y tu perfil no puede abrirla.');
      }
      return;
    }
    const balance = minorUnitsToInput(order.balanceDue.amount);
    setPaymentAmount(balance);
    setCashTenderInput(createCashTenderInput(order.balanceDue.amount));
    setTipMode('NONE');
    setShowPayment(true);
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    const applied = parseMoneyInputToMinorUnits(paymentAmount);
    const tendered = parseMoneyInputToMinorUnits(cashTenderInput.value);
    if (!applied || applied > order.balanceDue.amount) {
      setError('El monto debe ser mayor a cero y no superar el saldo pendiente.');
      return;
    }
    if (tipMode === 'REMAINDER' && !remainderIntentAllowed) {
      setError('Resto solo está disponible en efectivo al liquidar el saldo completo.');
      return;
    }
    if (!canConfirmTender) {
      setError('El efectivo recibido debe cubrir el pago y la propina.');
      return;
    }
    let tip: TipSelection = { type: 'NONE' };
    if (tipMode === 'PERCENTAGE') tip = { type: 'PERCENTAGE', basisPoints: tipBasisPoints };
    if (tipMode === 'FIXED_AMOUNT') tip = { type: 'FIXED_AMOUNT', amount: fixedTipMinor };
    if (tipMode === 'REMAINDER') tip = { type: 'REMAINDER' };
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
      `${paymentMethod === 'CASH' ? 'Pago en efectivo' : 'Pago con tarjeta'} confirmado.`,
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
        'Venta cobrada y cerrada.',
      )
    ) {
      setShowPayment(false);
      await refreshOperationalState();
    }
  }

  function cancelPaymentVoid() {
    setVoidPaymentId(null);
    setVoidReason('');
    setOverridePin('');
    setOverrideError(null);
  }

  async function submitPaymentVoid(event: FormEvent) {
    event.preventDefault();
    if (!order || !voidPaymentId) return;
    const authorizationPin = overridePin;
    setOverridePin('');
    setOverrideError(null);
    const next = await mutate(
      `void-${voidPaymentId}`,
      () =>
        edge.voidPayment(order.id, voidPaymentId, {
          commandId: crypto.randomUUID(),
          expectedVersion: order.version,
          reason: voidReason,
          ...(hasPermission(PermissionCodes.PAYMENT_VOID) ? {} : { overridePin: authorizationPin }),
        }),
      'Pago anulado. La autorización quedó registrada.',
      (problem) => {
        if (
          problem instanceof EdgeClientError &&
          [
            'OVERRIDE_REQUIRED',
            'OVERRIDE_PIN_INVALID',
            'OVERRIDE_USER_INACTIVE',
            'OVERRIDE_PERMISSION_DENIED',
            'REASON_REQUIRED',
          ].includes(problem.code)
        ) {
          setOverrideError(getErrorMessage(problem));
          setOverridePin('');
          return true;
        }
        return false;
      },
    );
    if (next) cancelPaymentVoid();
  }

  async function retryConnection() {
    clearFeedback();
    setConnection('CHECKING');
    if (await refreshConnection())
      await Promise.all([refreshOperationalState(), restoreCurrentOrder()]);
  }

  async function login(event?: FormEvent) {
    event?.preventDefault();
    if (pin.length < 4) return;
    setLoginPending(true);
    setLoginError(null);
    try {
      if (!deviceIdentity) {
        setLoginError('Este POS no tiene un dispositivo configurado.');
        return;
      }
      const authenticated = await edge.login({
        pin,
        deviceId: deviceIdentity.deviceId,
        deviceCredential: deviceIdentity.credential,
      });
      const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
      if (active) {
        deviceIdentityRef.current = active;
        setDeviceIdentity(active);
      }
      window.localStorage.setItem(sessionTokenStorageKey, authenticated.token);
      setAuthUser(authenticated.user);
      setPin('');
      setLoadingCatalog(true);
    } catch (problem) {
      setPin('');
      if (problem instanceof EdgeClientError && problem.code === 'DEVICE_REVOKED') {
        const revoked = await markDeviceAuthorizationStatus(deviceIdentity!.deviceId, 'REVOKED');
        if (revoked) {
          deviceIdentityRef.current = revoked;
          setDeviceIdentity(revoked);
        }
      } else if (
        problem instanceof EdgeClientError &&
        ['DEVICE_NOT_PAIRED', 'DEVICE_NOT_AUTHORIZED', 'DEVICE_CREDENTIAL_INVALID'].includes(
          problem.code,
        )
      ) {
        const unknown = await markDeviceAuthorizationStatus(deviceIdentity!.deviceId, 'UNKNOWN');
        if (unknown) {
          deviceIdentityRef.current = unknown;
          setDeviceIdentity(unknown);
        }
      }
      setLoginError(
        problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE'
          ? 'No fue posible conectar con el servicio local.'
          : problem instanceof EdgeClientError && problem.code === 'DEVICE_REVOKED'
            ? 'Este dispositivo fue revocado y ya no puede iniciar sesión. Empareja el dispositivo nuevamente para registrarlo como uno nuevo.'
            : problem instanceof EdgeClientError &&
                [
                  'DEVICE_NOT_PAIRED',
                  'DEVICE_NOT_AUTHORIZED',
                  'DEVICE_CREDENTIAL_INVALID',
                ].includes(problem.code)
              ? 'Este dispositivo no está autorizado. Empareja el dispositivo antes de iniciar sesión.'
              : 'PIN incorrecto o acceso temporalmente bloqueado.',
      );
    } finally {
      setLoginPending(false);
      setAuthChecking(false);
    }
  }
  async function beginPairing() {
    if (!deviceIdentity || pairingPending) return;
    setPairingError(null);
    setPairingNotice(null);
    setPairingCopyFeedback('');
    setPairingPending(true);
    try {
      const displayName = pairingDisplayName.trim();
      if (!displayName) {
        setPairingError('Asigna un nombre a este dispositivo.');
        return;
      }
      const namedIdentity =
        deviceIdentity.displayName === displayName
          ? deviceIdentity
          : { ...deviceIdentity, displayName };
      if (namedIdentity !== deviceIdentity) {
        await saveDeviceIdentity(namedIdentity);
        deviceIdentityRef.current = namedIdentity;
        setDeviceIdentity(namedIdentity);
      }
      const requested = await requestPairingWithRevokedIdentityRotation({
        identity: namedIdentity,
        requestPairing: (identity) =>
          edge.createPairing({
            deviceId: identity.deviceId,
            deviceType: 'POS',
            displayName: identity.displayName,
            credential: identity.credential,
          }),
        rotateIdentity: rotateDeviceIdentity,
        onIdentityRotated: (replacement) => {
          pairingGenerationRef.current += 1;
          deviceIdentityRef.current = replacement;
          setDeviceIdentity(replacement);
          setPairing(null);
        },
      });
      if (!requested) return;
      const next = createClientDevicePairing(requested.pairing);
      const saved = await saveDevicePairing(next);
      if (!saved || deviceIdentityRef.current?.deviceId !== requested.identity.deviceId) return;
      pairingGenerationRef.current += 1;
      setPairing(next);
      setPairingNotice(
        'Solicitud creada. Autorízala desde Administración y conserva esta pantalla abierta.',
      );
    } catch (problem) {
      setPairingError(getErrorMessage(problem));
    } finally {
      setPairingPending(false);
    }
  }
  async function copyPairingAuthorizationData() {
    if (
      !pairing ||
      !deviceIdentity ||
      pairing.currentStatus !== 'PENDING' ||
      !pairingBelongsToIdentity(pairing, deviceIdentity)
    )
      return;
    const value = serializePairingAuthorizationData(
      createPairingAuthorizationData(pairing, deviceIdentity),
    );
    try {
      await navigator.clipboard.writeText(value);
      setPairingCopyFeedback('Datos de autorización copiados.');
    } catch {
      setPairingCopyFeedback('No fue posible copiar. Selecciona el bloque y cópialo manualmente.');
    }
  }
  async function finishBootstrap() {
    if (
      !pairing ||
      !deviceIdentity ||
      bootstrapPending ||
      pairing.currentStatus !== 'PENDING' ||
      !pairingBelongsToIdentity(pairing, deviceIdentity)
    )
      return;
    setPairingError(null);
    setBootstrapPending(true);
    try {
      const authorization = JSON.parse(bootstrapAuthorization);
      await edge.completeBootstrap({
        pairingId: pairing.pairingId,
        pairingCode: pairing.pairingCode,
        requestToken: pairing.requestToken,
        authorization,
        ownerPin: bootstrapPin,
      });
      const active = await markDeviceAuthorizationStatus(deviceIdentity.deviceId, 'ACTIVE');
      if (active) {
        deviceIdentityRef.current = active;
        setDeviceIdentity(active);
      }
      pairingGenerationRef.current += 1;
      setPairing(null);
      await clearDevicePairing(pairing.pairingId);
      setBootstrapAuthorization('');
      setBootstrapPin('');
      setPairingNotice('Dispositivo autorizado. Ya puedes iniciar sesión.');
    } catch (problem) {
      setPairingError(
        problem instanceof SyntaxError
          ? 'La autorización pegada no tiene un formato válido.'
          : getErrorMessage(problem),
      );
    } finally {
      setBootstrapPending(false);
    }
  }
  async function restartPairing() {
    if (!pairing) return;
    pairingGenerationRef.current += 1;
    const previousId = pairing.pairingId;
    setPairing(null);
    setBootstrapAuthorization('');
    setBootstrapPin('');
    await clearDevicePairing(previousId);
    await beginPairing();
  }
  async function refreshDeviceAdmin(action: 'refresh' | null = null) {
    const sequence = ++deviceReadSequence.current;
    if (action) setDeviceAdminBusy(action);
    setDeviceAdminLoading(true);
    setDeviceAdminError(null);
    try {
      const next = await loadDeviceAdminState(edge);
      if (sequence === deviceReadSequence.current) setDeviceAdmin(next);
    } catch (problem) {
      if (sequence !== deviceReadSequence.current) return;
      if (isGlobalDeviceAdminError(problem)) setError(deviceAdminErrorMessage(problem));
      else setDeviceAdminError(deviceAdminErrorMessage(problem));
    } finally {
      if (sequence === deviceReadSequence.current) {
        setDeviceAdminLoading(false);
        if (action) setDeviceAdminBusy(null);
      }
    }
  }
  async function reconcileDeviceMutation() {
    const sequence = ++deviceReadSequence.current;
    try {
      const next = await loadDeviceAdminState(edge);
      if (sequence === deviceReadSequence.current) setDeviceAdmin(next);
    } catch (problem) {
      if (sequence === deviceReadSequence.current)
        setDeviceAdminError(`El cambio fue confirmado. No se pudo consultar el estado actualizado: ${deviceAdminErrorMessage(problem)}`);
    }
  }
  async function openDeviceAdmin() {
    setDeviceAdminOpen(true);
    setDeviceAdminNotice(null);
    await refreshDeviceAdmin();
  }
  function canNavigateToGuidance(target: TypedNavigationTarget) {
    return target.surface === 'system'
      ? hasPermission(PermissionCodes.DEVICE_VIEW)
      : target.section === 'personnel'
        ? hasPermission(PermissionCodes.PERSONNEL_VIEW)
        : hasPermission(PermissionCodes.ADMINISTRATION_VIEW);
  }
  function navigateToGuidance(target: TypedNavigationTarget) {
    if (!canNavigateToGuidance(target)) return;
    if (target.surface === 'administration') {
      if (!canNavigateToGuidance(target)) return;
      setDeviceAdminOpen(false);
      setAdministrationTarget(target);
      setAdministrationOpen(true);
      return;
    }
    const id = {
      devices: 'devices-title',
      readiness: 'installation-summary-title',
      'backup-recovery': 'backup-title',
    }[target.section];
    const reveal = () =>
      window.requestAnimationFrame(() =>
        document
          .getElementById(id)
          ?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'auto'
              : 'smooth',
            block: 'start',
          }),
      );
    if (!deviceAdminOpen) {
      setAdministrationOpen(false);
      void openDeviceAdmin().then(reveal);
    } else reveal();
  }
  async function approveDevice() {
    if (deviceAdminBusy) return;
    const action = `approve:${approvalPairingId}` as const;
    setDeviceAdminBusy(action);
    setDeviceAdminError(null);
    setDeviceAdminNotice(null);
    try {
      await edge.approvePairing({
        commandId: crypto.randomUUID(),
        pairingId: approvalPairingId,
        pairingCode: approvalCode,
      });
      clearPairingApproval(setApprovalPairingId, setApprovalCode);
      setDeviceAdminNotice('Dispositivo aprobado correctamente.');
      await reconcileDeviceMutation();
    } catch (problem) {
      if (isGlobalDeviceAdminError(problem)) setError(deviceAdminErrorMessage(problem));
      else setDeviceAdminError(deviceAdminErrorMessage(problem));
    } finally {
      setDeviceAdminBusy(null);
    }
  }
  async function cancelDevicePairing(request: PairingStatusResponse) {
    if (deviceAdminBusy) return;
    const action = `cancel:${request.pairingId}` as const;
    setDeviceAdminBusy(action);
    setDeviceAdminError(null);
    setDeviceAdminNotice(null);
    try {
      await edge.cancelPairing(request.pairingId, { commandId: crypto.randomUUID() });
      if (approvalPairingId === request.pairingId)
        clearPairingApproval(setApprovalPairingId, setApprovalCode);
      setDeviceAdminNotice('Solicitud cancelada. El historial permanece disponible en Edge.');
      await reconcileDeviceMutation();
    } catch (problem) {
      if (isGlobalDeviceAdminError(problem)) setError(deviceAdminErrorMessage(problem));
      else setDeviceAdminError(deviceAdminErrorMessage(problem));
    } finally {
      setDeviceAdminBusy(null);
    }
  }
  async function revokeDevice(device: Device) {
    if (deviceAdminBusy) return;
    const action = `revoke:${device.deviceId}` as const;
    setDeviceAdminBusy(action);
    setDeviceAdminError(null);
    setDeviceAdminNotice(null);
    try {
      await edge.revokeDevice(device.deviceId, {
        commandId: crypto.randomUUID(),
        reason: 'Revocación administrativa local',
      });
      setDeviceAdminNotice(
        `${device.displayName} fue revocado. Sus sesiones activas quedaron cerradas.`,
      );
      await reconcileDeviceMutation();
    } catch (problem) {
      if (isGlobalDeviceAdminError(problem)) setError(deviceAdminErrorMessage(problem));
      else setDeviceAdminError(deviceAdminErrorMessage(problem));
    } finally {
      setDeviceAdminBusy(null);
    }
  }
  async function createBackup(destinationType: 'LOCAL' | 'OFF_DEVICE') {
    setDeviceAdminBusy(destinationType === 'LOCAL' ? 'backup-local' : 'backup-off-device');
    setDeviceAdminError(null);
    try {
      await edge.createBackup({ commandId: crypto.randomUUID(), destinationType });
      setDeviceAdminNotice(
        destinationType === 'LOCAL'
          ? 'Backup local creado y verificado correctamente.'
          : 'Backup externo creado y verificado correctamente.',
      );
      await reconcileDeviceMutation();
    } catch (problem) {
      setDeviceAdminError(deviceAdminErrorMessage(problem));
    } finally {
      setDeviceAdminBusy(null);
    }
  }
  async function configureOffDeviceBackup(directoryPath: string) {
    setDeviceAdminBusy('backup-config');
    setDeviceAdminError(null);
    try {
      await edge.configureOffDeviceBackup({ commandId: crypto.randomUUID(), directoryPath });
      setDeviceAdminNotice('Destino externo configurado.');
      await reconcileDeviceMutation();
    } catch (problem) {
      setDeviceAdminError(deviceAdminErrorMessage(problem));
    } finally {
      setDeviceAdminBusy(null);
    }
  }
  async function exportRecoveryKey() {
    setDeviceAdminBusy('recovery-key');
    setDeviceAdminError(null);
    try {
      const result = await edge.exportRecoveryKey({
        commandId: crypto.randomUUID(),
        confirmation: 'EXPORT_RECOVERY_KEY',
      });
      setDeviceAdminNotice('Recovery Key entregada una sola vez. Guárdala fuera de este equipo.');
      await reconcileDeviceMutation();
      return result.recoveryKey;
    } catch (problem) {
      setDeviceAdminError(deviceAdminErrorMessage(problem));
      throw problem;
    } finally {
      setDeviceAdminBusy(null);
    }
  }
  async function restoreBackup(backupId: string) {
    setDeviceAdminBusy('restore');
    setDeviceAdminError(null);
    try {
      await edge.restoreBackup({
        commandId: crypto.randomUUID(),
        backupId,
        confirmation: 'RESTORE_VERIFIED_BACKUP',
      });
      setDeviceAdminNotice(
        'Recuperación programada. Edge se reiniciará para aplicar y validar la copia.',
      );
    } catch (problem) {
      setDeviceAdminError(deviceAdminErrorMessage(problem));
      throw problem;
    } finally {
      setDeviceAdminBusy(null);
    }
  }

  async function logout() {
    try {
      await edge.logout();
    } catch {
      // Local lock is immediate even if Edge became unavailable.
    } finally {
      clearLocalSession();
      setPin('');
      setLoginError(null);
    }
  }

  const deviceOnboardingState = getDeviceOnboardingState(deviceIdentity, pairing);
  const operationalFeedback = (
    <PosFeedback
      message={error}
      guidance={errorGuidance}
      success={showPayment ? null : notice}
      onNavigate={navigateToGuidance}
      canNavigate={canNavigateToGuidance}
      onReview={() => {
        if (order) void refreshRealtimeOrder(order.id);
      }}
    />
  );
  const operationReason = isBusy
    ? 'Espera la confirmación de la operación en curso.'
    : connection !== 'CONNECTED'
      ? 'Restablece la conexión local para confirmar operaciones.'
      : !licensing
        ? 'Espera a que se verifique la licencia.'
        : !licenseAllowsNewOrders && licensing.mode !== 'PROTECTED_OPERATIONS'
          ? 'La licencia actual restringe esta operación. Consulta a administración.'
          : !order
            ? 'Crea o selecciona una venta primero.'
            : order.status !== 'OPEN'
              ? 'Esta venta ya no está abierta.'
              : null;
  const createReason = isBusy
    ? 'Espera la operación en curso.'
    : connection !== 'CONNECTED'
      ? 'Restablece la conexión local.'
      : !hasPermission(PermissionCodes.ORDER_CREATE)
        ? 'Tu rol no permite crear ventas.'
        : !licenseAllowsNewOrders
          ? 'La licencia no permite iniciar nuevas ventas.'
          : null;
  const editReason = !hasPermission(PermissionCodes.ORDER_EDIT_DRAFT)
    ? 'Tu rol no permite editar productos.'
    : operationReason;

  async function emergencyRestore(event: FormEvent) {
    event.preventDefault();
    setEmergencyRecoveryBusy(true);
    setLoginError(null);
    try {
      const authorization = emergencyRecovery.authorization.trim()
        ? JSON.parse(emergencyRecovery.authorization)
        : undefined;
      await edge.emergencyRestore({
        commandId: crypto.randomUUID(),
        backupId: emergencyRecovery.backupId,
        artifactPath: emergencyRecovery.artifactPath,
        recoveryKey: emergencyRecovery.recoveryKey,
        confirmation: 'RESTORE_VERIFIED_BACKUP',
        ...(authorization ? { recoveryAuthorization: authorization } : {}),
      });
      setLoginError('Copia validada. Reinicia Edge para completar la recuperación.');
    } catch (problem) {
      setLoginError(getErrorMessage(problem));
    } finally {
      setEmergencyRecoveryBusy(false);
    }
  }

  if (authChecking) {
    return (
      <main className="pos-login-shell">
        <div className="pos-login-card" role="status">
          <span className="spinner" />
          <strong>Restaurando sesión local</strong>
        </div>
      </main>
    );
  }

  if (!authUser) {
    if (recoveryRequired)
      return (
        <main className="pos-login-shell">
          <form
            className="pos-login-card recovery-card"
            onSubmit={(event) => void emergencyRestore(event)}
          >
            <div className="brand pos-login-brand">
              <span className="brand-mark">C</span>
              <div>
                <strong>ComanView</strong>
                <span>Recuperación local</span>
              </div>
            </div>
            <div className="inline-alert inline-alert--error" role="alert">
              <strong>Recuperación requerida</strong>
              <span>
                La base operacional no es segura. No se creó una base vacía y las ventas permanecen
                bloqueadas.
              </span>
            </div>
            <label>
              Backup ID
              <input
                required
                value={emergencyRecovery.backupId}
                onChange={(event) =>
                  setEmergencyRecovery({ ...emergencyRecovery, backupId: event.target.value })
                }
              />
            </label>
            <label>
              Ruta del backup
              <input
                required
                value={emergencyRecovery.artifactPath}
                onChange={(event) =>
                  setEmergencyRecovery({ ...emergencyRecovery, artifactPath: event.target.value })
                }
              />
            </label>
            <label>
              Recovery Key
              <input
                required
                type="password"
                autoComplete="off"
                value={emergencyRecovery.recoveryKey}
                onChange={(event) =>
                  setEmergencyRecovery({ ...emergencyRecovery, recoveryKey: event.target.value })
                }
              />
            </label>
            <label>
              Recovery Authorization <small>Solo para reemplazo de hardware</small>
              <textarea
                value={emergencyRecovery.authorization}
                onChange={(event) =>
                  setEmergencyRecovery({ ...emergencyRecovery, authorization: event.target.value })
                }
              />
            </label>
            <button className="danger-button" disabled={emergencyRecoveryBusy}>
              {emergencyRecoveryBusy ? 'Validando…' : 'Validar e iniciar recuperación'}
            </button>
            <div className="pin-feedback" role="status">
              {loginError ?? 'La Recovery Key y la autorización nunca se guardan en el navegador.'}
            </div>
          </form>
        </main>
      );
    return (
      <main className="pos-login-shell">
        <form className="pos-login-card" onSubmit={(event) => void login(event)}>
          <div className="brand pos-login-brand">
            <span className="brand-mark">C</span>
            <div>
              <strong>ComanView</strong>
              <span>Acceso local POS</span>
            </div>
          </div>
          <div className="pin-display" aria-label={`${pin.length} dígitos ingresados`}>
            {pin ? '•'.repeat(pin.length) : 'Ingresa tu PIN'}
          </div>
          <div className="pin-keypad" aria-label="Teclado de PIN">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={loginPending || pin.length >= 12}
                onClick={() => setPin((current) => `${current}${digit}`)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              aria-label="Borrar último dígito"
              disabled={loginPending || pin.length === 0}
              onClick={() => setPin((current) => current.slice(0, -1))}
            >
              ←
            </button>
            <button
              type="button"
              disabled={loginPending || pin.length >= 12}
              onClick={() => setPin((current) => `${current}0`)}
            >
              0
            </button>
            <button
              type="submit"
              className="pin-submit"
              aria-label="Iniciar sesión"
              disabled={loginPending || pin.length < 4}
            >
              {loginPending ? '…' : '✓'}
            </button>
          </div>
          <div className="pin-feedback" role="status">
            {loginError ?? '\u00a0'}
          </div>
          {!shouldShowPairingOnLogin(deviceOnboardingState) ? (
            <div className="device-authorized-hint" role="status">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{deviceIdentity?.displayName}</strong>
                <small>Dispositivo autorizado · inicia sesión con tu PIN.</small>
              </div>
            </div>
          ) : (
            <section className="device-pairing-panel">
              <div className="pairing-panel-heading">
                <div>
                  <strong>Este dispositivo</strong>
                  <small>Autorízalo una sola vez para operar en este restaurante.</small>
                </div>
                {pairing ? (
                  <span
                    className={`admin-status admin-status--${pairing.currentStatus.toLowerCase()}`}
                  >
                    {pairing.currentStatus}
                  </span>
                ) : null}
              </div>
              {!pairing ? (
                <>
                  <label>
                    Nombre del dispositivo
                    <input
                      value={pairingDisplayName}
                      maxLength={120}
                      onChange={(event) => setPairingDisplayName(event.target.value)}
                      placeholder="Ej. Caja barra"
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void beginPairing()}
                    disabled={!deviceIdentity || pairingPending || !pairingDisplayName.trim()}
                  >
                    {pairingPending
                      ? 'Creando solicitud…'
                      : deviceOnboardingState === 'REVOKED'
                        ? 'Emparejar dispositivo nuevamente'
                        : 'Emparejar dispositivo'}
                  </button>
                </>
              ) : (
                <>
                  {getPairingUxState(pairing.currentStatus) === 'PENDING' && (
                    <>
                      <div className="pairing-code">
                        <span>Código temporal</span>
                        <strong>{pairing.pairingCode}</strong>
                        <small>
                          Válido hasta {new Date(pairing.expiresAt).toLocaleTimeString()}
                        </small>
                      </div>
                      <details>
                        <summary>Detalles técnicos</summary>
                        <code>{pairing.pairingId}</code>
                        <code>{deviceIdentity?.deviceId}</code>
                      </details>
                      <label>
                        Datos para autorizar este dispositivo
                        <textarea
                          readOnly
                          aria-label="Datos para autorizar este dispositivo"
                          value={
                            deviceIdentity
                              ? serializePairingAuthorizationData(
                                  createPairingAuthorizationData(pairing, deviceIdentity),
                                )
                              : ''
                          }
                        />
                      </label>
                      <button type="button" onClick={() => void copyPairingAuthorizationData()}>
                        Copiar datos de autorización
                      </button>
                      <small role="status">
                        {pairingCopyFeedback ||
                          'El bloque no incluye credential, request token ni PIN.'}
                      </small>
                      <label>
                        Autorización de instalación
                        <textarea
                          aria-label="Autorización de instalación"
                          placeholder="Pega aquí la autorización emitida por Super Admin"
                          value={bootstrapAuthorization}
                          onChange={(e) => setBootstrapAuthorization(e.target.value)}
                        />
                      </label>
                      <label>
                        PIN inicial de propietario
                        <input
                          aria-label="PIN inicial de propietario"
                          type="password"
                          inputMode="numeric"
                          placeholder="4 a 12 dígitos"
                          value={bootstrapPin}
                          onChange={(e) =>
                            setBootstrapPin(e.target.value.replace(/\D/g, '').slice(0, 12))
                          }
                        />
                      </label>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void finishBootstrap()}
                        disabled={
                          bootstrapPending || !bootstrapAuthorization || bootstrapPin.length < 4
                        }
                      >
                        {bootstrapPending ? 'Completando…' : 'Completar instalación inicial'}
                      </button>
                    </>
                  )}
                  {getPairingUxState(pairing.currentStatus) === 'AUTHORIZED' && (
                    <p>Dispositivo autorizado. Ya puedes iniciar sesión.</p>
                  )}
                  {getPairingUxState(pairing.currentStatus) === 'RETRY' && (
                    <>
                      <p>
                        La solicitud de emparejamiento está{' '}
                        {pairing.currentStatus === 'EXPIRED' ? 'expirada' : 'cancelada'} y ya no
                        puede completar la instalación.
                      </p>
                      <button type="button" onClick={() => void restartPairing()}>
                        Solicitar código nuevo
                      </button>
                    </>
                  )}
                </>
              )}
              <div className="pairing-feedback" aria-live="polite">
                {pairingError ? (
                  <span className="inline-alert inline-alert--error">{pairingError}</span>
                ) : pairingNotice ? (
                  <span className="inline-alert inline-alert--success">{pairingNotice}</span>
                ) : (
                  <span>&nbsp;</span>
                )}
              </div>
            </section>
          )}
          <small>Tu acceso se valida en este restaurante.</small>
        </form>
      </main>
    );
  }

  return (
    <div className="pos-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <strong>ComanView</strong>
            <span>Punto de venta</span>
          </div>
        </div>
        <div className="topbar-statuses">
          <div className="operator-identity">
            <div>
              <strong>{authUser.displayName}</strong>
              <span>{authUser.roles.map(roleLabel).join(' · ')}</span>
            </div>
            <button type="button" onClick={() => void logout()}>
              Cerrar sesión
            </button>
            {(hasPermission(PermissionCodes.ADMINISTRATION_VIEW) ||
              hasPermission(PermissionCodes.PERSONNEL_VIEW)) && (
              <button
                type="button"
                onClick={() => {
                  setAdministrationTarget(null);
                  setAdministrationOpen(true);
                }}
              >
                Restaurante
              </button>
            )}
            {hasPermission(PermissionCodes.DEVICE_VIEW) && (
              <button type="button" onClick={() => void openDeviceAdmin()}>
                Dispositivos y respaldo
              </button>
            )}
          </div>
          <button
            className={`cash-status ${cashSession ? 'cash-status--open' : ''}`}
            type="button"
            disabled={!hasPermission(PermissionCodes.CASH_SESSION_OPEN) && !cashSession}
            onClick={() => {
              if (cashSession && hasPermission(PermissionCodes.CASH_SESSION_VIEW)) {
                setCashReport(null);
                setClosingPreview(null);
                setCashModalError(null);
                setShowCashOperations(true);
              } else if (hasPermission(PermissionCodes.CASH_SESSION_OPEN)) {
                setOpenCashError(null);
                setShowOpenCash(true);
              }
            }}
          >
            <strong>
              {!hasPermission(PermissionCodes.CASH_SESSION_VIEW)
                ? 'Caja restringida'
                : cashSession
                  ? 'Caja abierta'
                  : 'Caja cerrada'}
            </strong>
            <span>
              {!hasPermission(PermissionCodes.CASH_SESSION_VIEW)
                ? 'Sin permiso de caja'
                : cashSession
                  ? `${cashSession.businessDate} · ${cashSession.expectedCash ? `Esperado ${formatMoney(cashSession.expectedCash.amount, cashSession.expectedCash.currency)}` : 'Arqueo ciego'}`
                  : !hasPermission(PermissionCodes.CASH_SESSION_OPEN)
                    ? 'Solicita apertura a un responsable'
                    : 'Abrir para cobrar'}
            </span>
          </button>
          <ConnectionStatus
            connection={connection}
            networkAvailable={networkAvailable}
            degraded={operationalDegraded}
            onRetry={() => void retryConnection()}
          />
        </div>
      </header>
      {deviceAdminOpen && (
        <DeviceAdminPanel
          state={deviceAdmin}
          loading={deviceAdminLoading}
          error={deviceAdminError}
          notice={deviceAdminNotice}
          busyAction={deviceAdminBusy}
          currentDeviceId={deviceIdentity?.deviceId ?? null}
          canPair={hasPermission(PermissionCodes.DEVICE_PAIR)}
          canRevoke={hasPermission(PermissionCodes.DEVICE_REVOKE)}
          approvalPairingId={approvalPairingId}
          approvalCode={approvalCode}
          onApprovalPairingId={setApprovalPairingId}
          onApprovalCode={setApprovalCode}
          onApprove={() => void approveDevice()}
          onCancel={cancelDevicePairing}
          onRevoke={revokeDevice}
          onRefresh={() => void refreshDeviceAdmin('refresh')}
          onCreateBackup={createBackup}
          onConfigureOffDevice={configureOffDeviceBackup}
          onExportRecoveryKey={exportRecoveryKey}
          onRestoreBackup={restoreBackup}
          onNavigate={navigateToGuidance}
          canNavigate={canNavigateToGuidance}
          onClose={() => {
            if (!deviceAdminBusy) {
              setDeviceAdminOpen(false);
              setDeviceAdminError(null);
              setDeviceAdminNotice(null);
            }
          }}
        />
      )}
      {administrationOpen && authUser && (
        <AdministrationPanel
          edge={edge}
          currentUserId={authUser.id}
          permissions={authUser.permissions}
          initialTarget={administrationTarget}
          onNavigate={navigateToGuidance}
          onClose={() => setAdministrationOpen(false)}
        />
      )}
      {recoveryRequired && (
        <InlineAlert tone="critical" title="Recuperación requerida" urgent>
          La instalación requiere una recuperación segura. Las ventas no deben continuar hasta
          validar su estado.
        </InlineAlert>
      )}
      {connection === 'DISCONNECTED' && (
        <div className="critical-banner" role="alert">
          <strong>Servicio local no disponible.</strong> Las operaciones pendientes de respuesta no
          están confirmadas. No las repitas sin revisar su estado.
        </div>
      )}
      {licensing && !['FULL', 'FULL_WITH_WARNING'].includes(licensing.mode) && (
        <div
          className={`license-banner license-banner--${licensing.mode.toLowerCase()}`}
          role="status"
        >
          <strong>{licenseModeLabel(licensing.mode)}</strong>
          <span>
            {licensing.mode === 'GRACE_OPERATING'
              ? `Período de gracia hasta ${licensing.graceUntil ? new Date(licensing.graceUntil).toLocaleString('es-MX') : 'fecha no disponible'}.`
              : licensing.mode === 'GUARANTEED_SHIFT'
                ? 'Turno actual protegido. Cierra la caja para aplicar la política pendiente.'
                : licensing.mode === 'PROTECTED_OPERATIONS' ||
                    licensing.mode === 'GUARANTEED_SHIFT_RECOVERY'
                  ? 'Modo de recuperación: solo pueden liquidarse ventas protegidas existentes.'
                  : 'La licencia bloquea nueva operación. Contacta administración.'}
          </span>
        </div>
      )}
      {!showPayment && !showOpenTables && !showOpenCounterOrders && !configuredProduct && !showOpenCash && !showCashOperations && !voidPaymentId && operationalFeedback}
      {operationConfirmation}

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
          <label className="product-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={productSearch}
              aria-label="Buscar producto"
              placeholder="Buscar producto..."
              onChange={(event) => setProductSearch(event.target.value)}
            />
          </label>
          {!hasPermission(PermissionCodes.CATALOG_VIEW) ? (
            <div className="empty-state">
              <strong>Tu rol no permite consultar el menú</strong>
              <p>Solicita a un responsable el acceso que necesitas.</p>
            </div>
          ) : loadingCatalog ? (
            <div className="empty-state">
              <span className="spinner" />
              <strong>Cargando productos</strong>
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">◇</span>
              <strong>No hay productos disponibles</strong>
            </div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <PosAction
                  reason={!product.available ? 'Este producto está agotado.' : editReason}
                  type="button"
                  className={`product-card ${!product.available ? 'product-card--unavailable' : ''}`}
                  key={product.id}
                  disabled={
                    !product.available ||
                    !canOperateOrder ||
                    !hasPermission(PermissionCodes.ORDER_EDIT_DRAFT)
                  }
                  onClick={() => chooseProduct(product)}
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
                      {product.available
                        ? order
                          ? getActiveModifierGroups(product).length > 0
                            ? 'Configurar'
                            : 'Agregar +'
                          : 'Crea una venta'
                        : 'Agotado'}
                    </span>
                  </span>
                </PosAction>
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
                    : order.orderType === 'TABLE'
                      ? tables
                          .filter((table) => order.tableIds.includes(table.id))
                          .map((table) => table.name)
                          .join(' + ') || 'Mesa'
                      : 'Mostrador'
                  : 'Sin venta abierta'}
              </h2>
              {order && (
                <span className="order-meta">
                  {order.orderType === 'TABLE' ? 'Pedido de mesa' : 'Venta de mostrador'} ·{' '}
                  {order.items.length} líneas
                </span>
              )}
            </div>
            <div className="order-header-actions">
              <PosAction
                reason={
                  !hasPermission(PermissionCodes.ORDER_VIEW)
                    ? 'Tu rol no permite consultar ventas.'
                    : isBusy
                      ? 'Espera la operación en curso.'
                      : 'Restablece la conexión local.'
                }
                type="button"
                className="open-tables-button"
                disabled={
                  isBusy || connection !== 'CONNECTED' || !hasPermission(PermissionCodes.ORDER_VIEW)
                }
                onClick={() => {
                  clearFeedback();
                  setShowOpenCounterOrders(true);
                  void refreshCounterSales();
                }}
              >
                Ventas abiertas · <span>{openCounterOrders.length}</span>
              </PosAction>
              <PosAction
                reason={
                  !hasPermission(PermissionCodes.ORDER_VIEW)
                    ? 'Tu rol no permite consultar ventas.'
                    : isBusy
                      ? 'Espera la operación en curso.'
                      : 'Restablece la conexión local.'
                }
                type="button"
                className="open-tables-button"
                disabled={
                  isBusy || connection !== 'CONNECTED' || !hasPermission(PermissionCodes.ORDER_VIEW)
                }
                onClick={() => {
                  clearFeedback();
                  setOpenTablesError(null);
                  setShowOpenTables(true);
                  void refreshOperationalState();
                }}
              >
                Mesas abiertas · <span>{openTableAccounts.length}</span>
              </PosAction>
              <PosAction
                reason={createReason}
                type="button"
                className="new-order-button"
                disabled={
                  isBusy ||
                  connection !== 'CONNECTED' ||
                  !licenseAllowsNewOrders ||
                  !hasPermission(PermissionCodes.ORDER_CREATE)
                }
                onClick={() => void createOrder()}
              >
                {pendingAction === 'create-order' ? 'Creando…' : order ? 'Nueva' : 'Crear venta'}
              </PosAction>
            </div>
          </div>
          {!order ? (
            <div className="order-empty">
              <span>＋</span>
              <strong>Inicia una venta de mostrador</strong>
              <p>Crea una venta y agrega productos.</p>
              <PosAction
                reason={createReason}
                type="button"
                className="primary-button"
                disabled={
                  isBusy ||
                  connection !== 'CONNECTED' ||
                  !licenseAllowsNewOrders ||
                  !hasPermission(PermissionCodes.ORDER_CREATE)
                }
                onClick={() => void createOrder()}
              >
                Crear venta de mostrador
              </PosAction>
            </div>
          ) : (
            <>
              <div className="order-items">
                {order.items.length === 0 && (
                  <div className="order-empty compact">
                    <strong>La venta está vacía</strong>
                    <p>
                      Selecciona un producto. Solo puedes descartar una venta de mostrador abierta
                      sin productos, rondas ni pagos.
                    </p>
                    {hasPermission(PermissionCodes.ORDER_CANCEL) &&
                      isDiscardableCounterSale(order) && (
                        <Button
                          variant="danger"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void cancelEmptyCounterOrder()}
                        >
                          Descartar venta vacía
                        </Button>
                      )}
                  </div>
                )}
                {draftItems.length > 0 && (
                  <section className="item-group">
                    <div className="item-group-heading">
                      <h3>
                        <span className="status-dot status-dot--draft" />
                        Sin enviar
                      </h3>
                      <span>{draftItems.length} sin enviar</span>
                    </div>
                    {draftItems.map((item) => (
                      <article className="order-item order-item--draft" key={item.id}>
                        <div>
                          <strong>{item.productSnapshot.productName}</strong>
                          {item.productSnapshot.selectedModifiers.length > 0 && (
                            <ul className="order-item-modifiers">
                              {item.productSnapshot.selectedModifiers.map((modifier) => (
                                <li key={modifier.modifierOptionId}>
                                  {modifier.name}
                                  {modifier.priceDelta.amount !== 0 && (
                                    <span>
                                      +
                                      {formatMoney(
                                        modifier.priceDelta.amount,
                                        modifier.priceDelta.currency,
                                      )}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {item.specialInstructions && (
                            <p className="special-instructions">Nota: {item.specialInstructions}</p>
                          )}
                          <span>
                            {itemStatusLabel(item.status)} · Cantidad: {item.quantity ?? 1}
                          </span>
                        </div>
                        <div className="order-item-actions">
                          <strong>
                            {formatMoney(
                              item.lineTotal?.amount ?? getSnapshotTotal(item.productSnapshot),
                              item.productSnapshot.basePrice.currency,
                            )}
                          </strong>
                          <PosAction
                            reason={editReason}
                            type="button"
                            className="edit-button"
                            disabled={
                              !canOperateOrder || !hasPermission(PermissionCodes.ORDER_EDIT_DRAFT)
                            }
                            onClick={() => beginEditDraftItem(item)}
                          >
                            Editar
                          </PosAction>
                          <PosAction
                            reason={editReason}
                            type="button"
                            disabled={
                              !canOperateOrder || !hasPermission(PermissionCodes.ORDER_EDIT_DRAFT)
                            }
                            onClick={() => void removeItem(item.id)}
                          >
                            Eliminar
                          </PosAction>
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
                          {item.productSnapshot.selectedModifiers.length > 0 && (
                            <ul className="order-item-modifiers">
                              {item.productSnapshot.selectedModifiers.map((modifier) => (
                                <li key={modifier.modifierOptionId}>
                                  {modifier.name}
                                  {modifier.priceDelta.amount !== 0 && (
                                    <span>
                                      +
                                      {formatMoney(
                                        modifier.priceDelta.amount,
                                        modifier.priceDelta.currency,
                                      )}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {item.specialInstructions && (
                            <p className="special-instructions protected">
                              Nota: {item.specialInstructions}
                            </p>
                          )}
                          <span>
                            {itemStatusLabel(item.status)} · Cantidad: {item.quantity ?? 1}
                          </span>
                        </div>
                        <strong>
                          {formatMoney(
                            item.lineTotal?.amount ?? getSnapshotTotal(item.productSnapshot),
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
                          <strong>{paymentMethodLabel(payment.method)}</strong>
                          <span>
                            {paymentStatusLabel(payment.status)}
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
                        {order.status === 'OPEN' && payment.status === 'COMPLETED' && (
                          <button
                            type="button"
                            className="void-payment-button"
                            disabled={isBusy}
                            onClick={() => {
                              setVoidPaymentId(payment.id);
                              setVoidReason('');
                              setOverridePin('');
                              setOverrideError(null);
                            }}
                          >
                            {hasPermission(PermissionCodes.PAYMENT_VOID)
                              ? 'Anular'
                              : 'Autorizar anulación'}
                          </button>
                        )}
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
                  {order.taxTotal && (
                    <>
                      <div>
                        <span>Base</span>
                        <strong>{formatMoney(order.subtotal.amount, order.currency)}</strong>
                      </div>
                      <div>
                        <span>Impuestos</span>
                        <strong>{formatMoney(order.taxTotal.amount, order.currency)}</strong>
                      </div>
                    </>
                  )}
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
                    <PosAction
                      reason={
                        !hasPermission(PermissionCodes.ORDER_SEND)
                          ? 'Tu rol no permite enviar pedidos.'
                          : (operationReason ??
                            (draftItems.length === 0 ? 'No hay productos sin enviar.' : null))
                      }
                      type="button"
                      className="send-button"
                      disabled={
                        draftItems.length === 0 ||
                        !canOperateOrder ||
                        !hasPermission(PermissionCodes.ORDER_SEND)
                      }
                      onClick={() => void sendRound()}
                    >
                      <span>{pendingAction === 'send-round' ? 'Enviando…' : 'Enviar ronda'}</span>
                      <small>{draftItems.length} sin enviar</small>
                    </PosAction>
                    <PosAction
                      reason={
                        !hasPermission(PermissionCodes.PRINT_PRECHECK)
                          ? 'Tu rol no permite solicitar precuentas.'
                          : (operationReason ??
                            (order?.items.length === 0
                              ? 'Agrega productos antes de pedir la precuenta.'
                              : null))
                      }
                      type="button"
                      className="secondary-order-button"
                      disabled={
                        order.items.length === 0 ||
                        !canOperateOrder ||
                        !hasPermission(PermissionCodes.PRINT_PRECHECK)
                      }
                      onClick={() => void requestPrint('PRECHECK')}
                    >
                      {pendingAction === 'precheck' ? 'Encolando…' : 'Precuenta'}
                    </PosAction>
                    <PosAction
                      reason={
                        !hasPermission(PermissionCodes.PAYMENT_CREATE)
                          ? 'Tu rol no permite registrar pagos.'
                          : (operationReason ??
                            (order?.items.length === 0
                              ? 'Agrega productos a la venta.'
                              : order?.balanceDue.amount === 0
                                ? 'La venta no tiene saldo pendiente.'
                                : null))
                      }
                      type="button"
                      className="payment-button"
                      disabled={
                        order.balanceDue.amount === 0 ||
                        order.items.length === 0 ||
                        !canOperateOrder ||
                        !hasPermission(PermissionCodes.PAYMENT_CREATE)
                      }
                      onClick={beginPayment}
                    >
                      {cashSession ? 'Cobrar' : 'Abrir caja para cobrar'}
                    </PosAction>
                    {order.balanceDue.amount === 0 && order.items.length > 0 && (
                      <>
                        <PosAction
                          reason={
                            !hasPermission(PermissionCodes.ORDER_CLOSE)
                              ? 'Tu rol no permite cerrar ventas.'
                              : (operationReason ??
                                (draftItems.length > 0
                                  ? 'Envía o elimina los productos sin enviar.'
                                  : null))
                          }
                          type="button"
                          className="close-order-button"
                          disabled={
                            !canOperateOrder ||
                            draftItems.length > 0 ||
                            !hasPermission(PermissionCodes.ORDER_CLOSE)
                          }
                          onClick={() => void closeOrder()}
                        >
                          {pendingAction === 'close-order' ? 'Cerrando…' : 'Cerrar venta'}
                        </PosAction>
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
                  <>
                    <div className="closed-callout">✓ Venta cerrada y balanceada</div>
                    <PosAction
                      reason={
                        !hasPermission(PermissionCodes.PRINT_RECEIPT)
                          ? 'Tu rol no permite solicitar recibos.'
                          : isBusy
                            ? 'Espera la operación en curso.'
                            : 'Restablece la conexión local.'
                      }
                      type="button"
                      className="secondary-order-button receipt-button"
                      disabled={
                        isBusy ||
                        connection !== 'CONNECTED' ||
                        !hasPermission(PermissionCodes.PRINT_RECEIPT)
                      }
                      onClick={() => void requestPrint('CUSTOMER_RECEIPT')}
                    >
                      {pendingAction === 'receipt' ? 'Encolando…' : 'Generar recibo'}
                    </PosAction>
                  </>
                )}
                {!cashSession &&
                  order.status === 'OPEN' &&
                  hasPermission(PermissionCodes.CASH_SESSION_OPEN) && (
                    <button
                      type="button"
                      className="cash-required"
                      onClick={() => setShowOpenCash(true)}
                    >
                      Abre la caja para poder cobrar
                    </button>
                  )}
                {!cashSession &&
                  order.status === 'OPEN' &&
                  !hasPermission(PermissionCodes.CASH_SESSION_OPEN) && (
                    <p className="close-order-hint">
                      Para cobrar, solicita a un responsable que abra el turno de caja. Tu rol no
                      permite abrirlo.
                    </p>
                  )}
              </footer>
            </>
          )}
        </aside>
      </main>

      {showOpenTables && (
        <PosDialog
          title="Mesas abiertas"
          className="payment-modal open-tables-modal"
          busy={isBusy}
          onClose={() => {
            setShowOpenTables(false);
          }}
        >
          {operationalFeedback}
          <div inert={isBusy} aria-busy={isBusy}>
            <p className="open-tables-help">Selecciona una cuenta para recuperarla y cobrarla.</p>
            <div className="open-table-account-list">
              {openTableAccounts.map((account) => (
                <button
                  key={account.orderId}
                  type="button"
                  disabled={isBusy}
                  onClick={() => void openTableOrder(account.orderId, account.tableNames)}
                >
                  <span>
                    <strong>{account.tableNames.join(' + ')}</strong>
                    <small>Pedido #{account.orderNumber}</small>
                    {account.balanceDue && (
                      <small>
                        Saldo {formatMoney(account.balanceDue.amount, account.balanceDue.currency)}
                      </small>
                    )}
                    {(account.readyItemCount > 0 || account.preparingItemCount > 0) && (
                      <small>
                        {account.preparingItemCount} preparando · {account.readyItemCount} listo
                      </small>
                    )}
                  </span>
                  <b className={`table-operational-status ${account.status.toLowerCase()}`}>
                    {getTableStatusLabel(account.status)}
                  </b>
                </button>
              ))}
              {openTableAccounts.length === 0 && (
                <div className="open-tables-empty">No hay mesas ocupadas en este momento.</div>
              )}
            </div>
            <div className="modal-error-slot" role="alert">
              {openTablesError ?? '\u00a0'}
            </div>
          </div>
        </PosDialog>
      )}

      {showOpenCounterOrders && (
        <PosDialog
          title="Ventas abiertas"
          className="payment-modal open-tables-modal"
          busy={isBusy}
          onClose={() => {
            setShowOpenCounterOrders(false);
          }}
        >
          {operationalFeedback}
          <div inert={isBusy} aria-busy={isBusy}>
            <p className="open-tables-help">
              Recupera una venta o abre una vacía para descartarla de forma segura.
            </p>
            {counterError && <p role="alert">{counterError}</p>}
            <Button variant="secondary" type="button" disabled={isBusy} onClick={() => void refreshCounterSales()}>
              Actualizar
            </Button>
            <div className="open-table-account-list">
              {openCounterOrders.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() => void openCounterOrder(candidate)}
                >
                  <span>
                    <strong>
                      {candidate.items.length === 0
                        ? 'Venta vacía'
                        : `${candidate.items.length} productos`}
                    </strong>
                    <small>{new Date(candidate.createdAt).toLocaleString('es-MX')}</small>
                  </span>
                  <b>{formatMoney(candidate.balanceDue.amount, candidate.balanceDue.currency)}</b>
                </button>
              ))}
              {openCounterOrders.length === 0 && (
                <div className="open-tables-empty">No hay ventas de mostrador abiertas.</div>
              )}
            </div>
          </div>
        </PosDialog>
      )}

      <PrintingStatus jobs={printJobs} unavailable={printStatusUnavailable} />

      {configuredProduct && (
        <PosDialog
          title="Configurar producto"
          className="payment-modal modifier-modal"
          busy={isBusy}
          onClose={() => {
            setConfiguredProduct(null);
            setEditingConfiguredItemId(null);
            setSelectedModifierIds([]);
            setModifierValidation(null);
            setConfiguredSpecialInstructions('');
          }}
        >
          {operationalFeedback}
          <div inert={isBusy} aria-busy={isBusy}>
            <h3>{configuredProduct.name}</h3>
            <p className="modifier-base-price">
              Precio base{' '}
              <strong>
                {formatMoney(
                  configuredProduct.basePrice.amount,
                  configuredProduct.basePrice.currency,
                )}
              </strong>
            </p>
            <div className="modifier-groups">
              {getActiveModifierGroups(configuredProduct).map((group) => {
                const optionIds = new Set(group.modifierGroup.options.map(({ id }) => id));
                const selectionCount = selectedModifierIds.filter((id) => optionIds.has(id)).length;
                const validationMessage = getModifierGroupValidationMessage(
                  group,
                  selectedModifierIds,
                );
                return (
                  <fieldset
                    className={validationMessage ? 'modifier-group invalid' : 'modifier-group'}
                    key={group.modifierGroup.id}
                  >
                    <legend>
                      <span>{group.modifierGroup.name}</span>
                      <small>
                        {group.modifierGroup.minSelections > 0
                          ? `Requerido · ${group.modifierGroup.minSelections}`
                          : 'Opcional'}{' '}
                        · máx. {group.modifierGroup.maxSelections}
                      </small>
                    </legend>
                    <div className="modifier-options">
                      {[...group.modifierGroup.options]
                        .sort(
                          (left, right) =>
                            left.displayOrder - right.displayOrder ||
                            left.name.localeCompare(right.name),
                        )
                        .map((option) => {
                          const selected = selectedModifierIds.includes(option.id);
                          const available = option.active && option.available;
                          const price = getEffectiveModifierPrice(group, option.id);
                          return (
                            <button
                              type="button"
                              className={selected ? 'modifier-option selected' : 'modifier-option'}
                              aria-pressed={selected}
                              disabled={!available}
                              key={option.id}
                              onClick={() => toggleModifier(group.modifierGroup.id, option.id)}
                            >
                              <span className="modifier-choice">
                                <span aria-hidden="true">
                                  {group.modifierGroup.maxSelections === 1
                                    ? selected
                                      ? '◉'
                                      : '○'
                                    : selected
                                      ? '☑'
                                      : '☐'}
                                </span>
                                <strong>{option.name}</strong>
                              </span>
                              <span className="modifier-price">
                                {!available
                                  ? option.active
                                    ? 'Agotado'
                                    : 'No disponible'
                                  : price === 0
                                    ? 'Sin costo'
                                    : `+${formatMoney(price, option.defaultPriceDelta.currency)}`}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                    <small className="modifier-selection-count">
                      {selectionCount} de {group.modifierGroup.maxSelections} seleccionados
                    </small>
                    {validationMessage && (
                      <small className="modifier-group-validation" role="alert">
                        {validationMessage}
                      </small>
                    )}
                  </fieldset>
                );
              })}
            </div>
            <label className="special-instructions-field">
              Instrucciones especiales
              <textarea
                maxLength={500}
                placeholder="Ej. salsa aparte"
                value={configuredSpecialInstructions}
                onChange={(event) => setConfiguredSpecialInstructions(event.target.value)}
              />
              <small>{configuredSpecialInstructions.length}/500 · no modifica el precio</small>
            </label>
            {modifierValidation && (
              <p className="modifier-validation" role="alert">
                {modifierValidation}
              </p>
            )}
            <footer className="modifier-footer">
              <div>
                <span>Total del producto</span>
                <strong>
                  {formatMoney(
                    getConfiguredProductTotal(configuredProduct, selectedModifierIds),
                    configuredProduct.basePrice.currency,
                  )}
                </strong>
              </div>
              <button
                type="button"
                className="confirm-payment"
                disabled={
                  isBusy ||
                  getUnsatisfiedModifierGroups(configuredProduct, selectedModifierIds).length > 0
                }
                onClick={() => void submitConfiguredProduct()}
              >
                {pendingAction ===
                (editingConfiguredItemId
                  ? `edit-${editingConfiguredItemId}`
                  : `add-${configuredProduct.id}`)
                  ? 'Confirmando…'
                  : editingConfiguredItemId
                    ? 'Guardar cambios'
                    : 'Agregar a la venta'}
              </button>
            </footer>
          </div>
        </PosDialog>
      )}

      {showOpenCash && hasPermission(PermissionCodes.CASH_SESSION_OPEN) && (
        <PosDialog
          title="Abrir turno de caja"
          className="payment-modal"
          busy={isBusy}
          onClose={() => {
            setOpenCashError(null);
            setShowOpenCash(false);
          }}
        >
          {operationalFeedback}
          <div inert={isBusy} aria-busy={isBusy}>
            <PosFeedback
              message={openCashError}
              guidance={cashGuidance}
              onNavigate={navigateToGuidance}
              canNavigate={canNavigateToGuidance}
            />
            <form onSubmit={(event) => void openCash(event)}>
              <label>
                Fecha de referencia del dispositivo
                <input type="date" value={getLocalBusinessDate()} readOnly />
                <small>
                  El día de negocio lo determina la configuración del restaurante, no esta fecha de
                  referencia.
                </small>
              </label>
              <label>
                Fondo inicial
                <input
                  inputMode="decimal"
                  value={openingFloat}
                  onChange={(event) => {
                    setOpeningFloat(event.target.value);
                    setOpenCashError(null);
                  }}
                  autoFocus
                />
              </label>
              <p className="field-help">
                {licensing?.mode === 'PROTECTED_OPERATIONS'
                  ? 'Esta sesión solo permite cobrar y cerrar las ventas protegidas existentes.'
                  : 'Indica el efectivo disponible al iniciar el turno. El arqueo partirá de este fondo.'}
              </p>

              <button className="confirm-payment" disabled={isBusy} type="submit">
                {pendingAction === 'open-cash' ? 'Abriendo…' : 'Abrir turno de caja'}
              </button>
            </form>
          </div>
        </PosDialog>
      )}

      {showCashOperations && (
        <PosDialog
          title="Caja y cortes"
          className="payment-modal cash-operations-modal"
          busy={isBusy}
          onClose={() => {
            setCashModalError(null);
            setShowCashOperations(false);
          }}
        >
          {operationalFeedback}
          <div inert={isBusy} aria-busy={isBusy}>
            <PosFeedback
              message={cashModalError}
              guidance={cashGuidance}
              onNavigate={navigateToGuidance}
              canNavigate={canNavigateToGuidance}
            />

            {cashSession ? (
              <>
                <div className="cash-session-brief">
                  <span>Día de negocio</span>
                  <strong>{cashSession.businessDate}</strong>
                  <small>
                    Turno de caja abierto · Arqueo{' '}
                    {cashSession.blindCashCount ? 'ciego' : 'visible'}.
                  </small>
                </div>

                {hasPermission(PermissionCodes.CASH_MOVEMENT_CREATE) && (
                  <form
                    className="cash-operation-section"
                    onSubmit={(event) => void createCashMovement(event)}
                  >
                    <div className="cash-operation-heading">
                      <h3>Movimiento de efectivo</h3>
                      <CashMovementTypeSelector
                        value={cashMovementType}
                        onChange={setCashMovementType}
                      />
                    </div>
                    <div className="cash-movement-fields">
                      <label>
                        Importe
                        <input
                          inputMode="decimal"
                          value={cashMovementAmount}
                          onChange={(event) => {
                            setCashMovementAmount(event.target.value);
                            setCashModalError(null);
                          }}
                        />
                      </label>
                      <label>
                        Motivo
                        <input
                          maxLength={240}
                          value={cashMovementReason}
                          onChange={(event) => {
                            setCashMovementReason(event.target.value);
                            setCashModalError(null);
                          }}
                        />
                      </label>
                    </div>
                    <button className="secondary-order-button" type="submit" disabled={isBusy}>
                      {pendingAction === 'cash-movement' ? 'Registrando…' : 'Confirmar movimiento'}
                    </button>
                  </form>
                )}

                <div className="cash-report-actions">
                  {hasPermission(PermissionCodes.CASH_REPORT_X) && (
                    <button
                      type="button"
                      className="secondary-order-button"
                      disabled={isBusy}
                      onClick={() => void generateXReport()}
                    >
                      {pendingAction === 'x-report' ? 'Generando…' : 'Generar Corte X'}
                    </button>
                  )}
                </div>

                {hasPermission(PermissionCodes.CASH_SESSION_CLOSE) && (
                  <form
                    className="cash-operation-section blind-count"
                    onSubmit={(event) => void previewCashClose(event)}
                  >
                    <div className="cash-operation-heading">
                      <div>
                        <h3>Cerrar caja · Corte Z</h3>
                        <small>
                          {cashSession.blindCashCount
                            ? 'Cuenta el efectivo antes de revelar el esperado.'
                            : 'Declara el efectivo contado para calcular la diferencia.'}
                        </small>
                      </div>
                    </div>
                    <label>
                      Efectivo físicamente contado
                      <input
                        inputMode="decimal"
                        value={countedCash}
                        onChange={(event) => {
                          setCountedCash(event.target.value);
                          setClosingPreview(null);
                          setCashReport(null);
                          setCashModalError(null);
                        }}
                      />
                    </label>
                    <button className="secondary-order-button" type="submit" disabled={isBusy}>
                      {pendingAction === 'close-preview' ? 'Calculando…' : 'Confirmar conteo'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <div className="cash-session-brief cash-session-closed">
                <strong>Turno de caja cerrado</strong>
                <span>
                  El Corte Z quedó persistido. Puedes abrir una nueva caja con otro fondo.
                </span>
              </div>
            )}

            {visibleCashSummary && (
              <section className="cash-report-summary" aria-live="polite">
                <div className="cash-operation-heading">
                  <div>
                    <span className="eyebrow">
                      {cashReport?.reportType === 'Z'
                        ? 'Corte Z'
                        : cashReport
                          ? 'Corte X'
                          : 'Resultado del arqueo'}
                    </span>
                    <h3>Resumen financiero</h3>
                  </div>
                  {'printJobId' in visibleCashSummary && visibleCashSummary.printJobId && (
                    <small>Impresión encolada</small>
                  )}
                </div>
                <div className="cash-report-grid">
                  <span>
                    Fondo inicial
                    <strong>
                      {formatMoney(
                        visibleCashSummary.openingFloat.amount,
                        visibleCashSummary.currency,
                      )}
                    </strong>
                  </span>
                  <span>
                    Ventas en efectivo
                    <strong>
                      {formatMoney(
                        visibleCashSummary.salesByMethod.CASH.amount,
                        visibleCashSummary.currency,
                      )}
                    </strong>
                  </span>
                  <span>
                    Ventas con tarjeta
                    <strong>
                      {formatMoney(
                        visibleCashSummary.salesByMethod.CARD.amount,
                        visibleCashSummary.currency,
                      )}
                    </strong>
                  </span>
                  <span>
                    Entradas de efectivo
                    <strong>
                      {formatMoney(visibleCashSummary.cashIn.amount, visibleCashSummary.currency)}
                    </strong>
                  </span>
                  <span>
                    Salidas de efectivo
                    <strong>
                      {formatMoney(visibleCashSummary.cashOut.amount, visibleCashSummary.currency)}
                    </strong>
                  </span>
                  <span>
                    Esperado
                    <strong>
                      {formatMoney(
                        visibleCashSummary.expectedCash.amount,
                        visibleCashSummary.currency,
                      )}
                    </strong>
                  </span>
                  {visibleCashSummary.countedCash && (
                    <span>
                      Contado
                      <strong>
                        {formatMoney(
                          visibleCashSummary.countedCash.amount,
                          visibleCashSummary.currency,
                        )}
                      </strong>
                    </span>
                  )}
                  {cashDifference && (
                    <span className={`cash-difference cash-difference--${cashDifference.tone}`}>
                      {cashDifference.label}
                      <strong>{cashDifference.value}</strong>
                    </span>
                  )}
                </div>
                {closingPreview && cashSession && (
                  <button
                    type="button"
                    className="confirm-payment danger"
                    disabled={isBusy}
                    onClick={() => void confirmCashClose()}
                  >
                    {pendingAction === 'close-cash'
                      ? 'Cerrando…'
                      : 'Confirmar Corte Z y cerrar caja'}
                  </button>
                )}
              </section>
            )}
          </div>
        </PosDialog>
      )}

      {voidPaymentId && order && (
        <PosDialog
          title="Anular pago"
          className="payment-modal override-modal"
          busy={isBusy}
          onClose={() => {
            cancelPaymentVoid();
          }}
        >
          {operationalFeedback}
          <div inert={isBusy} aria-busy={isBusy}>
            <p className="override-summary">
              Esta acción conserva el pago histórico como anulado y registra quién operó y quién
              autorizó.
            </p>
            <form onSubmit={(event) => void submitPaymentVoid(event)}>
              <label>
                Motivo obligatorio
                <textarea
                  maxLength={240}
                  value={voidReason}
                  onChange={(event) => setVoidReason(event.target.value)}
                  autoFocus={hasPermission(PermissionCodes.PAYMENT_VOID)}
                />
                <small>{voidReason.trim().length}/240</small>
              </label>
              {!hasPermission(PermissionCodes.PAYMENT_VOID) && (
                <label>
                  PIN de gerente o propietario
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    minLength={4}
                    maxLength={12}
                    value={overridePin}
                    onChange={(event) =>
                      setOverridePin(event.target.value.replace(/\D/g, '').slice(0, 12))
                    }
                    autoFocus
                  />
                  <small>Autoriza solo esta anulación; tu sesión no cambia.</small>
                </label>
              )}
              <div
                className={`override-feedback${overrideError ? ' override-feedback--error' : ''}`}
                role="status"
                aria-live="polite"
              >
                {overrideError ?? '\u00a0'}
              </div>
              <div className="override-actions">
                <button
                  type="button"
                  className="secondary-order-button"
                  onClick={cancelPaymentVoid}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="confirm-payment danger"
                  disabled={
                    isBusy ||
                    voidReason.trim().length === 0 ||
                    (!hasPermission(PermissionCodes.PAYMENT_VOID) && overridePin.length < 4)
                  }
                >
                  {pendingAction === `void-${voidPaymentId}`
                    ? 'Autorizando…'
                    : 'Autorizar y anular'}
                </button>
              </div>
            </form>
          </div>
        </PosDialog>
      )}

      {showPayment && order && (
        <PosDialog
          title="Registrar pago"
          className="payment-modal payment-workspace"
          busy={isBusy}
          onClose={() => {
            setShowPayment(false);
          }}
        >
          {operationalFeedback}
          <div className="payment-workspace-grid" inert={isBusy} aria-busy={isBusy}>
            <PaymentSummary order={order} />
            <form onSubmit={(event) => void submitPayment(event)}>
              <div className="method-selector" role="group" aria-label="Método de pago">
                <button
                  type="button"
                  aria-pressed={paymentMethod === 'CASH'}
                  className={paymentMethod === 'CASH' ? 'active' : ''}
                  onClick={() => setPaymentMethod('CASH')}
                >
                  Efectivo
                </button>
                <button
                  type="button"
                  aria-pressed={paymentMethod === 'CARD'}
                  className={paymentMethod === 'CARD' ? 'active' : ''}
                  onClick={() => {
                    setPaymentMethod('CARD');
                    if (tipMode === 'REMAINDER') setTipMode('NONE');
                  }}
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
                  {paymentMethod === 'CASH' && (
                    <button
                      type="button"
                      className={tipMode === 'REMAINDER' ? 'active' : ''}
                      disabled={!remainderSettlesBalance}
                      onClick={() => setTipMode('REMAINDER')}
                    >
                      Resto
                    </button>
                  )}
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
                  <span>{isRemainderTip ? 'Resto como propina' : 'Propina'}</span>
                  <strong>{formatMoney(tipPreview, order.currency)}</strong>
                </div>
              )}
              {isRemainderTip && !remainderSettlesBalance && (
                <div className="cash-shortfall" role="alert">
                  Resto solo puede usarse al liquidar el saldo completo.
                </div>
              )}
              {paymentMethod === 'CASH' ? (
                <>
                  <label>
                    Efectivo recibido
                    <input
                      inputMode="decimal"
                      value={cashTenderInput.value}
                      onChange={(event) =>
                        setCashTenderInput(setManualCashTender(event.target.value))
                      }
                    />
                  </label>
                  <div className="cash-quick-input" aria-label="Denominaciones rápidas">
                    <button
                      type="button"
                      className="cash-quick-action exact"
                      onClick={() => setCashTenderInput(setExactCashTender(exactCashRequiredMinor))}
                    >
                      Exacto
                    </button>
                    {cashDenominations.map((denomination) => (
                      <button
                        type="button"
                        key={denomination.minorUnits}
                        onClick={() =>
                          setCashTenderInput((current) =>
                            applyCashDenomination(current, denomination.minorUnits),
                          )
                        }
                      >
                        {formatMoney(denomination.minorUnits, order.currency)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="cash-quick-action undo"
                      disabled={cashTenderInput.quickHistory.length === 0}
                      onClick={() => setCashTenderInput((current) => undoCashDenomination(current))}
                    >
                      Deshacer
                    </button>
                  </div>
                  <div
                    className={`cash-tender-feedback${
                      cashTenderPreview.isSufficient ? '' : ' cash-tender-feedback-warning'
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {cashTenderPreview.isSufficient
                      ? '\u00a0'
                      : `Faltan ${formatMoney(
                          cashTenderPreview.shortfallMinorUnits,
                          order.currency,
                        )}`}
                  </div>
                  <div className="change-row">
                    <span>Cambio estimado</span>
                    <strong>
                      {formatMoney(cashTenderPreview.changeMinorUnits, order.currency)}
                    </strong>
                    <small>El servicio local confirma el cambio definitivo</small>
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
              <button
                className="confirm-payment"
                disabled={isBusy || !canConfirmTender}
                type="submit"
              >
                {pendingAction === 'payment'
                  ? 'Confirmando…'
                  : `Registrar ${paymentMethod === 'CASH' ? 'efectivo' : 'tarjeta'}`}
              </button>
            </form>
          </div>
        </PosDialog>
      )}
    </div>
  );
}
