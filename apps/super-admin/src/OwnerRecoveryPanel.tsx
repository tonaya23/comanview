import { useMemo, useState, type FormEvent } from 'react';
import {
  PersonnelRecoveryContextSchema,
  type PersonnelRecoveryContext,
} from '@comanview/contracts';
import { Dialog, InlineAlert, TechnicalDetails } from '@comanview/ui';
import { cloudGuidance } from './SensitiveActionDialog.js';

export function OwnerRecoveryPanel({
  locationName,
  tenantId,
  locationId,
  targetEdgeId,
  onClose,
  onSubmit,
}: {
  locationName: string;
  tenantId: string;
  locationId: string;
  targetEdgeId: string;
  onClose(): void;
  onSubmit(context: PersonnelRecoveryContext, reason: string): Promise<void>;
}) {
  const [text, setText] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const context = useMemo(() => {
    try {
      const parsed = PersonnelRecoveryContextSchema.parse(JSON.parse(text));
      return parsed.tenantId === tenantId &&
        parsed.locationId === locationId &&
        parsed.targetEdgeId === targetEdgeId
        ? parsed
        : null;
    } catch {
      return null;
    }
  }, [text, tenantId, locationId, targetEdgeId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!context || reason.trim().length < 3) {
      setError('Revisa el contexto de esta ubicación y el motivo (mínimo 3 caracteres).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(context, reason);
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
      title="Recuperar acceso del propietario contractual"
      description="Solo autoriza al propietario contractual registrado en Cloud; no crea un propietario distinto ni restaura el acceso del resto del personal. Uso único, vigencia máxima de 10 minutos y dispositivo exacto."
      cancelable={!busy}
      onClose={onClose}
      className="sensitive-action"
    >
      <p>
        <strong>{locationName}</strong>
      </p>
      <form onSubmit={(event) => void submit(event)} aria-describedby="owner-recovery-feedback">
        <fieldset disabled={busy}>
          <label>
            Contexto público de recuperación
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              required
              aria-describedby={text.trim() && !context ? 'owner-context-help owner-context-error' : 'owner-context-help'}
              aria-invalid={Boolean(text.trim()) && !context}
            />
          </label>
          <p id="owner-context-help">
            Pega el contexto emitido por la recuperación local para este dispositivo. No contiene
            PIN, credenciales, firmas ni claves. No construyas ni edites sus identificadores
            manualmente.
          </p>
          <label>
            Motivo
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={3}
              maxLength={500}
              aria-invalid={Boolean(reason) && reason.trim().length < 3}
              aria-describedby="owner-reason-help"
            />
          </label>
          <small id="owner-reason-help">Escribe un motivo de 3 a 500 caracteres.</small>
        </fieldset>
        {text.trim() && !context && (
          <InlineAlert id="owner-context-error" tone="warning">
            El contexto es inválido o no pertenece a esta ubicación y equipo de destino.
          </InlineAlert>
        )}
        {context && (
          <>
            <InlineAlert title="Resumen de autorización">
              {locationName} · Propietario contractual registrado en Cloud ·{' '}
              {context.sourceEdgeId === context.targetEdgeId
                ? 'Recuperación en el mismo equipo'
                : 'Recuperación tras cambio de equipo'}{' '}
              ·{' '}
              {context.pairingId
                ? 'Solicitud de dispositivo vinculada'
                : 'Dispositivo existente vinculado'}
              . El vencimiento exacto se muestra al emitir.
            </InlineAlert>
            <TechnicalDetails>
              {Object.entries(context).map(([label, value]) => (
                <p key={label}>
                  {label}: <code>{value ?? 'No aplica'}</code>
                </p>
              ))}
            </TechnicalDetails>
          </>
        )}
        <div id="owner-recovery-feedback">
          {error && (
            <InlineAlert urgent tone="error">
              {error}
            </InlineAlert>
          )}
        </div>
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !context || reason.trim().length < 3}>
            {busy ? 'Emitiendo…' : 'Autorizar al propietario contractual'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
