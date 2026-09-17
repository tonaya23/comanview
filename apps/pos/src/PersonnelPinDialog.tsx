import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input } from '@comanview/ui';

export const validPersonnelPin = (value: string) => /^\d{4,12}$/.test(value);
export function PersonnelPinDialog({
  requireCurrent,
  onSubmit,
  onCancel,
}: {
  requireCurrent: boolean;
  onSubmit(values: { newPin: string; oldPin?: string }): void;
  onCancel(): void;
}) {
  const [newPin, setNewPin] = useState(''),
    [oldPin, setOldPin] = useState('');
  function cancel() {
    setNewPin('');
    setOldPin('');
    onCancel();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!validPersonnelPin(newPin) || (requireCurrent && !validPersonnelPin(oldPin))) return;
    const values = { newPin, ...(requireCurrent ? { oldPin } : {}) };
    setNewPin('');
    setOldPin('');
    onSubmit(values);
  }
  return (
    <Dialog
      open
      title="Actualizar PIN"
      description="Usa entre 4 y 12 dígitos. Las sesiones anteriores se invalidarán según la operación autorizada."
      onClose={cancel}
    >
      <form onSubmit={submit}>
        {requireCurrent && (
          <Field label="PIN actual" required>
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              minLength={4}
              maxLength={12}
              pattern="[0-9]{4,12}"
              value={oldPin}
              onChange={(event) => setOldPin(event.target.value)}
            />
          </Field>
        )}
        <Field label="PIN nuevo" required helper="El PIN no se muestra después de guardarlo.">
          <Input
            autoFocus={!requireCurrent}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            minLength={4}
            maxLength={12}
            pattern="[0-9]{4,12}"
            value={newPin}
            onChange={(event) => setNewPin(event.target.value)}
          />
        </Field>
        <div className="cv-dialog__actions">
          <Button type="button" variant="secondary" onClick={cancel}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={!validPersonnelPin(newPin) || (requireCurrent && !validPersonnelPin(oldPin))}
          >
            Guardar PIN
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
