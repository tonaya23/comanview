import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CloudAdminClientError,
  createCloudAdminClient,
  type CloudAdminPage,
} from '@comanview/client-sdk';
import type {
  CloudAdminSessionResponse,
  CloudCashMovement,
  CloudCashSessionSummary,
  CloudLocationOverview,
  CloudLocationSummary,
  CloudOrderDetail,
  CloudOrderSummary,
  CloudSaleSummary,
  CloudTenant,
  CanonicalCloudLocation,
  EdgeReplacement,
  ProvisionedEdge,
} from '@comanview/contracts';

type View = 'control-plane' | 'locations' | 'overview' | 'orders' | 'sales' | 'cash';
const client = createCloudAdminClient();

export function App() {
  const [session, setSession] = useState<CloudAdminSessionResponse | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<CloudLocationSummary | null>(null);
  const [view, setView] = useState<View>('locations');

  useEffect(() => {
    client.getSession().then(setSession).catch(() => setSession(null)).finally(() => setRestoring(false));
  }, []);

  const canViewFinancial = session?.user.permissions.includes('CLOUD_FINANCIAL_VIEW') ?? false;
  const canManageControlPlane = session?.user.permissions.includes('CLOUD_TENANT_CREATE') ?? false;
  if (restoring) return <CenteredState text="Restaurando sesión Cloud…" />;
  if (!session) return <Login onAuthenticated={setSession} />;

  const selectLocation = (selected: CloudLocationSummary) => {
    setLocation(selected);
    setView('overview');
    setError(null);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setView('locations'); setLocation(null); }}>
          <span>ComanView</span><small>Super Admin</small>
        </button>
        <div className="identity">
          <div><strong>{session.user.displayName}</strong><span>{session.user.role}</span></div>
          <button onClick={() => client.logout().finally(() => setSession(null))}>Cerrar sesión</button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          {canManageControlPlane && <button className={view === 'control-plane' ? 'active' : ''} onClick={() => setView('control-plane')}>Control Plane</button>}
          <button className={view === 'locations' ? 'active' : ''} onClick={() => setView('locations')}>Locations</button>
          {location && <>
            <div className="scope-label"><span>Location activa</span><code>{shortId(location.locationId)}</code></div>
            <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>Overview</button>
            <button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')}>Orders</button>
            {canViewFinancial && <button className={view === 'sales' ? 'active' : ''} onClick={() => setView('sales')}>Sales</button>}
            {canViewFinancial && <button className={view === 'cash' ? 'active' : ''} onClick={() => setView('cash')}>CashSessions</button>}
          </>}
        </aside>
        <main className="content">
          {error && <div className="global-error">{error}</div>}
          {view === 'control-plane' && canManageControlPlane && <ControlPlane onError={setError} />}
          {view === 'locations' && <Locations onSelect={selectLocation} onError={setError} />}
          {location && view === 'overview' && <Overview location={location} canViewFinancial={canViewFinancial} canManageControlPlane={canManageControlPlane} onOpenControlPlane={() => setView('control-plane')} onOpenOrder={() => setView('orders')} onError={setError} />}
          {location && view === 'orders' && <Orders location={location} canViewFinancial={canViewFinancial} onError={setError} />}
          {location && view === 'sales' && canViewFinancial && <Sales location={location} onError={setError} />}
          {location && view === 'cash' && canViewFinancial && <CashSessions location={location} onError={setError} />}
        </main>
      </div>
    </div>
  );
}

function Login({ onAuthenticated }: { onAuthenticated(value: CloudAdminSessionResponse): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { onAuthenticated(await client.login({ email, password })); }
    catch (cause) { setError(message(cause)); setPassword(''); }
    finally { setBusy(false); }
  };
  return <div className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="login-mark">CV</div><h1>ComanView Cloud</h1><p>Acceso privado de administración</p>
    <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>
    <div className="form-error" aria-live="polite">{error ?? '\u00a0'}</div>
    <button className="primary" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
  </form></div>;
}

