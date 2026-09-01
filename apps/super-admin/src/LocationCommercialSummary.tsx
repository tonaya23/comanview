import type { CapabilityCode, CloudPlan, LocationLicenseAssignment } from '@comanview/contracts';

const capabilityLabels: Record<CapabilityCode,string> = {
  CORE_POS:'POS', TABLE_SERVICE:'Servicio en mesa', KDS:'KDS', PRINTING:'Impresión',
  PUBLIC_STOREFRONT:'Menú público', INVENTORY:'Inventario', MULTI_LOCATION:'Multi-location',
};

export function LocationCommercialSummary({license,plan}:{license:LocationLicenseAssignment;plan:CloudPlan|null}) {
  return <section className="commercial-summary" aria-label="Resumen comercial y licencia efectiva">
    <header><div><span>Plan asignado</span><strong>{plan?.displayName??license.planCode}</strong><small>{license.planCode}{plan ? ` · Plan ${plan.active?'activo':'inactivo'}` : ''}</small></div>
      <div><span>Licencia autorizada por Cloud</span><strong className={`status status-${license.declaredState.toLowerCase()}`}>{licenseStateLabel(license.declaredState)}</strong><small>Revisión {license.revision}</small></div></header>
    <div className="commercial-block"><h4>Límites efectivos de dispositivos</h4><div className="device-limit-grid">
      {(['POS','WAITER','KDS'] as const).map((type)=><div key={type}><span>{type}</span><strong>{formatDeviceLimit(license.deviceLimits?.[type]??null)}</strong></div>)}
    </div></div>
    <div className="commercial-block"><h4>Capacidades efectivas</h4><ul className="effective-capabilities">
      {license.capabilities.length?license.capabilities.map((capability)=><li key={capability} title={capability}><span aria-hidden="true">✓</span>{capabilityLabels[capability]}</li>):<li>Sin capacidades incluidas</li>}
    </ul></div>
    <details><summary>Detalles técnicos</summary><dl><div><dt>Plan ID</dt><dd><code>{license.planId}</code></dd></div><div><dt>Capability IDs</dt><dd>{license.capabilities.join(', ')||'Ninguna'}</dd></div><div><dt>Revisión de configuración</dt><dd>{license.configurationRevision}</dd></div><div><dt>Actualizado</dt><dd>{new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(license.updatedAt))}</dd></div></dl></details>
  </section>;
}

export function formatDeviceLimit(value:number|null):string {
  if(value===null)return 'Ilimitado';
  if(value===0)return 'No incluido';
  return String(value);
}

function licenseStateLabel(value:LocationLicenseAssignment['declaredState']):string {
  return ({ACTIVE:'Activa',PAST_DUE:'Pago vencido',GRACE_PERIOD:'Periodo de gracia',SUSPENDED:'Suspendida',TERMINATED:'Terminada'})[value];
}
