import { useId, useState, type FormEvent } from 'react';
import { CloudAdminClientError } from '@comanview/client-sdk';
import { Dialog, InlineAlert, TechnicalDetails, getUserGuidance } from '@comanview/ui';

export function cloudGuidance(error: unknown) {
  const code =
    error instanceof CloudAdminClientError
      ? error.status === 403
        ? 'PERMISSION_DENIED'
        : error.code
      : undefined;
  const guidance = getUserGuidance(
    code,
    error instanceof CloudAdminClientError && error.code === 'CLOUD_UNREACHABLE'
      ? {
          action: null,
          title: 'Sin conexión con Cloud',
          explanation:
            'Comprueba la conexión e inténtalo nuevamente. No des por confirmada la operación sin respuesta.',
        }
      : { action: null },
  );
  return `${guidance.title}. ${guidance.explanation}`;
}
export interface SensitiveValues {
  reason: string;
  backupId: string;
  percentages: number[];
  ownerConfigurable: boolean;
  allowFixedAmount: boolean;
}
export type SensitiveAction = {
  title: string;
  entity: string;
  details: Record<string, string>;
  impact: string;
  confirmLabel: string;
  onConfirm(values: SensitiveValues): Promise<void>;
} & (
  | { kind: 'reason' | 'recovery' | 'confirm' }
  | {
      kind: 'tips';
      initialPercentages: number[];
      initialDelegation: boolean;
      initialFixed: boolean;
    }
);
export function parseTipPercentages(value: string): number[] | null {
  if (!value.trim()) return [];
  const parts = value.split(',');
  if (parts.length > 12 || parts.some((part) => !/^\d+(\.\d{1,2})?$/.test(part.trim())))
    return null;
  const numbers = parts.map((part) => Number(part.trim()));
  return numbers.some((number) => number < 0 || number > 100) ? null : numbers;
}
export function SensitiveActionDialog({
  action,
  onClose,
}: {
  action: SensitiveAction;
  onClose(): void;
}) {
  const [reason, setReason] = useState(''),
    [backupId, setBackupId] = useState('');
  const [percentages, setPercentages] = useState(
    action.kind === 'tips' ? action.initialPercentages.map((value) => value / 100).join(',') : '',
  );
  const [delegation, setDelegation] = useState(action.kind === 'tips' && action.initialDelegation);
  const [fixed, setFixed] = useState(action.kind === 'tips' && action.initialFixed);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const parsed = parseTipPercentages(percentages);
  const [submitted, setSubmitted] = useState(false);
  const invalidReason = submitted && reason.trim().length < 3;
  const invalidBackup = submitted &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(backupId.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    if ((action.kind === 'reason' || action.kind === 'recovery') && reason.trim().length < 3)
      return setError('Indica el motivo de esta operación (mínimo 3 caracteres).');
    if (
      action.kind === 'recovery' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(backupId.trim())
    )
      return setError('Ingresa el identificador válido del respaldo verificado.');
    if (action.kind === 'tips' && parsed === null)
      return setError(
        'Usa hasta 12 porcentajes entre 0 y 100, separados por comas, con hasta dos decimales.',
      );
    setBusy(true);
    setError(null);
    try {
      await action.onConfirm({
        reason,
        backupId: backupId.trim(),
        percentages: parsed ?? [],
        ownerConfigurable: delegation,
        allowFixedAmount: fixed,
      });
      onClose();
    } catch (problem) {
      setError(cloudGuidance(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={action.title}
      description={action.impact}
      cancelable={!busy}
      onClose={onClose}
      className="sensitive-action"
    >
      <p>
        <strong>{action.entity}</strong>
      </p>
      <TechnicalDetails>
        {Object.entries(action.details).map(([label, value]) => (
          <p key={label}>
            {label}: <code>{value}</code>
          </p>
        ))}
      </TechnicalDetails>
      <form onSubmit={(event) => void submit(event)} aria-describedby={error ? errorId : undefined}>
        <fieldset disabled={busy}>
          {action.kind === 'tips' && (
            <>
              <label>
                Porcentajes permitidos (%)
                <input
                  value={percentages}
                  onChange={(event) => setPercentages(event.target.value)}
                  placeholder="10,15,20"
                  aria-describedby="tip-options-help"
                  aria-invalid={parsed === null}
                />
              </label>
              <p id="tip-options-help">
                Deja la lista vacía para desactivar las propinas. Límites: 0–100 %, hasta dos
                decimales.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={delegation}
                  onChange={(event) => setDelegation(event.target.checked)}
                />{' '}
                Permitir al propietario elegir preferencias dentro de estos límites
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={fixed}
                  onChange={(event) => setFixed(event.target.checked)}
                />{' '}
                Permitir importe fijo
              </label>
              <InlineAlert title="Resumen de política">
                {parsed === null
                  ? 'Revisa los porcentajes.'
                  : parsed.length
                    ? `Propinas activadas: ${parsed.join(' %, ')} %.`
                    : 'Propinas desactivadas.'}{' '}
                {delegation
                  ? 'Preferencias locales delegadas al propietario.'
                  : 'Configuración administrada centralmente.'}{' '}
                {fixed ? 'Importe fijo permitido.' : 'Sin importe fijo.'}
              </InlineAlert>
            </>
          )}
          {action.kind === 'recovery' && (
            <label>
              Identificador del respaldo verificado
              <input
                value={backupId}
                onChange={(event) => setBackupId(event.target.value)}
                autoComplete="off"
                aria-invalid={invalidBackup}
                aria-describedby={invalidBackup && error ? errorId : undefined}
              />
              <small>
                Identificador público del respaldo; nunca pegues una clave de recuperación.
              </small>
            </label>
          )}
          {(action.kind === 'reason' || action.kind === 'recovery') && (
            <label>
              Motivo
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                maxLength={500}
                aria-invalid={invalidReason}
                aria-describedby={invalidReason && error ? errorId : undefined}
              />
            </label>
          )}
        </fieldset>
        {error && (
          <InlineAlert id={errorId} urgent tone="error">
            {error}
          </InlineAlert>
        )}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Confirmando…' : action.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AuthorizationDelivery({
  title,
  document,
  expiresAt,
  onClose,
}: {
  title: string;
  document: string;
  expiresAt?: string | undefined;
  onClose(): void;
}) {
  return (
    <Dialog open title={title} onClose={onClose} className="sensitive-action">
      <InlineAlert tone="success" title="Autorización emitida">
        Documento temporal de un solo uso. Solo sirve para la instalación y destino autorizados.
      </InlineAlert>
      {expiresAt && (
        <p>Vence: {new Date(expiresAt).toLocaleString('es-MX')} (hora de este equipo).</p>
      )}
      <p>
        Transfiérelo únicamente al operador autorizado. El portapapeles puede compartirse con otras
        aplicaciones; reemplaza su contenido después de usarlo. No es un PIN ni una clave de
        recuperación.
      </p>
      <SafeCopyControl value={document} label="Copiar autorización" />
      <button onClick={onClose}>Cerrar y dejar de mostrar esta entrega</button>
    </Dialog>
  );
}

export function SafeCopyControl({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(false);
    } catch {
      setCopied(false);
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {error && (
        <InlineAlert tone="error" urgent>
          No se pudo copiar. Revisa el permiso del portapapeles y vuelve a intentar; la entrega
          sigue disponible aquí.
        </InlineAlert>
      )}
      {copied && <InlineAlert tone="success">Copiado al portapapeles.</InlineAlert>}
      <button disabled={busy} onClick={() => void copy()}>
        {busy ? 'Copiando…' : label}
      </button>
    </div>
  );
}