function Locations({ onSelect, onError }: { onSelect(value: CloudLocationSummary): void; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudLocationSummary> | null>(null);
  const [status, setStatus] = useState('');
  const load = (cursor?: string) => client.getLocations({ status: status || undefined, cursor }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { void load(); }, [status]);
  return <section><PageTitle title="Locations" subtitle="Estado operacional recibido desde cada Edge" />
    <div className="toolbar"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos los estados</option><option>ONLINE</option><option>DEGRADED</option><option>OFFLINE</option></select></div>
    <div className="table-card"><table><thead><tr><th>Location</th><th>Edge</th><th>Estado</th><th>Heartbeat</th><th>Version</th><th>Pendientes</th></tr></thead><tbody>
      {page?.data.map((item) => <tr key={item.locationId} className="clickable" onClick={() => onSelect(item)}><td><code>{item.locationId}</code><small>Tenant {shortId(item.tenantId)}</small></td><td><code>{shortId(item.edgeId)}</code></td><td><Status value={item.edgeStatus} /></td><td>{date(item.lastSeenAt)}</td><td>{item.edgeVersion ?? '—'} / schema {item.schemaVersion ?? '—'}</td><td>{item.pendingEventCount ?? '—'}</td></tr>)}
    </tbody></table>{page && page.data.length === 0 && <Empty text="No hay Locations visibles para este usuario." />}</div>
    {page?.page.nextCursor && <button className="secondary" onClick={() => load(page.page.nextCursor!)}>Siguiente página</button>}
  </section>;
}

function Overview({ location, canViewFinancial, canManageControlPlane, onOpenControlPlane, onOpenOrder, onError }: { location: CloudLocationSummary; canViewFinancial: boolean; canManageControlPlane: boolean; onOpenControlPlane(): void; onOpenOrder(): void; onError(value: string | null): void }) {
  const [data, setData] = useState<CloudLocationOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unprovisioned' | 'error'>('loading');
  useEffect(() => {
    setData(null); setState('loading'); onError(null);
    client.getOverview(location.locationId).then((result) => { setData(result); setState('ready'); }).catch((error) => {
      if (error instanceof CloudAdminClientError && error.code === 'CLOUD_LOCATION_UNPROVISIONED') {
        setState('unprovisioned'); return;
      }
      setState('error'); onError(message(error));
    });
  }, [location.locationId]);
  if (state === 'loading') return <CenteredState text="Cargando overview…" />;
  if (state === 'unprovisioned') return <section><PageTitle title="Location Overview" subtitle={location.locationId} /><article className="panel empty-state"><h2>Esta Location aún no tiene un Edge ACTIVE</h2><p>Provisiona un Edge desde Control Plane para habilitar el estado operacional.</p>{canManageControlPlane && <button className="secondary" onClick={onOpenControlPlane}>Ir a Control Plane</button>}</article></section>;
  if (state === 'error' || !data) return <section><PageTitle title="Location Overview" subtitle={location.locationId} /><Empty text="No fue posible cargar el overview." /></section>;
  return <section><PageTitle title="Location Overview" subtitle={location.locationId} />
    <div className="cards"><Metric label="Edge" value={data.location.edgeStatus} tone={data.location.edgeStatus.toLowerCase()} /><Metric label="Orders OPEN" value={data.orderCounts.open} /><Metric label="Orders CLOSED" value={data.orderCounts.closed} /><Metric label="Orders CANCELLED" value={data.orderCounts.cancelled} /></div>
    <div className="info-grid"><article className="panel"><h2>Operación</h2><Info label="Último heartbeat" value={date(data.location.lastSeenAt)} /><Info label="Último evento recibido" value={date(data.location.projectionHealth.lastEventReceivedAt)} /><Info label="Última projection procesada" value={date(data.location.projectionHealth.lastProjectionProcessedAt)} /><Info label="Eventos reportados pendientes" value={String(data.location.pendingEventCount ?? '—')} /></article>
      {canViewFinancial && data.financial && <article className="panel"><h2>Ventas cerradas completas</h2>{data.financial.completeSalesTotals.map((total) => <div className="financial-total" key={total.currency}><strong>{money(total.chargedTotal, total.currency)}</strong><span>Venta {money(total.saleAmount, total.currency)} · Tip {money(total.tipAmount, total.currency)}</span></div>)}{data.financial.completeSalesTotals.length === 0 && <Empty text="Sin ventas completas en las últimas 24 horas." />}{data.financial.incompleteSaleCount > 0 && <div className="warning">{data.financial.incompleteSaleCount} venta(s) INCOMPLETE excluidas de totals.</div>}</article>}
    </div>
    <div className="section-heading"><h2>Orders recientes</h2><button className="text-button" onClick={onOpenOrder}>Ver todas</button></div><OrdersTable rows={data.recentOrders} />
  </section>;
}

function Orders({ location, canViewFinancial, onError }: { location: CloudLocationSummary; canViewFinancial: boolean; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudOrderSummary> | null>(null); const [status, setStatus] = useState(''); const [detail, setDetail] = useState<CloudOrderDetail | null>(null);
  const load = (cursor?: string) => client.getOrders(location.locationId, { status: status || undefined, cursor }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { setDetail(null); void load(); }, [location.locationId, status]);
  return <section><PageTitle title="Orders" subtitle="Resumen operacional; el detalle de items no está proyectado" /><div className="toolbar"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option>OPEN</option><option>CLOSED</option><option>CANCELLED</option></select></div>
    <OrdersTable rows={page?.data ?? []} onSelect={(order) => client.getOrder(location.locationId, order.orderId).then(setDetail).catch((error) => onError(message(error)))} />
    {page?.page.nextCursor && <button className="secondary" onClick={() => load(page.page.nextCursor!)}>Siguiente página</button>}
    {detail && <article className="panel detail"><button className="close" onClick={() => setDetail(null)}>×</button><h2>Order {shortId(detail.order.orderId)}</h2><Info label="Estado" value={detail.order.status} /><Info label="Items / SENT" value={`${detail.order.itemCount} / ${detail.order.sentItemCount}`} /><Info label="Mesas" value={detail.order.tableIds.join(', ') || '—'} />{canViewFinancial && detail.financial && <><h3>Payments</h3>{detail.financial.payments.map((payment) => <p key={payment.paymentId}>{payment.method} · {money(payment.amountApplied, payment.currency)} + tip {money(payment.tipAmount, payment.currency)} · {payment.status}</p>)}</>}</article>}
  </section>;
}

function Sales({ location, onError }: { location: CloudLocationSummary; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudSaleSummary> | null>(null); const [completeness, setCompleteness] = useState('');
  const load = (cursor?: string) => client.getSales(location.locationId, { completenessStatus: completeness || undefined, cursor }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { void load(); }, [location.locationId, completeness]);
  return <section><PageTitle title="Sales" subtitle="Importes autoritativos proyectados al cierre" /><div className="toolbar"><select value={completeness} onChange={(event) => setCompleteness(event.target.value)}><option value="">Todas</option><option>COMPLETE</option><option>INCOMPLETE</option></select></div><div className="table-card"><table><thead><tr><th>Order</th><th>Cierre UTC</th><th>Venta</th><th>Tip</th><th>Charged total</th><th>Completitud</th></tr></thead><tbody>{page?.data.map((sale) => <tr key={sale.orderId}><td><code>{shortId(sale.orderId)}</code></td><td>{date(sale.closedAt)}</td><td>{money(sale.saleAmount, sale.currency)}</td><td>{money(sale.tipAmount, sale.currency)}</td><td>{money(sale.chargedTotal, sale.currency)}</td><td><Status value={sale.completenessStatus} /></td></tr>)}</tbody></table></div>{page?.page.nextCursor && <button className="secondary" onClick={() => load(page.page.nextCursor!)}>Siguiente página</button>}</section>;
}

function CashSessions({ location, onError }: { location: CloudLocationSummary; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudCashSessionSummary> | null>(null); const [movements, setMovements] = useState<CloudCashMovement[] | null>(null); const [status, setStatus] = useState('');
  const load = () => client.getCashSessions(location.locationId, { status: status || undefined }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { setMovements(null); void load(); }, [location.locationId, status]);
  return <section><PageTitle title="CashSessions" subtitle="Expected y difference sólo aparecen después del cierre Edge" /><div className="toolbar"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas</option><option>OPEN</option><option>CLOSED</option></select></div><div className="table-card"><table><thead><tr><th>Session</th><th>Business date</th><th>Estado</th><th>Opening float</th><th>Expected</th><th>Difference</th></tr></thead><tbody>{page?.data.map((session) => <tr className="clickable" key={session.cashSessionId} onClick={() => client.getCashMovements(location.locationId, session.cashSessionId).then((result) => setMovements(result.data)).catch((error) => onError(message(error)))}><td><code>{shortId(session.cashSessionId)}</code><small>{date(session.openedAt)}</small></td><td>{session.businessDate}</td><td><Status value={session.status} /></td><td>{money(session.openingFloatAmount, session.currency)}</td><td>{session.expectedCashAmount === null ? 'Disponible al cerrar' : money(session.expectedCashAmount, session.currency)}</td><td>{session.differenceAmount === null ? '—' : money(session.differenceAmount, session.currency)}</td></tr>)}</tbody></table></div>{movements && <article className="panel"><h2>Movimientos</h2>{movements.map((movement) => <p key={movement.cashMovementId}><strong>{movement.movementType}</strong> {money(movement.amount, movement.currency)} · {movement.reason} · {date(movement.occurredAt)}</p>)}{movements.length === 0 && <Empty text="Sin movimientos para esta sesión." />}</article>}</section>;
}

function ControlPlane({ onError }: { onError(value: string | null): void }) {
  const [tenants, setTenants] = useState<CloudTenant[]>([]); const [tenant, setTenant] = useState<CloudTenant | null>(null);
  const [locations, setLocations] = useState<CanonicalCloudLocation[]>([]); const [edges, setEdges] = useState<Record<string, ProvisionedEdge[]>>({});
  const [pendingReplacements, setPendingReplacements] = useState<Record<string, EdgeReplacement | null>>({});
  const [tenantName, setTenantName] = useState(''); const [locationName, setLocationName] = useState(''); const [timezone, setTimezone] = useState('America/Matamoros');
  const [issued, setIssued] = useState<{ provisioningCodeId: string; code: string; expiresAt: string } | null>(null);
  const loadTenants = () => client.getTenants().then((result) => setTenants(result.data)).catch((error) => onError(message(error)));
  const loadLocations = (selected: CloudTenant) => client.getCanonicalLocations(selected.tenantId).then(async (result) => {
    setLocations(result.data); setTenant(selected);
    const states = await Promise.all(result.data.map(async (location) => {
      const [edgeResult, replacementResult] = await Promise.all([
        client.getEdges(location.locationId), client.getPendingReplacement(location.locationId),
      ]);
      return [location.locationId, edgeResult.data, replacementResult.replacement] as const;
    }));
    setEdges(Object.fromEntries(states.map(([locationId, locationEdges]) => [locationId, locationEdges])));
    setPendingReplacements(Object.fromEntries(states.map(([locationId, , replacement]) => [locationId, replacement])));
  }).catch((error) => onError(message(error)));
  useEffect(() => { void loadTenants(); }, []);
  return <section><PageTitle title="Tenant & Edge Control Plane" subtitle="Provisioning seguro; el código se muestra una sola vez" />
    <div className="control-grid"><article className="panel"><h2>Nuevo Tenant</h2><label>Nombre<input value={tenantName} onChange={(event) => setTenantName(event.target.value)} /></label><button className="primary" onClick={() => client.createTenant({ commandId: crypto.randomUUID(), displayName: tenantName }).then((created) => { setTenantName(''); void loadTenants(); void loadLocations(created); }).catch((error) => onError(message(error)))}>Crear Tenant</button></article>
      <article className="panel"><h2>Nueva Location</h2><label>Tenant<select value={tenant?.tenantId ?? ''} onChange={(event) => { const selected = tenants.find((item) => item.tenantId === event.target.value); if (selected) void loadLocations(selected); }}><option value="">Selecciona</option>{tenants.map((item) => <option key={item.tenantId} value={item.tenantId}>{item.displayName ?? item.tenantId}</option>)}</select></label><label>Nombre<input value={locationName} onChange={(event) => setLocationName(event.target.value)} /></label><label>Timezone IANA<input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label><button className="primary" disabled={!tenant} onClick={() => tenant && client.createLocation(tenant.tenantId, { commandId: crypto.randomUUID(), displayName: locationName, timezone }).then(() => { setLocationName(''); void loadLocations(tenant); }).catch((error) => onError(message(error)))}>Crear Location</button></article></div>
    <div className="table-card"><table><thead><tr><th>Tenant</th><th>Estado</th></tr></thead><tbody>{tenants.map((item) => <tr className="clickable" key={item.tenantId} onClick={() => void loadLocations(item)}><td>{item.displayName ?? 'Legacy sin configurar'}<small>{item.tenantId}</small></td><td><Status value={item.status} /></td></tr>)}</tbody></table></div>
    {tenant && <article className="panel"><h2>Locations de {tenant.displayName}</h2>{locations.map((location) => { const active = edges[location.locationId]?.find((edge) => edge.status === 'ACTIVE'); const pending = pendingReplacements[location.locationId]; return <div className="location-control" key={location.locationId}><div><strong>{location.displayName ?? 'Pendiente de configuración'}</strong><small>{location.locationId} · {location.timezone ?? 'Timezone pendiente'}</small>{(edges[location.locationId] ?? []).map((edge) => <small key={edge.edgeId}>{shortId(edge.edgeId)} · {edge.status}</small>)}{pending && <small className="pending-replacement">Replacement PENDING · código {pending.provisioningCode.status} · expira {date(pending.provisioningCode.expiresAt)}</small>}</div><Status value={location.configurationStatus} /><span>{active ? 'Edge ACTIVE' : 'Sin Edge ACTIVE'}</span>{pending ? <button className="secondary danger" onClick={() => { const reason = window.prompt('Motivo de cancelación del Replacement'); if (reason) void client.cancelReplacement(pending.replacementId, { commandId: crypto.randomUUID(), reason }).then(() => loadLocations(tenant)).catch((error) => onError(message(error))); }}>Cancelar Replacement</button> : active ? <div className="edge-actions"><button className="secondary" onClick={() => { const reason = window.prompt('Motivo de revocación'); if (reason) void client.revokeEdge(active.edgeId, { commandId: crypto.randomUUID(), reason }).then(() => loadLocations(tenant)).catch((error) => onError(message(error))); }}>Revocar</button><button className="secondary" onClick={() => { const reason = window.prompt('Motivo del replacement'); if (reason) void client.initiateReplacement(location.locationId, { commandId: crypto.randomUUID(), oldEdgeId: active.edgeId, reason }).then((result) => { setIssued(result.provisioningCode); void loadLocations(tenant); }).catch((error) => onError(message(error))); }}>Replacement</button></div> : <button className="secondary" onClick={() => client.generateProvisioningCode(location.locationId, crypto.randomUUID()).then(setIssued).catch((error) => onError(message(error)))}>Generar código</button>}</div>; })}</article>}
    {issued && <div className="secret-once" role="alert"><strong>Código de provisioning (cópialo ahora)</strong><code>{issued.code}</code><span>Expira {date(issued.expiresAt)}</span><div className="edge-actions"><button onClick={() => client.revokeProvisioningCode(issued.provisioningCodeId, crypto.randomUUID()).then(() => setIssued(null)).catch((error) => onError(message(error)))}>Revocar código</button><button onClick={() => setIssued(null)}>Ya lo guardé</button></div></div>}
  </section>;
}

function OrdersTable({ rows, onSelect }: { rows: CloudOrderSummary[]; onSelect?: (value: CloudOrderSummary) => void }) { return <div className="table-card"><table><thead><tr><th>Order</th><th>Creada UTC</th><th>Tipo / canal</th><th>Estado</th><th>Items / SENT</th><th>Mesas</th></tr></thead><tbody>{rows.map((order) => <tr key={order.orderId} className={onSelect ? 'clickable' : ''} onClick={() => onSelect?.(order)}><td><code>{shortId(order.orderId)}</code></td><td>{date(order.createdAt)}</td><td>{order.orderType} / {order.orderChannel}</td><td><Status value={order.status} /></td><td>{order.itemCount} / {order.sentItemCount}</td><td>{order.tableIds.map(shortId).join(', ') || '—'}</td></tr>)}</tbody></table>{rows.length === 0 && <Empty text="No hay Orders para estos filtros." />}</div>; }
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div></div>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <article className={`metric ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong></article>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function CenteredState({ text }: { text: string }) { return <div className="centered-state">{text}</div>; }
function shortId(value: string | null) { return value ? value.slice(0, 8) : 'Sin Edge'; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Nunca'; }
function money(amount: number, currency: string | null) { return currency ? new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount / 100) : `${amount} minor units`; }
function message(error: unknown) { return error instanceof CloudAdminClientError ? error.message : error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
