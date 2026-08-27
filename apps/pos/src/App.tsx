import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createEdgeClient, EdgeClientError } from '@comanview/client-sdk';
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
  PermissionCode,
} from '@comanview/contracts';
import { PermissionCodes } from '@comanview/contracts';
import {
  ALL_CATEGORIES,
  canEditDraftItem,
  formatMoney,
  getActiveModifierGroups,
  getConfiguredProductTotal,
  getCashDifferencePresentation,
  getEffectiveModifierPrice,
  getErrorMessage,
  getLocalBusinessDate,
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

const sessionTokenStorageKey = 'comanview.pos.sessionToken';
const posDeviceId =
  import.meta.env['VITE_COMANVIEW_DEVICE_ID'] ??
  (import.meta.env.DEV ? '01991a00-0000-7000-8000-000000000721' : '');
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
  const [openCashError, setOpenCashError] = useState<string | null>(null);
  const [showCashOperations, setShowCashOperations] = useState(false);
  const [cashModalError, setCashModalError] = useState<string | null>(null);
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

  const hasPermission = useCallback(
    (permission: PermissionCode) => authUser?.permissions.includes(permission) ?? false,
    [authUser],
  );

  const clearLocalSession = useCallback(() => {
    window.localStorage.removeItem(sessionTokenStorageKey);
    setAuthUser(null);
    setOrder(null);
    setCashSession(null);
    setPaymentConfig(null);
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
    const restoreSession = async () => {
      if (!window.localStorage.getItem(sessionTokenStorageKey)) {
        setAuthChecking(false);
        return;
      }
      try {
        const current = await edge.getCurrentSession();
        setAuthUser(current.user);
      } catch {
        clearLocalSession();
      } finally {
        setAuthChecking(false);
      }
    };
    void restoreSession();
  }, [clearLocalSession]);

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
    if (!authUser) return;
    try {
      const [nextCategories, nextProducts, currentCash, config] = await Promise.all([
        authUser.permissions.includes(PermissionCodes.CATALOG_VIEW)
          ? edge.getCategories()
          : Promise.resolve([]),
        authUser.permissions.includes(PermissionCodes.CATALOG_VIEW)
          ? edge.getProducts()
          : Promise.resolve([]),
        authUser.permissions.includes(PermissionCodes.CASH_SESSION_VIEW)
          ? edge.getCurrentCashSession()
          : Promise.resolve({ session: null }),
        authUser.permissions.includes(PermissionCodes.PAYMENT_CONFIG_VIEW)
          ? edge.getPaymentConfig()
          : Promise.resolve(null),
      ]);
      setCategories(nextCategories);
      setProducts(nextProducts);
      setCashSession(currentCash.session);
      setPaymentConfig(config);
      setConnection('CONNECTED');
    } catch (stateError) {
      if (stateError instanceof EdgeClientError && stateError.code === 'EDGE_UNREACHABLE')
        setConnection('DISCONNECTED');
      if (stateError instanceof EdgeClientError && stateError.status === 401) clearLocalSession();
      setError(getErrorMessage(stateError));
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
        setError(getErrorMessage(restoreError));
    }
  }, [authUser]);

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
    if (
      connection !== 'CONNECTED' ||
      !authUser?.permissions.includes(PermissionCodes.PRINT_JOBS_VIEW)
    )
      return;
    const refresh = async () => {
      try {
        setPrintJobs(await edge.getRecentPrintJobs());
      } catch {
        // Printing is non-blocking; connectivity polling remains authoritative.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [authUser, connection]);

  const visibleCategories = useMemo(() => getVisibleCategories(categories), [categories]);
  const visibleProducts = useMemo(
    () => getVisibleProducts(products, selectedCategoryId),
    [products, selectedCategoryId],
  );
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
  const canOperateOrder = order?.status === 'OPEN' && connection === 'CONNECTED' && !isBusy;

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function setContextualCashError(problem: unknown, setLocalError: (message: string) => void) {
    if (problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE') {
      setConnection('DISCONNECTED');
      setError(getErrorMessage(problem));
      return;
    }
    if (problem instanceof EdgeClientError && problem.status === 401) {
      clearLocalSession();
      setError(getErrorMessage(problem));
      return;
    }
    setLocalError(getErrorMessage(problem));
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
      updateOrder(next);
      setNotice(message);
      return next;
    } catch (problem) {
      if (problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE')
        setConnection('DISCONNECTED');
      if (problem instanceof EdgeClientError && problem.status === 401) clearLocalSession();
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
          const nextProducts = await edge.getProducts();
          setProducts(nextProducts);
          if (configuredProduct) {
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
      if (!handleError?.(problem)) setError(getErrorMessage(problem));
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
      `Ronda ${order.rounds.length + 1} enviada; comandas encoladas en Edge.`,
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
      setPrintJobs(await edge.getRecentPrintJobs());
      setNotice(`${kind === 'PRECHECK' ? 'Precuenta' : 'Recibo'} encolado (${job.status}).`);
    } catch (problem) {
      setError(getErrorMessage(problem));
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
      });
      setCashSession(session);
      setShowOpenCash(false);
      setOpenCashError(null);
      setNotice('Caja abierta y persistida en Edge.');
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
      setCashSession(null);
      setClosingPreview(null);
      setCashReport(result.report);
      setCountedCash('');
      setNotice('Corte Z confirmado. La CashSession quedó CLOSED.');
    } catch (problem) {
      setContextualCashError(problem, setCashModalError);
    } finally {
      setPendingAction(null);
    }
  }

  function beginPayment() {
    if (!order) return;
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
          ...(hasPermission(PermissionCodes.PAYMENT_VOID)
            ? {}
            : { overridePin: authorizationPin }),
        }),
      'Pago anulado con autorización y Audit Log durable.',
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
      if (!posDeviceId) {
        setLoginError('Este POS no tiene un dispositivo configurado.');
        return;
      }
      const authenticated = await edge.login({ pin, deviceId: posDeviceId });
      window.localStorage.setItem(sessionTokenStorageKey, authenticated.token);
      setAuthUser(authenticated.user);
      setPin('');
      setLoadingCatalog(true);
    } catch (problem) {
      setPin('');
      setLoginError(
        problem instanceof EdgeClientError && problem.code === 'EDGE_UNREACHABLE'
          ? 'No fue posible conectar con el Edge local.'
          : 'PIN incorrecto o acceso temporalmente bloqueado.',
      );
    } finally {
      setLoginPending(false);
      setAuthChecking(false);
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
          <small>La identidad se valida directamente en el Edge local.</small>
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
            <span>Point of Sale</span>
          </div>
        </div>
        <div className="topbar-statuses">
          <div className="operator-identity">
            <div>
              <strong>{authUser.displayName}</strong>
              <span>{authUser.roles.join(' · ')}</span>
            </div>
            <button type="button" onClick={() => void logout()}>
              Cerrar sesión
            </button>
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
                  : 'Puedes tomar y enviar pedidos · abre caja antes de cobrar'}
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
              disabled={
                isBusy || connection !== 'CONNECTED' || !hasPermission(PermissionCodes.ORDER_CREATE)
              }
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
                disabled={
                  isBusy ||
                  connection !== 'CONNECTED' ||
                  !hasPermission(PermissionCodes.ORDER_CREATE)
                }
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
                          <span>DRAFT · aún no enviado</span>
                        </div>
                        <div className="order-item-actions">
                          <strong>
                            {formatMoney(
                              getSnapshotTotal(item.productSnapshot),
                              item.productSnapshot.basePrice.currency,
                            )}
                          </strong>
                          <button
                            type="button"
                            className="edit-button"
                            disabled={
                              !canOperateOrder || !hasPermission(PermissionCodes.ORDER_EDIT_DRAFT)
                            }
                            onClick={() => beginEditDraftItem(item)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={
                              !canOperateOrder || !hasPermission(PermissionCodes.ORDER_EDIT_DRAFT)
                            }
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
                          <span>SENT · historial protegido</span>
                        </div>
                        <strong>
                          {formatMoney(
                            getSnapshotTotal(item.productSnapshot),
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
                      disabled={
                        draftItems.length === 0 ||
                        !canOperateOrder ||
                        !hasPermission(PermissionCodes.ORDER_SEND)
                      }
                      onClick={() => void sendRound()}
                    >
                      <span>{pendingAction === 'send-round' ? 'Enviando…' : 'Enviar ronda'}</span>
                      <small>{draftItems.length} DRAFT</small>
                    </button>
                    <button
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
                    </button>
                    <button
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
                      Cobrar
                    </button>
                    {order.balanceDue.amount === 0 && order.items.length > 0 && (
                      <>
                        <button
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
                  <>
                    <div className="closed-callout">✓ Venta cerrada y balanceada</div>
                    <button
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
                    </button>
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
              </footer>
            </>
          )}
        </aside>
      </main>

      {printJobs.some((job) => job.status === 'FAILED' || job.status === 'UNKNOWN') && (
        <div className="print-alert" role="status">
          Hay impresiones pendientes de atención. La venta continúa operativa.
        </div>
      )}
      {import.meta.env.DEV && printJobs.length > 0 && (
        <details className="print-debug">
          <summary>Cola de impresión · {printJobs.length} recientes</summary>
          {printJobs.slice(0, 8).map((job) => (
            <div key={job.printJobId}>
              <span>
                {job.jobType}
                {job.stationId ? ` · ${job.stationId.slice(-4)}` : ''}
              </span>
              <strong>
                {job.status} · intento {job.attempts}
              </strong>
            </div>
          ))}
        </details>
      )}

      {configuredProduct && (
        <div className="modal-backdrop">
          <section
            className="payment-modal modifier-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modifier-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">
                  {editingConfiguredItemId ? 'Edita el borrador' : 'Configura el producto'}
                </span>
                <h2 id="modifier-title">{configuredProduct.name}</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar configuración"
                onClick={() => {
                  setConfiguredProduct(null);
                  setEditingConfiguredItemId(null);
                  setSelectedModifierIds([]);
                  setModifierValidation(null);
                  setConfiguredSpecialInstructions('');
                }}
              >
                ×
              </button>
            </div>
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
                  ? 'Confirmando con Edge…'
                  : editingConfiguredItemId
                    ? 'Guardar cambios'
                    : 'Agregar a la venta'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showOpenCash && hasPermission(PermissionCodes.CASH_SESSION_OPEN) && (
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
              <button
                type="button"
                onClick={() => {
                  setOpenCashError(null);
                  setShowOpenCash(false);
                }}
              >
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
                  onChange={(event) => {
                    setOpeningFloat(event.target.value);
                    setOpenCashError(null);
                  }}
                  autoFocus
                />
              </label>
              <p className="field-help">
                Se guarda en minor units exactos. El efectivo esperado parte de este fondo.
              </p>
              <div
                className={`modal-form-feedback${openCashError ? ' modal-form-feedback--error' : ''}`}
                role="status"
              >
                {openCashError ?? ''}
              </div>
              <button className="confirm-payment" disabled={isBusy} type="submit">
                {pendingAction === 'open-cash' ? 'Abriendo…' : 'Abrir CashSession'}
              </button>
            </form>
          </section>
        </div>
      )}

      {showCashOperations && (
        <div className="modal-backdrop">
          <section
            className="payment-modal cash-operations-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-operations-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Operación local</span>
                <h2 id="cash-operations-title">Caja y cortes</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCashModalError(null);
                  setShowCashOperations(false);
                }}
              >
                ×
              </button>
            </div>

            {cashSession ? (
              <>
                <div className="cash-session-brief">
                  <span>Business date</span>
                  <strong>{cashSession.businessDate}</strong>
                  <small>
                    CashSession OPEN · Arqueo {cashSession.blindCashCount ? 'ciego' : 'visible'}.
                  </small>
                </div>

                <div
                  className={`modal-form-feedback cash-modal-feedback${cashModalError ? ' modal-form-feedback--error' : ''}`}
                  role="status"
                >
                  {cashModalError ?? ''}
                </div>

                {hasPermission(PermissionCodes.CASH_MOVEMENT_CREATE) && (
                  <form className="cash-operation-section" onSubmit={(event) => void createCashMovement(event)}>
                    <div className="cash-operation-heading">
                      <h3>Movimiento de efectivo</h3>
                      <div className="method-selector cash-movement-selector">
                        <button
                          type="button"
                          className={cashMovementType === 'CASH_IN' ? 'selected' : ''}
                          onClick={() => setCashMovementType('CASH_IN')}
                        >
                          Entrada
                        </button>
                        <button
                          type="button"
                          className={cashMovementType === 'CASH_OUT' ? 'selected' : ''}
                          onClick={() => setCashMovementType('CASH_OUT')}
                        >
                          Salida
                        </button>
                      </div>
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
                  <form className="cash-operation-section blind-count" onSubmit={(event) => void previewCashClose(event)}>
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
                <strong>CashSession CLOSED</strong>
                <span>El Corte Z quedó persistido. Puedes abrir una nueva caja con otro fondo.</span>
              </div>
            )}

            {visibleCashSummary && (
              <section className="cash-report-summary" aria-live="polite">
                <div className="cash-operation-heading">
                  <div>
                    <span className="eyebrow">
                      {cashReport?.reportType === 'Z' ? 'Corte Z' : cashReport ? 'Corte X' : 'Resultado del arqueo'}
                    </span>
                    <h3>Resumen financiero</h3>
                  </div>
                  {'printJobId' in visibleCashSummary && visibleCashSummary.printJobId && (
                    <small>Impresión encolada</small>
                  )}
                </div>
                <div className="cash-report-grid">
                  <span>Fondo inicial<strong>{formatMoney(visibleCashSummary.openingFloat.amount, visibleCashSummary.currency)}</strong></span>
                  <span>Ventas CASH<strong>{formatMoney(visibleCashSummary.salesByMethod.CASH.amount, visibleCashSummary.currency)}</strong></span>
                  <span>Ventas CARD<strong>{formatMoney(visibleCashSummary.salesByMethod.CARD.amount, visibleCashSummary.currency)}</strong></span>
                  <span>CASH_IN<strong>{formatMoney(visibleCashSummary.cashIn.amount, visibleCashSummary.currency)}</strong></span>
                  <span>CASH_OUT<strong>{formatMoney(visibleCashSummary.cashOut.amount, visibleCashSummary.currency)}</strong></span>
                  <span>Esperado<strong>{formatMoney(visibleCashSummary.expectedCash.amount, visibleCashSummary.currency)}</strong></span>
                  {visibleCashSummary.countedCash && (
                    <span>Contado<strong>{formatMoney(visibleCashSummary.countedCash.amount, visibleCashSummary.currency)}</strong></span>
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
                    {pendingAction === 'close-cash' ? 'Cerrando…' : 'Confirmar Corte Z y cerrar caja'}
                  </button>
                )}
              </section>
            )}
          </section>
        </div>
      )}

      {voidPaymentId && order && (
        <div className="modal-backdrop">
          <section
            className="payment-modal override-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">Operación sensible</span>
                <h2 id="override-title">Anular Payment</h2>
              </div>
              <button type="button" aria-label="Cancelar anulación" onClick={cancelPaymentVoid}>
                ×
              </button>
            </div>
            <p className="override-summary">
              Esta acción conserva el Payment histórico como VOIDED y registra quién operó y quién
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
                  PIN de Manager u Owner
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
                <button type="button" className="secondary-order-button" onClick={cancelPaymentVoid}>
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
                  {pendingAction === `void-${voidPaymentId}` ? 'Autorizando…' : 'Autorizar y anular'}
                </button>
              </div>
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
                      Undo
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
              <button
                className="confirm-payment"
                disabled={isBusy || !canConfirmTender}
                type="submit"
              >
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
