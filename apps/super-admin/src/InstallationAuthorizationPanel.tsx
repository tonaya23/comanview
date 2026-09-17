import { useMemo, useState, type FormEvent } from 'react';
import { Dialog, InlineAlert, TechnicalDetails } from '@comanview/ui';
import { parsePairingAuthorizationData } from '@comanview/client-sdk';
import type {
  InstallationAuthorizationStatus,
  PairingAuthorizationData,
} from '@comanview/contracts';

export interface InstallationAuthorizationPanelProps {
  locationName: string;
  binding?: { tenantId: string; locationId: string; edgeId: string | null } | undefined;
  status: InstallationAuthorizationStatus | null;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(pairing: PairingAuthorizationData, ownerDisplayName: string): void;
}

export function InstallationAuthorizationPanel(props: InstallationAuthorizationPanelProps) {
  const [transfer, setTransfer] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const pairing = useMemo(() => {
    if (!transfer.trim()) return null;
    try {
      return parsePairingAuthorizationData(transfer);
    } catch {
      return null;
    }
  }, [transfer]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pairing) {
      setValidationError('Los datos del dispositivo no son válidos o están incompletos.');
      return;
    }
    if (!ownerName.trim()) {
      setValidationError('Ingresa el nombre del propietario inicial.');
      return;
    }
    setValidationError(null);
    props.onSubmit(pairing, ownerName.trim());
  };
  return (
    <Dialog
      open
      title="Autorizar instalación inicial"
      description="Autoriza el primer dispositivo y el propietario inicial de esta ubicación. Temporal, de un solo uso; no recupera un propietario existente."
      className="sensitive-action"
      cancelable={!props.busy}
      onClose={props.onClose}
    >
      <header>
        <div>
          <span className="eyebrow">Preparación de instalación</span>
          <p>
            {props.locationName} · La autorización quedará ligada exactamente a esta solicitud y
            dispositivo.
          </p>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label="Cerrar autorización"
          disabled={props.busy}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      {props.binding && (
        <TechnicalDetails>
          <p>
            Organización: <code>{props.binding.tenantId}</code>
          </p>
          <p>
            Ubicación: <code>{props.binding.locationId}</code>
          </p>
          <p>
            Equipo activo consultado: <code>{props.binding.edgeId ?? 'No disponible'}</code>
          </p>
        </TechnicalDetails>
      )}
      {props.status ? (
        <div className="authorization-current">
          <span>Última autorización</span>
          <Status value={props.status.status} />
          <small>Expira {formatDate(props.status.expiresAt)}</small>
        </div>
      ) : null}
      <form
        onSubmit={submit}
        className="installation-form"
        aria-describedby="installation-feedback"
      >
        <label>
          Datos para autorizar este dispositivo
          <textarea
            value={transfer}
            autoFocus
            onChange={(event) => {
              setTransfer(event.target.value);
              setValidationError(null);
            }}
            placeholder="Pega el bloque copiado desde el POS"
            aria-describedby={transfer.trim() && !pairing ? 'pairing-data-help pairing-data-error' : 'pairing-data-help'}
            aria-invalid={Boolean(transfer.trim()) && !pairing}
            disabled={props.busy}
          />
        </label>
        <small id="pairing-data-help">
          El bloque contiene identificadores públicos de la solicitud; no contiene credenciales,
          tokens ni PIN.
        </small>
        {pairing ? (
          <div className="binding-preview" aria-label="Datos validados del dispositivo">
            <div>
              <span>Dispositivo</span>
              <strong>{pairing.displayName}</strong>
            </div>
            <div>
              <span>Tipo</span>
              <strong>{pairing.deviceType}</strong>
            </div>
            <TechnicalDetails>
              <p>
                Solicitud: <code>{pairing.pairingId}</code>
              </p>
              <p>
                Dispositivo: <code>{pairing.deviceId}</code>
              </p>
            </TechnicalDetails>
          </div>
        ) : transfer.trim() ? (
          <div id="pairing-data-error" className="inline-form-warning" role="status">El bloque aún no tiene un formato válido.</div>
        ) : null}
        <label>
          Nombre del propietario inicial
          <input
            value={ownerName}
            onChange={(event) => {
              setOwnerName(event.target.value);
              setValidationError(null);
            }}
            maxLength={120}
            placeholder="Ej. Responsable del local"
            disabled={props.busy}
          />
        </label>
        <div className="form-feedback" id="installation-feedback" aria-live="polite">
          {validationError ?? props.error ?? '\u00a0'}
        </div>
        {pairing && ownerName.trim() && (
          <InlineAlert title="Resumen antes de autorizar">
            {props.locationName} · {pairing.displayName} · Propietario: {ownerName.trim()}. La
            vigencia la determina el servidor; el vencimiento exacto se muestra después de emitir.
          </InlineAlert>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" disabled={props.busy} onClick={props.onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="primary"
            disabled={props.busy || !pairing || !ownerName.trim()}
          >
            {props.busy ? 'Emitiendo…' : 'Emitir autorización firmada'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {(
        {
          ISSUED: 'Emitida',
          CONSUMED: 'Utilizada',
          EXPIRED: 'Vencida',
          REVOKED: 'Revocada',
        } as Record<string, string>
      )[value] ?? 'No disponible'}
    </span>
  );
}
function formatDate(value: string) {
  return (
    new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value)) + ' UTC'
  );
}
