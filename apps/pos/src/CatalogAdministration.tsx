import { useEffect, useRef, useState } from 'react';
import {
  CatalogInvalidationController,
  EdgeClientError,
  type EdgeClient,
} from '@comanview/client-sdk';
import type {
  CategoryResponse,
  ProductResponse,
  TaxAdministrationState,
  RestaurantAdministrationState,
  CatalogCommandInput,
} from '@comanview/contracts';
import { Button, InlineAlert, getUserGuidance } from '@comanview/ui';
import {
  CatalogAttempt,
  categoryName,
  createProductCommand,
  filterProducts,
  minorDecimal,
  productDraft,
  productSavePlan,
  rebaseProductDraft,
  type ProductDraft,
  type ProductSavePlan,
} from './catalogEditor.js';
import './catalogAdministration.css';
import { ProductModifiersEditor } from './ProductModifiersEditor.js';

type Props = {
  edge: EdgeClient;
  permissions: readonly string[];
  section: 'products' | 'categories';
  refreshToken?: unknown;
  visible?: boolean;
  onDirty(product: boolean, category: boolean): void;
  onBusy(value: boolean): void;
  confirm(message: string): Promise<boolean>;
  onProducts(): void;
  onTaxes(): void;
  onCurrency(): void;
};
type Editor = { base: ProductResponse | null; draft: ProductDraft };
type CategoryEditor = { base: CategoryResponse | null; name: string };
type Feedback = {
  error?: string;
  notice?: string;
  entity?: string | undefined;
  entityId?: string | undefined;
  categoryBlocked?: boolean;
};
type ActionContext = {
  section: Props['section'];
  entity?: string | undefined;
  entityId?: string | undefined;
  success?: string;
};
const retireMessage =
  'Este producto dejará de aparecer para nuevas ventas. Las ventas anteriores se conservarán y podrás reactivarlo después. ¿Retirar del catálogo?';
