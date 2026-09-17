import { useRef, useState } from 'react';
import { Button, Dialog, Field, Input, Select, ConfirmationDialog } from '@comanview/ui';

export const STATION_FUNCTIONS = [
  { value: 'KITCHEN', label: 'Cocina', help: 'Preparación de alimentos.' },
  { value: 'BAR', label: 'Barra', help: 'Preparación de bebidas.' },
  { value: 'DESSERTS', label: 'Postres', help: 'Preparación de postres.' },
] as const;
export function stationFunctionLabel(value: string | null) {
  return (
    STATION_FUNCTIONS.find((item) => item.value === value)?.label ??
    (value || 'Sin función asignada')
  );
}
export function StationFunctionField({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  const known = STATION_FUNCTIONS.some((item) => item.value === value);
  const [custom, setCustom] = useState(!known && Boolean(value));
  return (
    <>
      <Field
        label="Función de estación"
        helper="Describe qué prepara esta estación. Puedes conservar una función personalizada."
      >
        <Select
          value={custom ? 'custom' : value}
          onChange={(event) => {
            const next = event.target.value;
            setCustom(next === 'custom');
            if (next !== 'custom') onChange(next);
            else if (known) onChange('');
          }}
        >
          <option value="">Sin función asignada</option>
          {STATION_FUNCTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label} — {item.help}
            </option>
          ))}
          <option value="custom">Personalizado</option>
        </Select>
      </Field>
      {custom && (
        <Field
          label="Función personalizada"
          helper="Se conserva el valor existente. Máximo 100 caracteres."
        >
          <Input maxLength={100} value={value} onChange={(event) => onChange(event.target.value)} />
        </Field>
      )}
    </>
  );
}
export type EditRequest = {
  label: string;
  initial: string;
  entityId?: string;
  resolve(value: string | null): void;
};
const roles = [
  ['OWNER', 'Propietario'],
  ['MANAGER', 'Gerente'],
  ['CASHIER', 'Cajero'],
  ['WAITER', 'Mesero'],
  ['KITCHEN', 'Cocina'],
] as const;
export function AdministrationEditDialog({
  request,
  onFinish,
}: {
  request: EditRequest;
  onFinish(value: string | null): void;
}) {
  const [value, setValue] = useState(request.initial),
    [error, setError] = useState('');
  const purpose = request.label === 'Función de estación',
    role = request.label === 'Roles',
    numeric = /Orden|Capacidad|porcentaje/.test(request.label);
  function submit() {
    if (!purpose && !value.trim()) {
      setError('Completa este campo.');
      return;
    }
    if (
      numeric &&
      !(request.label.includes('Orden')
        ? /^-?\d+$/.test(value)
        : request.label.includes('Capacidad')
          ? /^\d+$/.test(value)
          : /^\d+(?:[.,]\d{1,2})?$/.test(value))
    ) {
      setError('Introduce un número válido.');
      return;
    }
    if (request.label.startsWith('Capacidad') && Number(value) <= 0) {
      setError('La capacidad debe ser mayor que cero.');
      return;
    }
    onFinish(value.trim());
  }
  return (
    <Dialog
      open
      title={request.label}
      className="administration-editor"
      description="El cambio se validará antes de guardarse."
      onClose={() => onFinish(null)}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {purpose ? (
          <StationFunctionField value={value} onChange={setValue} />
        ) : role ? (
          <fieldset>
            <legend>Funciones autorizadas</legend>
            {roles.map(([code, label]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  checked={value
                    .split(',')
                    .map((v) => v.trim())
                    .includes(code)}
                  onChange={(event) => {
                    const selected = value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean);
                    setValue(
                      (event.target.checked
                        ? [...selected, code]
                        : selected.filter((v) => v !== code)
                      ).join(', '),
                    );
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        ) : (
          <Field label={request.label} {...(error ? { error } : {})}>
            <Input
              autoFocus
              value={value}
              maxLength={request.label.startsWith('Nombre') ? 100 : 200}
              inputMode={numeric ? 'decimal' : 'text'}
              onChange={(event) => {
                setValue(event.target.value);
                setError('');
              }}
            />
          </Field>
        )}
        {role && error ? <p role="alert">{error}</p> : null}
        <div className="cv-dialog__actions">
          <Button type="button" variant="secondary" onClick={() => onFinish(null)}>
            Cancelar
          </Button>
          <Button type="submit">Guardar cambio</Button>
        </div>
      </form>
    </Dialog>
  );
}
export function useAdministrationDialogs() {
  const submitted = useRef(false);
  const [edit, setEdit] = useState<EditRequest | null>(null),
    [confirmation, setConfirmation] = useState<{
      description: string;
      resolve(value: boolean): void;
    } | null>(null);
  const [lastEdit, setLastEdit] = useState<{
    label: string;
    initial: string;
    entityId: string;
    value: string;
  } | null>(null);
  const ask = async (label: string, initial: string, entityId: string) => {
    if (lastEdit && (lastEdit.label !== label || lastEdit.entityId !== entityId)) {
      const discard = await new Promise<boolean>((resolve) =>
        setConfirmation({
          description: 'Hay una edición sin guardar. ¿Descartarla para editar otro valor?',
          resolve,
        }),
      );
      if (!discard) return null;
      setLastEdit(null);
    }
    return new Promise<string | null>((resolve) =>
      setEdit({
        label,
        entityId,
        initial:
          lastEdit?.label === label && lastEdit.entityId === entityId ? lastEdit.value : initial,
        resolve,
      }),
    );
  };
  const confirm = (description: string) =>
    new Promise<boolean>((resolve) => setConfirmation({ description, resolve }));
  const dialogs = (
    <>
      {edit && (
        <AdministrationEditDialog
          key={edit.label + edit.initial}
          request={edit}
          onFinish={(value) => {
            submitted.current = value !== null;
            if (value !== null)
              setLastEdit({
                label: edit.label,
                initial: edit.initial,
                entityId: edit.entityId ?? '',
                value,
              });
            setEdit(null);
            edit.resolve(value);
          }}
        />
      )}
      {confirmation && (
        <ConfirmationDialog
          open
          title="Confirma antes de continuar"
          description={confirmation.description}
          confirmLabel="Continuar"
          onConfirm={() => {
            setConfirmation(null);
            confirmation.resolve(true);
          }}
          onClose={() => {
            setConfirmation(null);
            confirmation.resolve(false);
          }}
        />
      )}
    </>
  );
  return {
    ask,
    confirm,
    dialogs,
    dialogOpen: Boolean(edit || confirmation),
    lastEdit,
    clearEdit: () => setLastEdit(null),
    takeEditSubmission: () => {
      const value = submitted.current;
      submitted.current = false;
      return value;
    },
  };
}
