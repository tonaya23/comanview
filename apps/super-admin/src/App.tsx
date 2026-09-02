import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
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
  CloudPlan,
  LocationLicenseAssignment,
  CapabilityCode,
  LicenseDeclaredState,
  InstallationAuthorizationStatus,
  PairingAuthorizationData,
} from '@comanview/contracts';
import { InstallationAuthorizationPanel } from './InstallationAuthorizationPanel.js';
import { LocationCommercialSummary } from './LocationCommercialSummary.js';

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
    <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>
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
      {page?.data.map((item) => <tr key={item.locationId} className="clickable" role="button" tabIndex={0} onKeyDown={(event)=>activateRow(event,()=>onSelect(item))} onClick={() => onSelect(item)}><td><code>{item.locationId}</code><small>Tenant {shortId(item.tenantId)}</small></td><td><code>{shortId(item.edgeId)}</code></td><td><Status value={item.edgeStatus} /></td><td>{date(item.lastSeenAt)}</td><td>{item.edgeVersion ?? '—'} / schema {item.schemaVersion ?? '—'}</td><td>{item.pendingEventCount ?? '—'}</td></tr>)}
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
  if (state === 'loading') return <CenteredState text="Cargando resumen…" />;
  if (state === 'unprovisioned') return <section><PageTitle title="Resumen de Location" subtitle={location.locationId} /><article className="panel empty-state"><h2>Esta Location aún no tiene un Edge activo</h2><p>Provisiona un Edge desde Control Plane para habilitar el estado operacional.</p>{canManageControlPlane && <button className="secondary" onClick={onOpenControlPlane}>Ir a Control Plane</button>}</article></section>;
  if (state === 'error' || !data) return <section><PageTitle title="Resumen de Location" subtitle={location.locationId} /><Empty text="No fue posible cargar el resumen." /></section>;
  return <section><PageTitle title="Resumen de Location" subtitle={location.locationId} />
    <div className="cards"><Metric label="Edge" value={statusLabel(data.location.edgeStatus)} tone={data.location.edgeStatus.toLowerCase()} /><Metric label="Pedidos abiertos" value={data.orderCounts.open} /><Metric label="Pedidos cerrados" value={data.orderCounts.closed} /><Metric label="Pedidos cancelados" value={data.orderCounts.cancelled} /></div>
    <div className="info-grid"><article className="panel"><h2>Operación</h2><Info label="Último heartbeat" value={date(data.location.lastSeenAt)} /><Info label="Último evento recibido" value={date(data.location.projectionHealth.lastEventReceivedAt)} /><Info label="Última projection procesada" value={date(data.location.projectionHealth.lastProjectionProcessedAt)} /><Info label="Eventos reportados pendientes" value={String(data.location.pendingEventCount ?? '—')} /></article>
      {canViewFinancial && data.financial && <article className="panel"><h2>Ventas cerradas completas</h2>{data.financial.completeSalesTotals.map((total) => <div className="financial-total" key={total.currency}><strong>{money(total.chargedTotal, total.currency)}</strong><span>Venta {money(total.saleAmount, total.currency)} · Propina {money(total.tipAmount, total.currency)}</span></div>)}{data.financial.completeSalesTotals.length === 0 && <Empty text="Sin ventas completas en las últimas 24 horas." />}{data.financial.incompleteSaleCount > 0 && <div className="warning">{data.financial.incompleteSaleCount} venta(s) incompleta(s) excluida(s) de los totales.</div>}</article>}
    </div>
    <div className="section-heading"><h2>Pedidos recientes</h2><button className="text-button" onClick={onOpenOrder}>Ver todos</button></div><OrdersTable rows={data.recentOrders} />
  </section>;
}