export function CatalogAdministration(props: Props) {
  const { edge, permissions, section } = props;
  const [products, setProducts] = useState<ProductResponse[]>([]),
    [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [tax, setTax] = useState<TaxAdministrationState | null>(null),
    [admin, setAdmin] = useState<RestaurantAdministrationState | null>(null);
  const [loaded, setLoaded] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    [dependencyError, setDependencyError] = useState(false);
  const [feedback, setFeedback] = useState<Partial<Record<Props['section'], Feedback>>>({});
  const [busy, setBusy] = useState(false);
  const [modifierDirty,setModifierDirty]=useState(false),[modifierBusy,setModifierBusy]=useState(false);
  const currentFeedback = feedback[section];
  const error = currentFeedback?.error;
  const notice = currentFeedback?.notice;
  function setError(value: string) {
    setFeedback((f) => ({ ...f, [section]: { error: value } }));
  }
  function setNotice(value: string) {
    setFeedback((f) => ({ ...f, [section]: { notice: value } }));
  }
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [showRetired, setShowRetired] = useState(false),
    [station, setStation] = useState(''),
    [available, setAvailable] = useState('');
  const [showInactive, setShowInactive] = useState(false),
    [ordering, setOrdering] = useState(false);
  const actionContext = useRef<ActionContext>({ section });
  const returnFocus = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null),
    [categoryEditor, setCategoryEditor] = useState<CategoryEditor | null>(null);
  const [conflict, setConflict] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [categoryConflict, setCategoryConflict] = useState(false);
  const [progress, setProgress] = useState<{ saved: string[]; pending: string[] } | null>(null);
  const [pendingAction, setPendingAction] = useState<CatalogAttempt | null>(null);
  const plan = useRef<ProductSavePlan | null>(null),
    createAttempt = useRef<CatalogAttempt | null>(null),
    categoryAttempt = useRef<CatalogAttempt | null>(null);
  const refresh = useRef<CatalogInvalidationController | null>(null),
    lock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const canView = permissions.includes('CATALOG_VIEW'),
    canManage = permissions.includes('CATALOG_MANAGE');
  const canTax = permissions.includes('TAX_PROFILE_MANAGE'),
    canStation = permissions.includes('STATION_MANAGE');
  const refs = { categories, tax, admin };
  const productFieldsDirty =
    !!editor &&
    (!editor.base ||
      JSON.stringify({ ...editor.draft, reason: '' }) !==
        JSON.stringify(productDraft(editor.base)));
  const productDirty=productFieldsDirty||modifierDirty;
  const categoryDirty =
    !!categoryEditor && (!categoryEditor.base || categoryEditor.name !== categoryEditor.base.name);
  const latest = products.find((p) => p.id === editor?.base?.id);
  const stale = !!editor?.base && (!latest || latest.version !== editor.base.version);
  const latestCategory = categories.find((c) => c.id === categoryEditor?.base?.id);
  const staleCategory =
    !!categoryEditor?.base &&
    (!latestCategory || latestCategory.version !== categoryEditor.base.version);
  useEffect(() => {
    props.onDirty(
      productDirty ||
        !!plan.current ||
        !!createAttempt.current ||
        (!!pendingAction && actionContext.current.section === 'products'),
      categoryDirty ||
        !!categoryAttempt.current ||
        (!!pendingAction && actionContext.current.section === 'categories'),
    );
  }, [productDirty, categoryDirty, pendingAction, progress, busy]);
  useEffect(() => {
    props.onBusy(busy||modifierBusy);
  }, [busy,modifierBusy]);
  useEffect(() => {
    if (editor) heading.current?.focus();
  }, [editor?.base?.id, !!editor]);
  async function dependencies() {
    if (!permissions.includes('ADMINISTRATION_VIEW')) return;
    const results = await Promise.allSettled([
      edge.getRestaurantAdministration(),
      edge.getTaxAdministration(),
    ]);
    setDependencyError(results.some((r) => r.status === 'rejected'));
    if (results[0].status === 'fulfilled') setAdmin(results[0].value);
    if (results[1].status === 'fulfilled') setTax(results[1].value);
  }
  useEffect(() => {
    if (!canView) return;
    const c = new CatalogInvalidationController(
      edge,
      (s) => {
        setProducts(s.products);
        setCategories(s.categories);
        setLoaded(true);
        setUnavailable(false);
      },
      () => {
        setUnavailable(true);
        setLoaded(true);
      },
    );
    refresh.current = c;
    void c.check();
    const focus = () => {
      void c.check();
      void dependencies();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    return () => {
      c.stop();
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
    };
  }, [edge, canView]);
  useEffect(() => {
    if (props.visible !== false) {
      refresh.current?.invalidate();
      void dependencies();
    }
  }, [props.refreshToken, props.visible, section]);
  async function reload() {
    await Promise.all([refresh.current?.check(true), dependencies()]);
  }
  const message = (e: unknown) =>
    e instanceof EdgeClientError
      ? getUserGuidance(e).explanation
      : e instanceof Error
        ? e.message
        : 'No se pudo consultar el catálogo.';
  const isConflict = (e: unknown) =>
    e instanceof EdgeClientError &&
    ['CATALOG_VERSION_CONFLICT', 'VERSION_CONFLICT'].includes(e.code);
  const rejected = (e: unknown) =>
    e instanceof EdgeClientError &&
    e.status !== null &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    !['REQUEST_TIMEOUT', 'AUTHORIZATION_TEMPORARILY_UNAVAILABLE'].includes(e.code);
  async function working(
    work: () => Promise<void>,
    context: ActionContext = {
      section,
      entity: section === 'products' ? editor?.draft.name : categoryEditor?.name,
      entityId: section === 'products' ? editor?.base?.id : categoryEditor?.base?.id,
    },
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFeedback((f) => ({ ...f, [context.section]: {} }));
    try {
      await work();
    } catch (e) {
      setFeedback((f) => ({
        ...f,
        [context.section]: {
          error:
            e instanceof EdgeClientError && e.code === 'CATEGORY_HAS_ACTIVE_PRODUCTS'
              ? 'No puedes desactivar esta categoría mientras tenga productos en catálogo. No disponible solo pausa su venta; retíralos o reasígnalos primero.'
              : message(e),
          entity: context.entity,
          entityId: context.entityId,
          categoryBlocked:
            e instanceof EdgeClientError && e.code === 'CATEGORY_HAS_ACTIVE_PRODUCTS',
        },
      }));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function openProduct(p: ProductResponse | null) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (plan.current || createAttempt.current) {
      setError('Resuelve primero el intento pendiente antes de abrir otro producto.');
      return;
    }
    if (
      productDirty &&
      !(await props.confirm('Hay cambios sin guardar. ¿Descartar este borrador?'))
    )
      return;
    const defaultTax = tax?.defaultTaxProfileId ?? '';
    setEditor({
      base: p,
      draft: p
        ? productDraft(p)
        : {
            name: '',
            description: '',
            sku: '',
            barcode: '',
            categoryId: categories.find((c) => c.systemKey === 'UNCATEGORIZED')?.id ?? '',
            price: '',
            taxId: defaultTax,
            stationId: '',
            active: true,
            available: true,
            displayOrder: '0',
            reason: '',
          },
    });
    setError('');
    setProgress(null);
    setConflict(false);
    setReviewed(false);
  }
  function change<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    if (editor) setEditor({ ...editor, draft: { ...editor.draft, [key]: value } });
  }
  async function saveProduct() {
    if(modifierDirty||modifierBusy){setError('Guarda o descarta primero los cambios de opciones y extras.');return;}
    if (!editor || !canManage) return;
    if (
      editor.base?.active &&
      !editor.draft.active &&
      !plan.current &&
      !(await props.confirm(retireMessage))
    )
      return;
    await working(async () => {
      try {
        if (!editor.base) {
          createAttempt.current ??= new CatalogAttempt(
            createProductCommand(editor.draft, refs, permissions),
          );
          await createAttempt.current.run(edge);
          createAttempt.current = null;
        } else {
          plan.current ??= productSavePlan(edge, editor.base, editor.draft, refs, permissions);
          await plan.current.run();
          plan.current = null;
        }
        closeProduct();
        setProgress(null);
        setNotice(
          editor.base && !editor.base.active && editor.draft.active && !editor.draft.available
            ? 'Producto reactivado. Continúa marcado como no disponible.'
            : 'Producto guardado.',
        );
        await reload();
      } catch (e) {
        if (plan.current)
          setProgress({ saved: [...plan.current.completed], pending: plan.current.pending });
        if (rejected(e)) {
          createAttempt.current = null;
          if (plan.current?.completed.length || isConflict(e)) {
            setConflict(true);
            setReviewed(false);
          }
          plan.current = null;
        }
        throw e;
      }
    });
  }
  function closeProduct() {
    setEditor(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }
  async function viewProducts(categoryId: string) {
    if (plan.current || createAttempt.current) {
      setError('Resuelve el guardado pendiente de Productos antes de cambiar la vista.');
      return;
    }
    if (
      productDirty &&
      !(await props.confirm(
        '¿Descartar el borrador de producto y ver los productos de esta categoría?',
      ))
    )
      return;
    setEditor(null);
    setCategory(categoryId);
    setQuery('');
    setStation('');
    setAvailable('');
    setShowRetired(false);
    props.onProducts();
  }
  async function action(command: CatalogCommandInput, context: ActionContext = { section }) {
    if (lock.current || pendingAction) return;
    const attempt = new CatalogAttempt(command);
    actionContext.current = context;
    setPendingAction(attempt);
    await runAction(attempt);
  }
  async function runAction(attempt: CatalogAttempt) {
    await working(async () => {
      try {
        await attempt.run(edge);
        setPendingAction(null);
        const context = actionContext.current;
        setFeedback((f) => ({
          ...f,
          [context.section]: {
            notice: context.success ?? 'Cambio guardado.',
            entity: context.entity,
          },
        }));
        await reload();
      } catch (e) {
        if (rejected(e)) {
          setPendingAction(null);
          await reload();
        }
        throw e;
      }
    }, actionContext.current);
  }
  async function saveCategory() {
    if (!categoryEditor?.name.trim()) return;
    await working(async () => {
      const b = categoryEditor.base;
      categoryAttempt.current ??= new CatalogAttempt(
        b
          ? {
              kind: 'UPDATE_CATEGORY',
              commandId: crypto.randomUUID(),
              entityId: b.id,
              expectedVersion: b.version!,
              payload: { name: categoryEditor.name.trim() },
            }
          : {
              kind: 'CREATE_CATEGORY',
              commandId: crypto.randomUUID(),
              expectedVersion: 0,
              payload: { name: categoryEditor.name.trim(), displayOrder: categories.length },
            },
      );
      try {
        await categoryAttempt.current.run(edge);
        categoryAttempt.current = null;
        setCategoryEditor(null);
        setNotice('Categoría guardada.');
        await reload();
      } catch (e) {
        if (rejected(e)) categoryAttempt.current = null;
        if (isConflict(e)) {
          setCategoryConflict(true);
          await reload();
        }
        throw e;
      }
    });
  }
  async function reorder(id: string, direction: number) {
    const ordered = [...categories].sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id),
    );
    const i = ordered.findIndex((c) => c.id === id),
      j = i + direction;
    if (!ordered[i] || !ordered[j]) return;
    [ordered[i], ordered[j]] = [ordered[j]!, ordered[i]!];
    await action({
      kind: 'REORDER_CATEGORIES',
      commandId: crypto.randomUUID(),
      payload: {
        categories: ordered.map((c, index) => ({
          id: c.id,
          expectedVersion: c.version!,
          displayOrder: index,
        })),
      },
    });
  }
  const blocked = busy || !!pendingAction || modifierBusy;
  if (!canView)
    return <InlineAlert tone="warning">No tienes permiso para consultar el catálogo.</InlineAlert>;
  if (!loaded) return <p role="status">Cargando catálogo…</p>;
  const rows = filterProducts(
    products,
    query,
    category,
    showRetired ? '' : 'true',
    available,
  ).filter((p) => !station || (station === 'none' ? !p.stationId : p.stationId === station));
  const orderedCategories = [...categories].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id),
  );
  const categoryCounts = new Map<string, { total: number; active: number }>();
  for (const p of products) {
    if (!p.categoryId) continue;
    const count = categoryCounts.get(p.categoryId) ?? { total: 0, active: 0 };
    count.total++;
    if (p.active) count.active++;
    categoryCounts.set(p.categoryId, count);
  }
  const createIssue = !admin?.operational.currency
    ? 'Configura primero la moneda del restaurante.'
    : !tax?.profiles.some((t) => t.id === tax.defaultTaxProfileId && t.active)
      ? 'Configura un impuesto predeterminado activo.'
      : !categories.some((c) => c.systemKey === 'UNCATEGORIZED' && c.version)
        ? 'La categoría del sistema no está disponible. Consulta el estado de instalación.'
        : unavailable
          ? 'El catálogo no está disponible; vuelve a consultar antes de crear.'
          : '';
  return (
    <section
      className="catalog-admin"
      aria-label="Catálogo comercial"
      aria-busy={busy}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !(e.target instanceof HTMLElement)) return;
        const disclosure = e.target.closest<HTMLDetailsElement>('details[open]');
        if (disclosure) {
          e.stopPropagation();
          disclosure.open = false;
          disclosure.querySelector('summary')?.focus();
        }
      }}
      onClick={(e) => {
        if (!(e.target instanceof HTMLElement) || !e.target.closest('button')) return;
        const menu = e.target.closest<HTMLDetailsElement>('.catalog-row-menu');
        if (menu) {
          menu.open = false;
          menu.querySelector('summary')?.focus();
        }
      }}
    >
      {unavailable && (
        <InlineAlert tone="warning">
          No se pudo actualizar el catálogo. Los datos pueden estar desactualizados.{' '}
          <Button onClick={() => void reload()}>Volver a consultar</Button>
        </InlineAlert>
      )}
      {dependencyError && (
        <InlineAlert tone="warning">
          No se pudieron consultar moneda, impuestos o estaciones. Puedes ver el catálogo.{' '}
          <Button onClick={() => void dependencies()}>Consultar configuración</Button>
        </InlineAlert>
      )}
      {error && (
        <div id="catalog-command-error">
          <InlineAlert tone="error" urgent>
            {currentFeedback?.entity && <strong>{currentFeedback.entity}: </strong>}
            {error}
            {currentFeedback?.categoryBlocked && currentFeedback.entityId && (
              <Button onClick={() => viewProducts(currentFeedback.entityId!)}>Ver productos</Button>
            )}
            <Button type="button" disabled={busy} onClick={() => void reload()}>
              Consultar catálogo y configuración
            </Button>
          </InlineAlert>
        </div>
      )}
      {notice && (
        <InlineAlert tone="success">
          {currentFeedback?.entity && `${currentFeedback.entity}: `}
          {notice}
        </InlineAlert>
      )}
      {pendingAction && actionContext.current.section === section && (
        <InlineAlert tone="warning">
          El cambio no está confirmado. Reintenta el mismo intento antes de realizar otra operación.{' '}
          <Button disabled={busy} onClick={() => void runAction(pendingAction)}>
            Reintentar cambio
          </Button>
        </InlineAlert>
      )}
      {pendingAction && actionContext.current.section !== section && (
        <InlineAlert tone="info">
          Hay un cambio sin confirmar en{' '}
          {actionContext.current.section === 'products' ? 'Productos' : 'Categorías'}. Regresa a ese
          apartado para reintentar antes de realizar otra operación.
        </InlineAlert>
      )}
      <div hidden={section !== 'products'}>
        <div hidden={!!editor}>
          <header className="catalog-toolbar">
            <h2>Productos</h2>
            <Button
              disabled={!canManage || blocked || !!createIssue}
              onClick={() => void openProduct(null)}
            >
              Nuevo producto
            </Button>
          </header>
          {createIssue && (
            <InlineAlert tone="info">
              {createIssue}{' '}
              <Button onClick={!admin?.operational.currency ? props.onCurrency : props.onTaxes}>
                Ir a configuración
              </Button>
            </InlineAlert>
          )}
          <div className="catalog-filters">
            <label>
              Buscar producto
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre, SKU o código de barras"
              />
            </label>
            <label>
              Categoría
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryName(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="catalog-filter-disclosure">
            <summary>Filtros{(station || available || showRetired) && ' · aplicados'}</summary>
            <div className="catalog-filters">
              <label>
                Estación
                <select value={station} onChange={(e) => setStation(e.target.value)}>
                  <option value="">Todas las estaciones</option>
                  <option value="none">Sin estación</option>
                  {admin?.stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Disponibilidad
                <select value={available} onChange={(e) => setAvailable(e.target.value)}>
                  <option value="">Toda disponibilidad</option>
                  <option value="true">Disponible</option>
                  <option value="false">No disponible</option>
                </select>
              </label>
              <label className="catalog-toggle">
                <input
                  type="checkbox"
                  checked={showRetired}
                  onChange={(e) => setShowRetired(e.target.checked)}
                />
                Mostrar retirados
              </label>
            </div>
          </details>
          <p className="catalog-summary">
            {rows.length} productos · {rows.filter((p) => !p.available).length} no disponibles
          </p>
          {!products.length ? (
            <p>
              {unavailable
                ? 'Todavía no hay una consulta de catálogo confirmada.'
                : 'No hay productos todavía.'}
            </p>
          ) : !rows.length ? (
            <p>No encontramos productos con estos filtros.</p>
          ) : (
            <ul className="catalog-list catalog-product-list">
              {rows.map((p) => (
                <li key={p.id}>
                  <div className="catalog-product-description">
                    <div className="catalog-product-title">
                      <strong>{p.name}</strong>
                      <span>
                        {minorDecimal(p.basePrice.amount)} {p.basePrice.currency}
                      </span>
                    </div>
                    <small>
                      {categories.find((c) => c.id === p.categoryId)
                        ? categoryName(categories.find((c) => c.id === p.categoryId)!)
                        : 'Categoría no disponible'}{' '}
                      ·{' '}
                      {p.stationId
                        ? (admin?.stations.find((s) => s.id === p.stationId)?.name ??
                          'Estación asignada')
                        : 'Sin estación'}
                    </small>
                  </div>
                  <div className="catalog-product-controls">
                    {!p.active && <span className="catalog-badge">Retirado</span>}
                    <div className="catalog-actions">
                      <Button
                        variant="secondary"
                        disabled={blocked}
                        onClick={() => void openProduct(p)}
                      >
                        {canManage ? 'Editar' : 'Ver producto'}
                      </Button>
                      <Button
                        variant="ghost"
                        title={
                          p.available ? 'Marcar no disponible temporalmente' : 'Volver a disponible'
                        }
                        disabled={
                          !canManage ||
                          blocked ||
                          !p.version ||
                          !!plan.current ||
                          !!createAttempt.current
                        }
                        aria-label={`${p.available ? 'Marcar no disponible' : 'Marcar disponible'}: ${p.name}`}
                        onClick={() =>
                          void action(
                            {
                              kind: 'SET_PRODUCT_AVAILABILITY',
                              commandId: crypto.randomUUID(),
                              entityId: p.id,
                              expectedVersion: p.version!,
                              payload: { available: !p.available },
                            },
                            { section: 'products', entity: p.name, entityId: p.id },
                          )
                        }
                      >
                        {p.available ? 'Disponible' : 'No disponible'}
                      </Button>
                      <details className="catalog-row-menu">
                        <summary aria-label={`Más acciones: ${p.name}`}>⋯</summary>
                        <Button
                          variant="secondary"
                          disabled={
                            !canManage ||
                            blocked ||
                            !p.version ||
                            !!plan.current ||
                            !!createAttempt.current
                          }
                          onClick={async () => {
                            if (p.active && !(await props.confirm(retireMessage))) return;
                            await action(
                              {
                                kind: 'SET_PRODUCT_ACTIVE',
                                commandId: crypto.randomUUID(),
                                entityId: p.id,
                                expectedVersion: p.version!,
                                payload: { active: !p.active },
                              },
                              {
                                section: 'products',
                                entity: p.name,
                                entityId: p.id,
                                success: p.active
                                  ? 'Producto retirado del catálogo.'
                                  : !p.available
                                    ? 'Producto reactivado. Continúa marcado como no disponible.'
                                    : 'Producto reactivado.',
                              },
                            );
                          }}
                        >
                          {p.active ? 'Retirar del catálogo' : 'Reactivar'}
                        </Button>
                      </details>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {editor && (
          <form
            className="catalog-editor"
            aria-describedby={error ? 'catalog-command-error' : undefined}
            onSubmit={(e) => {
              e.preventDefault();
              void saveProduct();
            }}
          >
            <header className="catalog-editor-header">
              <h3 ref={heading} tabIndex={-1}>
                {editor.base ? 'Editar producto' : 'Crear producto'}
              </h3>
              <strong>{editor.draft.name || 'Nuevo producto'}</strong>
              <span role="status">
                {busy
                  ? 'Guardando…'
                  : plan.current || createAttempt.current
                    ? 'Confirmación pendiente'
                    : productDirty
                      ? 'Cambios sin guardar'
                      : 'Sin cambios pendientes'}
              </span>
              <div className="catalog-actions">
                <Button
                  disabled={
                    !canManage ||
                    blocked ||
                    conflict ||
                    (stale && !plan.current) ||
                    (!editor.base && !!createIssue)
                  }
                >
                  {plan.current || createAttempt.current
                    ? 'Reintentar guardado pendiente'
                    : 'Guardar producto'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || !!plan.current || !!createAttempt.current}
                  onClick={async () => {
                    if (
                      !productDirty ||
                      (await props.confirm('¿Descartar los cambios sin guardar de este producto?'))
                    )
                      closeProduct();
                  }}
                >
                  Volver a productos
                </Button>
              </div>
            </header>
            {(conflict || stale) && (
              <InlineAlert tone="warning">
                Este producto cambió desde que empezaste a editarlo. Tu borrador se conserva.
                <Button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await reload();
                    setReviewed(true);
                  }}
                >
                  Revisar estado actual
                </Button>
                {reviewed && latest && (
                  <>
                    <p>
                      Actual: {latest.name} · {minorDecimal(latest.basePrice.amount)}{' '}
                      {latest.basePrice.currency} ·{' '}
                      {latest.available ? 'Disponible' : 'No disponible'} ·{' '}
                      {latest.active ? 'En catálogo' : 'Retirado'}
                    </p>
                    <details>
                      <summary>Comparar todos los campos actuales</summary>
                      <dl>
                        {Object.entries(productDraft(latest))
                          .filter(
                            ([k]) =>
                              k !== 'reason' && !['categoryId', 'taxId', 'stationId'].includes(k),
                          )
                          .map(([k, v]) => (
                            <div key={k}>
                              <dt>
                                {
                                  (
                                    {
                                      name: 'Nombre',
                                      description: 'Descripción',
                                      sku: 'SKU',
                                      barcode: 'Código de barras',
                                      price: 'Precio',
                                      active: 'En catálogo',
                                      available: 'Disponible',
                                      displayOrder: 'Orden',
                                    } as Record<string, string>
                                  )[k]
                                }
                              </dt>
                              <dd>{String(v)}</dd>
                            </div>
                          ))}
                        <dt>Categoría</dt>
                        <dd>{categories.find((c) => c.id === latest.categoryId)?.name}</dd>
                        <dt>Impuesto</dt>
                        <dd>{latest.taxProfile.name}</dd>
                        <dt>Estación</dt>
                        <dd>
                          {admin?.stations.find((s) => s.id === latest.stationId)?.name ??
                            'Sin estación'}
                        </dd>
                      </dl>
                    </details>
                    <Button
                      type="button"
                      disabled={busy || !!plan.current || !!createAttempt.current}
                      onClick={async () => {
                        if (
                          await props.confirm(
                            'Se conservará tu intención y se preparará un nuevo intento sobre los datos consultados. ¿Continuar?',
                          )
                        ) {
                          plan.current = null;
                          createAttempt.current = null;
                          setEditor({
                            base: latest,
                            draft: editor.base
                              ? rebaseProductDraft(editor.base, editor.draft, latest)
                              : editor.draft,
                          });
                          setConflict(false);
                          setReviewed(false);
                          setProgress(null);
                        }
                      }}
                    >
                      Aplicar mi borrador sobre esta base
                    </Button>
                  </>
                )}
              </InlineAlert>
            )}
            {progress && (
              <InlineAlert tone="warning">
                <p>Guardado: {progress.saved.join(', ') || 'Ningún cambio confirmado'}.</p>
                <p>
                  Pendiente: {progress.pending.join(', ')}. No se deshicieron los cambios
                  confirmados.
                </p>
              </InlineAlert>
            )}
            <fieldset disabled={!canManage || blocked || modifierDirty || !!plan.current || !!createAttempt.current}>
              <legend>Información</legend>
              <label>
                Nombre
                <input
                  required
                  maxLength={200}
                  value={editor.draft.name}
                  onChange={(e) => change('name', e.target.value)}
                />
              </label>
              <label>
                Descripción
                <textarea
                  maxLength={4000}
                  value={editor.draft.description}
                  onChange={(e) => change('description', e.target.value)}
                />
              </label>
              <label>
                Categoría del producto
                <select
                  value={editor.draft.categoryId}
                  onChange={(e) => change('categoryId', e.target.value)}
                >
                  {categories
                    .filter((c) => c.active || c.id === editor.draft.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryName(c)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                SKU
                <input
                  maxLength={200}
                  value={editor.draft.sku}
                  onChange={(e) => change('sku', e.target.value)}
                />
              </label>
              <label>
                Código de barras
                <input
                  maxLength={200}
                  value={editor.draft.barcode}
                  onChange={(e) => change('barcode', e.target.value)}
                />
              </label>
              <label>
                Orden de presentación
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editor.draft.displayOrder}
                  onChange={(e) => change('displayOrder', e.target.value)}
                />
              </label>
            </fieldset>
            <fieldset disabled={!canManage || blocked || modifierDirty || !!plan.current || !!createAttempt.current}>
              <legend>Precio e impuestos</legend>
              <label>
                Precio ({editor.base?.basePrice.currency ?? admin?.operational.currency})
                <input
                  required
                  inputMode="decimal"
                  value={editor.draft.price}
                  onChange={(e) => change('price', e.target.value)}
                />
              </label>
              {editor.base && editor.draft.price !== productDraft(editor.base).price && (
                <label>
                  Motivo del cambio de precio
                  <input
                    required
                    maxLength={500}
                    value={editor.draft.reason}
                    onChange={(e) => change('reason', e.target.value)}
                  />
                </label>
              )}
              <label>
                Impuesto del producto
                <select
                  disabled={!canTax || !tax}
                  value={editor.draft.taxId}
                  onChange={(e) => change('taxId', e.target.value)}
                >
                  {!tax && editor.base && (
                    <option value={editor.base.taxProfile.id}>{editor.base.taxProfile.name}</option>
                  )}
                  {tax?.profiles
                    .filter((t) => t.active || t.id === editor.draft.taxId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.rateBasisPoints / 100}% ·{' '}
                        {t.calculationMode === 'TAX_ADDED' ? 'Se agrega' : 'Incluido'}
                      </option>
                    ))}
                </select>
              </label>
              {!canTax && (
                <small>
                  Tu rol puede consultar el impuesto. Los productos nuevos usan el predeterminado
                  del restaurante.
                </small>
              )}
            </fieldset>
            <fieldset disabled={!canManage || blocked || modifierDirty || !!plan.current || !!createAttempt.current}>
              <legend>Preparación</legend>
              <label>
                Estación de preparación
                <select
                  disabled={!canStation || !admin}
                  value={editor.draft.stationId}
                  onChange={(e) => change('stationId', e.target.value)}
                >
                  <option value="">Sin estación</option>
                  {!admin && editor.draft.stationId && (
                    <option value={editor.draft.stationId}>
                      Estación asignada (solo consulta)
                    </option>
                  )}
                  {admin?.stations
                    .filter((s) => s.active || s.id === editor.draft.stationId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              {!canStation && (
                <small>Solo un rol con permiso de estaciones puede cambiar esta asignación.</small>
              )}
            </fieldset>
            {editor.base?<ProductModifiersEditor key={editor.base.id} edge={edge} productId={editor.base.id} productVersion={editor.base.version??0} refreshToken={props.refreshToken} canManage={canManage} disabled={productFieldsDirty||busy||!!pendingAction||!!plan.current} confirm={props.confirm} onDirty={setModifierDirty} onBusy={setModifierBusy} onSaved={async()=>{await reload();const fresh=refresh.current?.getSnapshot()?.products.find(p=>p.id===editor.base!.id);if(fresh)setEditor({base:fresh,draft:productDraft(fresh)});}}/>:<p>Guarda el producto para configurar sus opciones y extras.</p>}
            <fieldset disabled={!canManage || blocked || modifierDirty || !!plan.current || !!createAttempt.current}>
              <legend>Estado</legend>
              <label className="catalog-toggle">
                <input
                  type="checkbox"
                  checked={editor.draft.active}
                  onChange={(e) => change('active', e.target.checked)}
                />
                En catálogo
              </label>
              <span>
                {editor.draft.active ? 'En catálogo' : 'Retirado'} · El cambio se aplica al guardar.
              </span>
              <label className="catalog-toggle">
                <input
                  type="checkbox"
                  checked={editor.draft.available}
                  onChange={(e) => change('available', e.target.checked)}
                />
                Disponible
              </label>
              <small>
                No disponible pausa temporalmente la venta. Para dejar de ofrecer el producto,
                retíralo del catálogo. Retirarlo conserva las ventas anteriores y permite
                reactivarlo después.
              </small>
            </fieldset>
          </form>
        )}
      </div>
      <div hidden={section !== 'categories'}>
        <header className="catalog-toolbar">
          <h2>Categorías</h2>
          <Button
            disabled={!canManage || blocked || !!categoryAttempt.current}
            onClick={async () => {
              if (!categoryDirty || (await props.confirm('¿Descartar el borrador de categoría?'))) {
                setCategoryEditor({ base: null, name: '' });
                setCategoryConflict(false);
                setError('');
              }
            }}
          >
            Nueva categoría
          </Button>
        </header>
        <div className="catalog-toolbar">
          <label className="catalog-toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Mostrar inactivas
          </label>
          <Button
            variant="secondary"
            aria-pressed={ordering}
            disabled={!canManage || blocked}
            onClick={() => setOrdering(!ordering)}
          >
            {ordering ? 'Terminar de ordenar' : 'Ordenar categorías'}
          </Button>
        </div>
        {ordering && (
          <p>
            Subir y bajar guardan cada movimiento. Se respeta el orden global, incluidas las
            categorías ocultas.
          </p>
        )}
        <ul className="catalog-list">
          {orderedCategories.map((c, index) => (
            <li key={c.id} hidden={!c.active && !showInactive && !c.systemKey}>
              <div>
                <strong>{categoryName(c)}</strong>
                <p>
                  {c.active ? 'Activa' : 'Inactiva'} · {categoryCounts.get(c.id)?.total ?? 0}{' '}
                  productos · {categoryCounts.get(c.id)?.active ?? 0} en catálogo
                </p>
                {c.systemKey && (
                  <details className="catalog-info">
                    <summary>Del sistema</summary>
                    <p>Categoría protegida utilizada para productos sin clasificación.</p>
                  </details>
                )}
                {c.name === 'Category' && !c.systemKey && (
                  <details className="catalog-info">
                    <summary>Revisar nombre</summary>
                    <p>
                      El nombre es genérico. Puede provenir de una configuración anterior; revísalo
                      si quieres renombrarla o reasignar productos.
                    </p>
                  </details>
                )}
              </div>
              <div className="catalog-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    viewProducts(c.id);
                  }}
                >
                  Ver productos de {categoryName(c)}
                </Button>
                {!c.systemKey && (
                  <Button
                    variant="secondary"
                    disabled={!canManage || blocked || !!c.systemKey || !!categoryAttempt.current}
                    onClick={async () => {
                      if (
                        !categoryDirty ||
                        (await props.confirm('¿Descartar el borrador anterior?'))
                      ) {
                        setCategoryEditor({ base: c, name: c.name });
                        setCategoryConflict(false);
                        setError('');
                      }
                    }}
                  >
                    Editar {categoryName(c)}
                  </Button>
                )}
                {!c.systemKey && (
                  <details className="catalog-row-menu">
                    <summary aria-label={`Más acciones: ${categoryName(c)}`}>⋯</summary>
                    <Button
                      variant="secondary"
                      disabled={!canManage || blocked || !!c.systemKey || !c.version}
                      onClick={async () => {
                        if (
                          c.active &&
                          !(await props.confirm(
                            '¿Desactivar esta categoría? No puede contener productos activos.',
                          ))
                        )
                          return;
                        await action(
                          {
                            kind: 'SET_CATEGORY_ACTIVE',
                            commandId: crypto.randomUUID(),
                            entityId: c.id,
                            expectedVersion: c.version!,
                            payload: { active: !c.active },
                          },
                          { section: 'categories', entity: categoryName(c), entityId: c.id },
                        );
                      }}
                    >
                      {c.active ? 'Desactivar' : 'Reactivar'} {categoryName(c)}
                    </Button>
                  </details>
                )}
                {ordering && (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={`Subir ${categoryName(c)}`}
                      disabled={!canManage || blocked || index === 0}
                      onClick={() => void reorder(c.id, -1)}
                    >
                      Subir
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Bajar ${categoryName(c)}`}
                      disabled={!canManage || blocked || index === categories.length - 1}
                      onClick={() => void reorder(c.id, 1)}
                    >
                      Bajar
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {categoryEditor && (
          <form
            className="catalog-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void saveCategory();
            }}
          >
            <h3>{categoryEditor.base ? 'Renombrar categoría' : 'Crear categoría'}</h3>
            {(categoryConflict || staleCategory) && (
              <InlineAlert tone="warning">
                Esta categoría cambió. Tu nombre propuesto se conserva. Actual:{' '}
                {latestCategory?.name ?? 'No disponible'}.{' '}
                <Button
                  type="button"
                  disabled={busy || !latestCategory || !!categoryAttempt.current}
                  onClick={async () => {
                    await reload();
                    if (
                      latestCategory &&
                      (await props.confirm(
                        '¿Conservar el nombre propuesto sobre la categoría consultada?',
                      ))
                    ) {
                      categoryAttempt.current = null;
                      setCategoryEditor({ ...categoryEditor, base: latestCategory });
                      setCategoryConflict(false);
                    }
                  }}
                >
                  Revisar y usar base actual
                </Button>
              </InlineAlert>
            )}
            <label>
              Nombre de la categoría
              <input
                required
                maxLength={200}
                disabled={blocked || !!categoryAttempt.current}
                value={categoryEditor.name}
                onChange={(e) => setCategoryEditor({ ...categoryEditor, name: e.target.value })}
              />
            </label>
            <Button
              disabled={
                !canManage ||
                blocked ||
                categoryConflict ||
                (staleCategory && !categoryAttempt.current) ||
                !categoryEditor.name.trim()
              }
            >
              {categoryAttempt.current ? 'Reintentar categoría' : 'Guardar categoría'}
            </Button>
            <Button
              type="button"
              disabled={busy || !!categoryAttempt.current}
              onClick={async () => {
                if (!categoryDirty || (await props.confirm('¿Descartar este borrador?')))
                  setCategoryEditor(null);
              }}
            >
              Cerrar categoría
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
