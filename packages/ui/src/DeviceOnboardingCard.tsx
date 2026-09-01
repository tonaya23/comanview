export type DeviceOnboardingState = 'ACTIVE' | 'UNREGISTERED' | 'PENDING' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';

export interface DeviceOnboardingCardProps {
  productLabel:string;
  state:DeviceOnboardingState;
  displayName:string;
  pairingCode?:string|undefined;
  pairingId?:string|undefined;
  expiresAt?:string|undefined;
  pending:boolean;
  onDisplayName(value:string):void;
  onPair():void;
  onRetry():void;
}

export function DeviceOnboardingCard(props:DeviceOnboardingCardProps) {
  if(props.state==='ACTIVE')return <div className="device-onboarding-authorized" role="status">
    <span aria-hidden="true">✓</span><div><strong>{props.displayName}</strong><small>Dispositivo autorizado · inicia sesión con tu PIN.</small></div>
  </div>;
  const terminal=props.state==='EXPIRED'||props.state==='CANCELLED';
  return <section className={`device-onboarding-card device-onboarding-card--${props.state.toLowerCase()}`} aria-labelledby="device-onboarding-title">
    <header><div><strong id="device-onboarding-title">Este dispositivo</strong><small>{props.productLabel} necesita una identidad local autorizada.</small></div>
      <span className="device-onboarding-badge">{label(props.state)}</span></header>
    {props.state==='PENDING'?<>
      <div className="device-onboarding-code"><span>Código temporal</span><strong>{props.pairingCode}</strong>
        {props.expiresAt?<small>Válido hasta {new Date(props.expiresAt).toLocaleTimeString()}</small>:null}</div>
      <details><summary>Detalles técnicos</summary><code>{props.pairingId}</code></details>
      <p>Solicita al OWNER que apruebe esta solicitud desde Administración Local.</p>
    </>:terminal?<>
      <p>La solicitud está {props.state==='EXPIRED'?'expirada':'cancelada'} y ya no puede utilizarse.</p>
      <button type="button" className="device-onboarding-primary" onClick={props.onRetry}>Solicitar código nuevo</button>
    </>:<>
      {props.state==='REVOKED'?<p className="device-onboarding-warning">Este Device fue revocado. El nuevo emparejamiento creará una identidad distinta.</p>:null}
      <label>Nombre del dispositivo<input value={props.displayName} maxLength={120} autoComplete="off"
        onChange={event=>props.onDisplayName(event.target.value)} placeholder={`Ej. ${props.productLabel} principal`}/></label>
      <button type="button" className="device-onboarding-primary" disabled={props.pending||!props.displayName.trim()} onClick={props.onPair}>
        {props.pending?'Creando solicitud…':props.state==='REVOKED'?'Emparejar nuevamente':'Emparejar dispositivo'}
      </button>
    </>}
  </section>;
}

function label(state:DeviceOnboardingState) {
  return ({ACTIVE:'Activo',UNREGISTERED:'Sin autorizar',PENDING:'Pendiente',EXPIRED:'Expirado',CANCELLED:'Cancelado',REVOKED:'Revocado'} as const)[state];
}
