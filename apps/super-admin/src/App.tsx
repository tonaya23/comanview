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
} from '@comanview/contracts';

type View = 'locations' | 'overview' | 'orders' | 'sales' | 'cash';
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
          {view === 'locations' && <Locations onSelect={selectLocation} onError={setError} />}
          {location && view === 'overview' && <Overview location={location} canViewFinancial={canViewFinancial} onOpenOrder={() => setView('orders')} onError={setError} />}
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

function Overview({ location, canViewFinancial, onOpenOrder, onError }: { location: CloudLocationSummary; canViewFinancial: boolean; onOpenOrder(): void; onError(value: string | null): void }) {
  const [data, setData] = useState<CloudLocationOverview | null>(null);
  useEffect(() => { client.getOverview(location.locationId).then(setData).catch((error) => onError(message(error))); }, [location.locationId]);
  if (!data) return <CenteredState text="Cargando overview…" />;
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

function OrdersTable({ rows, onSelect }: { rows: CloudOrderSummary[]; onSelect?: (value: CloudOrderSummary) => void }) { return <div className="table-card"><table><thead><tr><th>Order</th><th>Creada UTC</th><th>Tipo / canal</th><th>Estado</th><th>Items / SENT</th><th>Mesas</th></tr></thead><tbody>{rows.map((order) => <tr key={order.orderId} className={onSelect ? 'clickable' : ''} onClick={() => onSelect?.(order)}><td><code>{shortId(order.orderId)}</code></td><td>{date(order.createdAt)}</td><td>{order.orderType} / {order.orderChannel}</td><td><Status value={order.status} /></td><td>{order.itemCount} / {order.sentItemCount}</td><td>{order.tableIds.map(shortId).join(', ') || '—'}</td></tr>)}</tbody></table>{rows.length === 0 && <Empty text="No hay Orders para estos filtros." />}</div>; }
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div></div>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <article className={`metric ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong></article>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function CenteredState({ text }: { text: string }) { return <div className="centered-state">{text}</div>; }
function shortId(value: string) { return value.slice(0, 8); }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Nunca'; }
function money(amount: number, currency: string | null) { return currency ? new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount / 100) : `${amount} minor units`; }
function message(error: unknown) { return error instanceof CloudAdminClientError ? error.message : error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