function Orders({ location, canViewFinancial, onError }: { location: CloudLocationSummary; canViewFinancial: boolean; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudOrderSummary> | null>(null); const [status, setStatus] = useState(''); const [detail, setDetail] = useState<CloudOrderDetail | null>(null);
  const load = (cursor?: string) => client.getOrders(location.locationId, { status: status || undefined, cursor }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { setDetail(null); void load(); }, [location.locationId, status]);
  return <section><PageTitle title="Pedidos" subtitle="Resumen operacional; el detalle de productos no está proyectado" /><div className="toolbar"><select aria-label="Filtrar pedidos por estado" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="OPEN">Abiertos</option><option value="CLOSED">Cerrados</option><option value="CANCELLED">Cancelados</option></select></div>
    <OrdersTable rows={page?.data ?? []} onSelect={(order) => client.getOrder(location.locationId, order.orderId).then(setDetail).catch((error) => onError(message(error)))} />
    {page?.page.nextCursor && <button className="secondary" onClick={() => load(page.page.nextCursor!)}>Siguiente página</button>}
    {detail && <article className="panel detail"><button type="button" className="close" aria-label="Cerrar detalle del pedido" onClick={() => setDetail(null)}>×</button><h2>Pedido {shortId(detail.order.orderId)}</h2><Info label="Estado" value={statusLabel(detail.order.status)} /><Info label="Productos / enviados" value={`${detail.order.itemCount} / ${detail.order.sentItemCount}`} /><Info label="Mesas" value={detail.order.tableIds.join(', ') || '—'} />{canViewFinancial && detail.financial && <><h3>Pagos</h3>{detail.financial.payments.map((payment) => <p key={payment.paymentId}>{payment.method} · {money(payment.amountApplied, payment.currency)} + propina {money(payment.tipAmount, payment.currency)} · {statusLabel(payment.status)}</p>)}</>}</article>}
  </section>;
}

function Sales({ location, onError }: { location: CloudLocationSummary; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudSaleSummary> | null>(null); const [completeness, setCompleteness] = useState('');
  const load = (cursor?: string) => client.getSales(location.locationId, { completenessStatus: completeness || undefined, cursor }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { void load(); }, [location.locationId, completeness]);
  return <section><PageTitle title="Ventas" subtitle="Importes autoritativos proyectados al cierre" /><div className="toolbar"><select aria-label="Filtrar ventas por completitud" value={completeness} onChange={(event) => setCompleteness(event.target.value)}><option value="">Todas</option><option value="COMPLETE">Completas</option><option value="INCOMPLETE">Incompletas</option></select></div><div className="table-card"><table><thead><tr><th>Pedido</th><th>Cierre UTC</th><th>Venta</th><th>Propina</th><th>Total cobrado</th><th>Completitud</th></tr></thead><tbody>{page?.data.map((sale) => <tr key={sale.orderId}><td><code>{shortId(sale.orderId)}</code></td><td>{date(sale.closedAt)}</td><td>{money(sale.saleAmount, sale.currency)}</td><td>{money(sale.tipAmount, sale.currency)}</td><td>{money(sale.chargedTotal, sale.currency)}</td><td><Status value={sale.completenessStatus} /></td></tr>)}</tbody></table></div>{page?.page.nextCursor && <button className="secondary" onClick={() => load(page.page.nextCursor!)}>Siguiente página</button>}</section>;
}

function CashSessions({ location, onError }: { location: CloudLocationSummary; onError(value: string | null): void }) {
  const [page, setPage] = useState<CloudAdminPage<CloudCashSessionSummary> | null>(null); const [movements, setMovements] = useState<CloudCashMovement[] | null>(null); const [status, setStatus] = useState('');
  const load = () => client.getCashSessions(location.locationId, { status: status || undefined }).then(setPage).catch((error) => onError(message(error)));
  useEffect(() => { setMovements(null); void load(); }, [location.locationId, status]);
  const selectSession=(cashSessionId:string)=>client.getCashMovements(location.locationId,cashSessionId).then((result)=>setMovements(result.data)).catch((error)=>onError(message(error)));
  return <section><PageTitle title="Sesiones de caja" subtitle="El efectivo esperado y la diferencia aparecen después del cierre en Edge" /><div className="toolbar"><select aria-label="Filtrar sesiones de caja por estado" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas</option><option value="OPEN">Abiertas</option><option value="CLOSED">Cerradas</option></select></div><div className="table-card"><table><thead><tr><th>Sesión</th><th>Día operativo</th><th>Estado</th><th>Fondo inicial</th><th>Efectivo esperado</th><th>Diferencia</th></tr></thead><tbody>{page?.data.map((session) => <tr className="clickable" role="button" tabIndex={0} key={session.cashSessionId} onKeyDown={(event)=>activateRow(event,()=>selectSession(session.cashSessionId))} onClick={()=>selectSession(session.cashSessionId)}><td><code>{shortId(session.cashSessionId)}</code><small>{date(session.openedAt)}</small></td><td>{session.businessDate}</td><td><Status value={session.status} /></td><td>{money(session.openingFloatAmount, session.currency)}</td><td>{session.expectedCashAmount === null ? 'Disponible al cerrar' : money(session.expectedCashAmount, session.currency)}</td><td>{session.differenceAmount === null ? '—' : money(session.differenceAmount, session.currency)}</td></tr>)}</tbody></table></div>{movements && <article className="panel"><h2>Movimientos</h2>{movements.map((movement) => <p key={movement.cashMovementId}><strong>{movement.movementType}</strong> {money(movement.amount, movement.currency)} · {movement.reason} · {date(movement.occurredAt)}</p>)}{movements.length === 0 && <Empty text="Sin movimientos para esta sesión." />}</article>}</section>;
}

function ControlPlane({ onError }: { onError(value: string | null): void }) {
  const [tenants, setTenants] = useState<CloudTenant[]>([]);
  const [tenant, setTenant] = useState<CloudTenant | null>(null);
  const [locations, setLocations] = useState<CanonicalCloudLocation[]>([]);
  const [edges, setEdges] = useState<Record<string, ProvisionedEdge[]>>({});
  const [pendingReplacements, setPendingReplacements] = useState<
    Record<string, EdgeReplacement | null>
  >({});
  const [plans, setPlans] = useState<CloudPlan[]>([]);
  const [licenses, setLicenses] = useState<Record<string, LocationLicenseAssignment | null>>({});
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [planCode, setPlanCode] = useState('');
  const [planName, setPlanName] = useState('');
  const [planCapabilities, setPlanCapabilities] = useState<CapabilityCode[]>(['CORE_POS']);
  const [planDeviceLimits,setPlanDeviceLimits]=useState({POS:'',WAITER:'',KDS:''});
  const [installationAuthorization,setInstallationAuthorization]=useState<string|null>(null);
  const [recoveryAuthorization,setRecoveryAuthorization]=useState<string|null>(null);
  const [installationAuthorizationStatuses,setInstallationAuthorizationStatuses]=useState<Record<string,InstallationAuthorizationStatus|null>>({});
  const [installationAuthorizationTarget,setInstallationAuthorizationTarget]=useState<CanonicalCloudLocation|null>(null);
  const [installationAuthorizationError,setInstallationAuthorizationError]=useState<string|null>(null);
  const [installationAuthorizationBusy,setInstallationAuthorizationBusy]=useState(false);
  const [tenantName, setTenantName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [timezone, setTimezone] = useState('America/Matamoros');
  const [issued, setIssued] = useState<{
    provisioningCodeId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const loadTenants = () =>
    Promise.all([client.getTenants(), client.getPlans()])
      .then(([tenantResult, planResult]) => {
        setTenants(tenantResult.data);
        setPlans(planResult.data);
      })
      .catch((error) => onError(message(error)));
  const loadLocations = (selected: CloudTenant) =>
    client
      .getCanonicalLocations(selected.tenantId)
      .then(async (result) => {
        setLocations(result.data);
        setTenant(selected);
        const states = await Promise.all(
          result.data.map(async (location) => {
            const [edgeResult, replacementResult, license,installationAuthorizationStatus] = await Promise.all([
              client.getEdges(location.locationId),
              client.getPendingReplacement(location.locationId),
              client.getLocationLicense(location.locationId).catch((error) => {
                if (error instanceof CloudAdminClientError && error.status === 404) return null;
                throw error;
              }),
              client.getLatestInstallationAuthorization(location.locationId).then(result=>result.authorization).catch((error) => {
                if (error instanceof CloudAdminClientError && error.status === 404) return null;
                throw error;
              }),
            ]);
            return [
              location.locationId,
              edgeResult.data,
              replacementResult.replacement,
              license,
              installationAuthorizationStatus,
            ] as const;
          }),
        );
        setEdges(
          Object.fromEntries(
            states.map(([locationId, locationEdges]) => [locationId, locationEdges]),
          ),
        );
        setPendingReplacements(
          Object.fromEntries(
            states.map(([locationId, , replacement]) => [locationId, replacement]),
          ),
        );
        setLicenses(
          Object.fromEntries(states.map(([locationId, , , license]) => [locationId, license])),
        );
        setInstallationAuthorizationStatuses(Object.fromEntries(states.map(([locationId,,,,status])=>[locationId,status])));
      })
      .catch((error) => onError(message(error)));
  useEffect(() => {
    void loadTenants();
  }, []);
  return (
    <section>
      <PageTitle
        title="Control de Tenants, Locations y Edge"
        subtitle="Provisioning, licencias e instalación inicial con historial y autorización explícita"
      />
      <div className="control-grid">
        <article className="panel">
          <h2>Nuevo Tenant</h2>
          <label>
            Nombre
            <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} />
          </label>
          <button
            className="primary"
            onClick={() =>
              client
                .createTenant({ commandId: crypto.randomUUID(), displayName: tenantName })
                .then((created) => {
                  setTenantName('');
                  void loadTenants();
                  void loadLocations(created);
                })
                .catch((error) => onError(message(error)))
            }
          >
            Crear Tenant
          </button>
        </article>
        <article className="panel">
          <h2>Nueva Location</h2>
          <label>
            Tenant
            <select
              value={tenant?.tenantId ?? ''}
              onChange={(event) => {
                const selected = tenants.find((item) => item.tenantId === event.target.value);
                if (selected) void loadLocations(selected);
              }}
            >
              <option value="">Selecciona</option>
              {tenants.map((item) => (
                <option key={item.tenantId} value={item.tenantId}>
                  {item.displayName ?? item.tenantId}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre
            <input value={locationName} onChange={(event) => setLocationName(event.target.value)} />
          </label>
          <label>
            Timezone IANA
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!tenant}
            onClick={() =>
              tenant &&
              client
                .createLocation(tenant.tenantId, {
                  commandId: crypto.randomUUID(),
                  displayName: locationName,
                  timezone,
                })
                .then(() => {
                  setLocationName('');
                  void loadLocations(tenant);
                })
                .catch((error) => onError(message(error)))
            }
          >
            Crear Location
          </button>
        </article>
      </div>
      <article className="panel">
        <h2>Planes técnicos/comerciales</h2>
        <div className="control-grid compact">
          <label>
            Código
            <input
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value.toUpperCase())}
              placeholder="Código definido por negocio"
            />
          </label>
          <label>
            Nombre
            <input value={planName} onChange={(event) => setPlanName(event.target.value)} />
          </label>
        </div>
        <div className="capability-grid">
          {(
            [
              'CORE_POS',
              'TABLE_SERVICE',
              'KDS',
              'PRINTING',
              'PUBLIC_STOREFRONT',
              'INVENTORY',
              'MULTI_LOCATION',
            ] as CapabilityCode[]
          ).map((capability) => (
            <label key={capability}>
              <input
                type="checkbox"
                checked={planCapabilities.includes(capability)}
                onChange={(event) =>
                  setPlanCapabilities(
                    event.target.checked
                      ? [...planCapabilities, capability]
                      : planCapabilities.filter((item) => item !== capability),
                  )
                }
              />
              {capability}
            </label>
          ))}
        </div>
        <div className="control-grid compact">
          {(['POS','WAITER','KDS'] as const).map((type)=><label key={type}>
            Límite {type} <small>vacío = sin límite</small>
            <input type="number" min="0" step="1" value={planDeviceLimits[type]}
              onChange={(event)=>setPlanDeviceLimits({...planDeviceLimits,[type]:event.target.value})}/>
          </label>)}
        </div>
        <button
          className="secondary"
          onClick={() =>
            client
              .createPlan({
                commandId: crypto.randomUUID(),
                code: planCode,
                displayName: planName,
                capabilities: planCapabilities,
                deviceLimits: {
                  POS: planDeviceLimits.POS === '' ? null : Number(planDeviceLimits.POS),
                  WAITER: planDeviceLimits.WAITER === '' ? null : Number(planDeviceLimits.WAITER),
                  KDS: planDeviceLimits.KDS === '' ? null : Number(planDeviceLimits.KDS),
                },
                reason: 'Plan configuration from Super Admin',
              })
              .then(() => {
                setPlanCode('');
                setPlanName('');
                setPlanDeviceLimits({POS:'',WAITER:'',KDS:''});
                void loadTenants();
              })
              .catch((error) => onError(message(error)))
          }
        >
          Crear plan
        </button>
        {plans.map((plan) => (
          <small className="plan-row" key={plan.planId}>
            {plan.code} · {plan.capabilities.join(', ') || 'Sin capabilities'} · limits {JSON.stringify(plan.deviceLimits)}
          </small>
        ))}
      </article>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((item) => (
              <tr
                className="clickable"
                key={item.tenantId}
                onClick={() => void loadLocations(item)}
              >
                <td>
                  {item.displayName ?? 'Legacy sin configurar'}
                  <small>{item.tenantId}</small>
                </td>
                <td>
                  <Status value={item.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tenant && (
        <article className="panel">
          <h2>Locations de {tenant.displayName}</h2>
          {locations.map((location) => {
            const active = edges[location.locationId]?.find((edge) => edge.status === 'ACTIVE');
            const replaced = edges[location.locationId]?.find((edge) => edge.status === 'REPLACED');
            const pending = pendingReplacements[location.locationId];
            const license = licenses[location.locationId];
            const assignedPlan = license ? plans.find((plan) => plan.planId === license.planId) ?? null : null;
            return (
              <div className="location-control" key={location.locationId}>
                <div className="location-summary">
                  <strong>{location.displayName ?? 'Pendiente de configuración'}</strong>
                  <span>{location.timezone ?? 'Timezone pendiente'}</span>
                  {(edges[location.locationId] ?? []).map((edge) => (
                    <span className="edge-history" key={edge.edgeId}><Status value={edge.status}/> Edge …{edge.edgeId.slice(-8)}</span>
                  ))}
                  {!license ? (
                    <span className="pending-replacement">Licencia no asignada</span>
                  ) : null}
                  {pending && (
                    <span className="pending-replacement">
                      Reemplazo pendiente · código {pending.provisioningCode.status} · expira{' '}
                      {date(pending.provisioningCode.expiresAt)}
                    </span>
                  )}
                  <details><summary>Detalles técnicos</summary><code>{location.locationId}</code></details>
                </div>
                <div className="location-state"><span>Configuración</span><Status value={location.configurationStatus}/><span>{active ? 'Edge operativo' : 'Sin Edge activo'}</span></div>
                <div className="location-license-controls">
                  {license ? <LocationCommercialSummary license={license} plan={assignedPlan}/> : null}
                  {license ? (
                    <div className="license-actions">
                      <select
                        value={license.declaredState}
                        onChange={(event) =>
                          client
                            .updateLocationLicenseState(location.locationId, {
                              commandId: crypto.randomUUID(),
                              expectedRevision: license.revision,
                              declaredState: event.target.value as LicenseDeclaredState,
                              reason: 'License state changed from Super Admin',
                            })
                            .then(() => loadLocations(tenant))
                            .catch((error) => onError(message(error)))
                        }
                      >
                        {['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'TERMINATED'].map(
                          (state) => (
                            <option key={state}>{state}</option>
                          ),
                        )}
                      </select>
                      <select
                        value={selectedPlans[location.locationId] ?? license.planId}
                        onChange={(event) =>
                          setSelectedPlans({
                            ...selectedPlans,
                            [location.locationId]: event.target.value,
                          })
                        }
                      >
                        {plans.map((plan) => (
                          <option key={plan.planId} value={plan.planId}>
                            {plan.code}
                          </option>
                        ))}
                      </select>
                      <button
                        className="secondary"
                        onClick={() =>
                          client
                            .assignLocationLicense(location.locationId, {
                              commandId: crypto.randomUUID(),
                              expectedRevision: license.revision,
                              planId: selectedPlans[location.locationId] ?? license.planId,
                              declaredState: license.declaredState,
                              configuration: license.configuration,
                              reason: 'Plan assignment changed from Super Admin',
                            })
                            .then(() => loadLocations(tenant))
                            .catch((error) => onError(message(error)))
                        }
                      >
                        Aplicar plan
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const values = window.prompt(
                            'Porcentajes de propina separados por coma (ej. 10,15,20). Vacío desactiva propinas.',
                            license.configuration.payment.tipPercentageOptionsBasisPoints
                              .map((value) => value / 100)
                              .join(','),
                          );
                          if (values === null) return;
                          const percentages = values.trim() === ''
                            ? []
                            : values.split(',').map((value) => Number(value.trim()));
                          if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
                            onError('Los porcentajes de propina deben estar entre 0 y 100.');
                            return;
                          }
                          void client
                            .updateLocationConfiguration(location.locationId, {
                              commandId: crypto.randomUUID(),
                              expectedRevision: license.configurationRevision,
                              configuration: {
                                payment: {
                                  tipsEnabled: percentages.length > 0,
                                  tipPercentageOptionsBasisPoints: percentages.map((value) =>
                                    Math.round(value * 100),
                                  ),
                                },
                              },
                              reason: 'Payment tip configuration changed from Super Admin',
                            })
                            .then(() => loadLocations(tenant))
                            .catch((error) => onError(message(error)));
                        }}
                      >
                        Configurar propinas
                      </button>
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedPlans[location.locationId] ?? ''}
                        onChange={(event) =>
                          setSelectedPlans({
                            ...selectedPlans,
                            [location.locationId]: event.target.value,
                          })
                        }
                      >
                        <option value="">Asignar plan…</option>
                        {plans.map((plan) => (
                          <option key={plan.planId} value={plan.planId}>
                            {plan.code}
                          </option>
                        ))}
                      </select>
                      <button
                        className="secondary"
                        disabled={!selectedPlans[location.locationId]}
                        onClick={() =>
                          client
                            .assignLocationLicense(location.locationId, {
                              commandId: crypto.randomUUID(),
                              expectedRevision: 0,
                              planId: selectedPlans[location.locationId]!,
                              declaredState: 'ACTIVE',
                              configuration: {
                                payment: {
                                  tipsEnabled: true,
                                  tipPercentageOptionsBasisPoints: [1000, 1500, 2000],
                                },
                              },
                              reason: 'Initial license assignment from Super Admin',
                            })
                            .then(() => loadLocations(tenant))
                            .catch((error) => onError(message(error)))
                        }
                      >
                        Asignar licencia
                      </button>
                    </>
                  )}
                </div>
                {active && license && <button className="secondary" onClick={() => {setInstallationAuthorizationTarget(location);setInstallationAuthorizationError(null);}}>Autorizar instalación inicial</button>}
                {active&&replaced&&<button className="secondary" onClick={()=>{
                  const backupId=window.prompt('Backup ID verificado que se restaurará en el Edge nuevo');if(!backupId)return;
                  const reason=window.prompt('Motivo de recuperación de hardware');if(!reason)return;
                  void client.issueRecoveryAuthorization(location.locationId,{commandId:crypto.randomUUID(),
                    sourceEdgeId:replaced.edgeId,targetEdgeId:active.edgeId,backupId,reason})
                    .then(result=>setRecoveryAuthorization(JSON.stringify(result.authorization)))
                    .catch(error=>onError(message(error)));
                }}>Autorizar recuperación</button>}
                {installationAuthorizationStatuses[location.locationId]&&<span className="authorization-summary">
                  <span>Autorización inicial</span><Status value={installationAuthorizationStatuses[location.locationId]!.status}/>
                  <small>Expira {date(installationAuthorizationStatuses[location.locationId]!.expiresAt)}</small>
                </span>}
                {pending ? (
                  <button
                    className="secondary danger"
                    onClick={() => {
                      const reason = window.prompt('Motivo de cancelación del Replacement');
                      if (reason)
                        void client
                          .cancelReplacement(pending.replacementId, {
                            commandId: crypto.randomUUID(),
                            reason,
                          })
                          .then(() => loadLocations(tenant))
                          .catch((error) => onError(message(error)));
                    }}
                  >
                    Cancelar reemplazo
                  </button>
                ) : active ? (
                  <div className="edge-actions">
                    <button
                      className="secondary danger"
                      onClick={() => {
                        const reason = window.prompt('Motivo de revocación');
                        if (reason)
                          void client
                            .revokeEdge(active.edgeId, { commandId: crypto.randomUUID(), reason })
                            .then(() => loadLocations(tenant))
                            .catch((error) => onError(message(error)));
                      }}
                    >
                      Revocar Edge
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        const reason = window.prompt('Motivo del replacement');
                        if (reason)
                          void client
                            .initiateReplacement(location.locationId, {
                              commandId: crypto.randomUUID(),
                              oldEdgeId: active.edgeId,
                              reason,
                            })
                            .then((result) => {
                              setIssued(result.provisioningCode);
                              void loadLocations(tenant);
                            })
                            .catch((error) => onError(message(error)));
                      }}
                    >
                      Reemplazar Edge
                    </button>
                  </div>
                ) : (
                  <button
                    className="secondary"
                    disabled={!license}
                    title={!license ? 'Asigna una licencia antes de provisionar' : undefined}
                    onClick={() =>
                      client
                        .generateProvisioningCode(location.locationId, crypto.randomUUID())
                        .then(setIssued)
                        .catch((error) => onError(message(error)))
                    }
                  >
                    Generar código
                  </button>
                )}
              </div>
            );
          })}
        </article>
      )}
      {issued && (
        <div className="secret-once" role="alert">
          <strong>Código de provisioning (cópialo ahora)</strong>
          <code>{issued.code}</code>
          <span>Expira {date(issued.expiresAt)}</span>
          <div className="edge-actions">
            <button
              onClick={() =>
                client
                  .revokeProvisioningCode(issued.provisioningCodeId, crypto.randomUUID())
                  .then(() => setIssued(null))
                  .catch((error) => onError(message(error)))
              }
            >
              Revocar código
            </button>
            <button onClick={() => setIssued(null)}>Ya lo guardé</button>
          </div>
        </div>
      )}
      {installationAuthorization && (
        <div className="secret-once" role="alert">
          <strong>Autorización inicial firmada (cópiala ahora)</strong>
          <textarea readOnly value={installationAuthorization} aria-label="Autorización inicial firmada" />
          <span>No contiene el PIN ni la credencial del dispositivo.</span>
          <button onClick={() => setInstallationAuthorization(null)}>Ya la guardé</button>
        </div>
      )}
      {recoveryAuthorization&&<div className="secret-once" role="alert">
        <strong>Autorización de recuperación firmada (cópiala ahora)</strong>
        <textarea readOnly value={recoveryAuthorization} aria-label="Autorización de recuperación firmada" />
        <span>Es temporal, de un solo uso y está ligada al Edge y backup indicados.</span>
        <button onClick={()=>setRecoveryAuthorization(null)}>Ya la guardé</button>
      </div>}
      {installationAuthorizationTarget && <InstallationAuthorizationPanel
        locationName={installationAuthorizationTarget.displayName??'Location sin nombre'}
        status={installationAuthorizationStatuses[installationAuthorizationTarget.locationId]??null}
        busy={installationAuthorizationBusy} error={installationAuthorizationError}
        onClose={()=>{if(!installationAuthorizationBusy){setInstallationAuthorizationTarget(null);setInstallationAuthorizationError(null);}}}
        onSubmit={(pairing:PairingAuthorizationData,ownerDisplayName:string)=>{
          setInstallationAuthorizationBusy(true);setInstallationAuthorizationError(null);
          void client.issueInstallationAuthorization(installationAuthorizationTarget.locationId,{commandId:crypto.randomUUID(),
            pairingId:pairing.pairingId,pairingCode:pairing.pairingCode,deviceId:pairing.deviceId,
            deviceType:pairing.deviceType,displayName:pairing.displayName,initialOwnerDisplayName:ownerDisplayName,
            reason:'Initial installation authorization from Super Admin'})
            .then(result=>{setInstallationAuthorization(JSON.stringify(result.authorization));setInstallationAuthorizationTarget(null);void loadLocations(tenant!);})
            .catch(error=>setInstallationAuthorizationError(message(error)))
            .finally(()=>setInstallationAuthorizationBusy(false));
        }}/>
      }
    </section>
  );
}

