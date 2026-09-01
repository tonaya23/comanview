import { useMemo, useState, type FormEvent } from 'react';
import { parsePairingAuthorizationData } from '@comanview/client-sdk';
import type { InstallationAuthorizationStatus, PairingAuthorizationData } from '@comanview/contracts';

export interface InstallationAuthorizationPanelProps {
  locationName: string;
  status: InstallationAuthorizationStatus | null;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(pairing: PairingAuthorizationData, ownerDisplayName: string): void;
}

export function InstallationAuthorizationPanel(props: InstallationAuthorizationPanelProps) {
  const [transfer, setTransfer] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [validationError, setValidationError] = useState<string|null>(null);
  const pairing = useMemo(() => {
    if (!transfer.trim()) return null;
    try { return parsePairingAuthorizationData(transfer); } catch { return null; }
  }, [transfer]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pairing) { setValidationError('Los datos del dispositivo no son válidos o están incompletos.'); return; }
    if (!ownerName.trim()) { setValidationError('Ingresa el nombre del OWNER inicial.'); return; }
    setValidationError(null); props.onSubmit(pairing, ownerName.trim());
  };
  return <div className="admin-modal-backdrop"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="installation-auth-title">
    <header><div><span className="eyebrow">Preparación de instalación</span><h2 id="installation-auth-title">Autorizar instalación inicial</h2>
      <p>{props.locationName} · La autorización quedará ligada exactamente a esta solicitud y dispositivo.</p></div>
      <button type="button" className="modal-close" aria-label="Cerrar autorización" disabled={props.busy} onClick={props.onClose}>×</button></header>
    {props.status ? <div className="authorization-current"><span>Última autorización</span><Status value={props.status.status}/><small>Expira {formatDate(props.status.expiresAt)}</small></div> : null}
    <form onSubmit={submit} className="installation-form">
      <label>Datos para autorizar este dispositivo
        <textarea value={transfer} autoFocus onChange={(event)=>{setTransfer(event.target.value);setValidationError(null);}}
          placeholder="Pega el bloque copiado desde el POS" aria-describedby="pairing-data-help" disabled={props.busy}/>
        <small id="pairing-data-help">El bloque contiene identificadores públicos del pairing; no contiene credential, request token ni PIN.</small>
      </label>
      {pairing ? <div className="binding-preview" aria-label="Datos validados del dispositivo">
        <div><span>Dispositivo</span><strong>{pairing.displayName}</strong></div><div><span>Tipo</span><strong>{pairing.deviceType}</strong></div>
        <details><summary>Detalles técnicos</summary><code>Solicitud …{pairing.pairingId.slice(-8)}</code><code>Dispositivo …{pairing.deviceId.slice(-8)}</code></details>
      </div> : transfer.trim() ? <div className="inline-form-warning">El bloque aún no tiene un formato válido.</div> : null}
      <label>Nombre del OWNER inicial
        <input value={ownerName} onChange={(event)=>{setOwnerName(event.target.value);setValidationError(null);}} maxLength={120}
          placeholder="Ej. Responsable del local" disabled={props.busy}/>
      </label>
      <div className="form-feedback" aria-live="polite">{validationError??props.error??'\u00a0'}</div>
      <div className="form-actions"><button type="button" className="secondary" disabled={props.busy} onClick={props.onClose}>Cancelar</button>
        <button type="submit" className="primary" disabled={props.busy||!pairing||!ownerName.trim()}>{props.busy?'Emitiendo…':'Emitir autorización firmada'}</button></div>
    </form>
  </section></div>;
}

function Status({value}:{value:string}) { return <span className={`status status-${value.toLowerCase()}`}>{value}</span>; }
function formatDate(value:string) { return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value))+' UTC'; }