function OrdersTable({ rows, onSelect }: { rows: CloudOrderSummary[]; onSelect?: (value: CloudOrderSummary) => void }) { return <div className="table-card"><table><thead><tr><th>Pedido</th><th>Creado UTC</th><th>Tipo / canal</th><th>Estado</th><th>Productos / enviados</th><th>Mesas</th></tr></thead><tbody>{rows.map((order) => <tr key={order.orderId} className={onSelect ? 'clickable' : ''} role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} onKeyDown={onSelect?(event)=>activateRow(event,()=>onSelect(order)):undefined} onClick={() => onSelect?.(order)}><td><code>{shortId(order.orderId)}</code></td><td>{date(order.createdAt)}</td><td>{order.orderType} / {order.orderChannel}</td><td><Status value={order.status} /></td><td>{order.itemCount} / {order.sentItemCount}</td><td>{order.tableIds.map(shortId).join(', ') || '—'}</td></tr>)}</tbody></table>{rows.length === 0 && <Empty text="No hay pedidos para estos filtros." />}</div>; }
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div></div>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <article className={`metric ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong></article>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{statusLabel(value)}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function CenteredState({ text }: { text: string }) { return <div className="centered-state">{text}</div>; }
function shortId(value: string | null) { return value ? value.slice(0, 8) : 'Sin Edge'; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Nunca'; }
function money(amount: number, currency: string | null) { return currency ? new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount / 100) : `${amount} minor units`; }
function message(error: unknown) { return error instanceof CloudAdminClientError ? error.message : error instanceof Error ? error.message : 'Ocurrió un error inesperado.'; }
export function activateRow(event:KeyboardEvent,action:()=>void) { if(event.key==='Enter'||event.key===' '){event.preventDefault();action();} }
export function statusLabel(value:string) { return ({ACTIVE:'Activo',INACTIVE:'Inactivo',ONLINE:'En línea',OFFLINE:'Sin conexión',DEGRADED:'Degradado',OPEN:'Abierto',CLOSED:'Cerrado',CANCELLED:'Cancelado',PENDING:'Pendiente',READY:'Listo',NOT_READY:'No listo',REVOKED:'Revocado',REPLACED:'Reemplazado',EXPIRED:'Expirado',COMPLETE:'Completo',INCOMPLETE:'Incompleto',ISSUED:'Emitida',CONSUMED:'Consumida',PAST_DUE:'Pago vencido',GRACE_PERIOD:'Periodo de gracia',SUSPENDED:'Suspendida',TERMINATED:'Terminada'} as Record<string,string>)[value]??value; }
