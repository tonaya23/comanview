import { useState, type SelectHTMLAttributes } from 'react';
import { EdgeClientError } from '@comanview/client-sdk';
import {
  Button,
  Field as SharedField,
  Input,
  Select,
  PrerequisiteNotice,
  getUserGuidance,
  prerequisite,
  type TypedNavigationTarget,
} from '@comanview/ui';
export function SelectField({
  label,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <SharedField label={label}>
      <Select {...props} />
    </SharedField>
  );
}
export function roleLabel(role: string) {
  return (
    (
      {
        OWNER: 'Propietario',
        MANAGER: 'Gerente',
        CASHIER: 'Cajero',
        WAITER: 'Mesero',
        KITCHEN: 'Cocina',
      } as Record<string, string>
    )[role] ?? 'Rol personalizado'
  );
}
export function Field({
  label,
  value,
  set,
  inputMode,
}: {
  label: string;
  value: string;
  set(v: string): void;
  inputMode?: 'decimal' | 'numeric';
}) {
  const [validation, setValidation] = useState('');
  const pin = label === 'PIN nuevo';
  return (
    <SharedField label={label} {...(validation ? { error: validation } : {})}>
      <Input
        type={
          pin ? 'password' : label === 'Email' ? 'email' : label === 'Teléfono' ? 'tel' : 'text'
        }
        inputMode={pin ? 'numeric' : inputMode}
        minLength={pin ? 4 : undefined}
        maxLength={pin ? 12 : label === 'Nombre comercial' ? 160 : undefined}
        pattern={pin ? '[0-9]{4,12}' : undefined}
        required={
          pin ||
          [
            'Nombre comercial',
            'Nombre',
            'Nueva caja',
            'Nueva zona',
            'Mesa',
            'Nombre del impuesto',
            'Nombre del producto',
          ].includes(label)
        }
        autoComplete={pin ? 'new-password' : undefined}
        value={value}
        onInvalid={(event) => {
          event.preventDefault();
          setValidation(pin ? 'Usa entre 4 y 12 dígitos.' : 'Revisa este campo antes de guardar.');
        }}
        onChange={(e) => {
          set(e.target.value);
          setValidation('');
        }}
      />
    </SharedField>
  );
}
export function nullable(v: string) {
  return v.trim() || null;
}
export function cashRegisterCreationIssue(currency: string | null, name: string) {
  if (!currency) return 'Establece y guarda primero la moneda en Día y moneda para crear una caja.';
  if (!name.trim()) return 'Escribe un nombre para la caja.';
  return null;
}
export function CashRegisterCreateAction({
  busy,
  issue,
  currencyMissing = false,
  onNavigate,
}: {
  busy: boolean;
  issue: string | null;
  currencyMissing?: boolean;
  onNavigate?(target: TypedNavigationTarget): void;
}) {
  return (
    <>
      <Button
        disabled={busy || Boolean(issue)}
        aria-describedby={issue ? 'cash-register-create-issue' : undefined}
      >
        Crear como predeterminada
      </Button>
      {currencyMissing ? (
        <div id="cash-register-create-issue">
          <PrerequisiteNotice
            state={prerequisite({
              key: 'currency',
              label: 'Moneda',
              status: 'missing',
              guidance: getUserGuidance('CURRENCY_REQUIRED'),
              authority: { source: 'edge' },
            })}
            onAction={onNavigate}
          />
        </div>
      ) : issue ? (
        <small id="cash-register-create-issue" role="status">
          {issue}
        </small>
      ) : null}
    </>
  );
}
export function administrationErrorMessage(e: unknown) {
  if (e instanceof EdgeClientError && e.code === 'CURRENCY_REQUIRED')
    return 'Establece y guarda primero la moneda en Día y moneda para crear una caja.';
  return e instanceof Error ? e.message : 'Error de administración';
}
export function administrationErrorGuidance(e: unknown) {
  return e instanceof EdgeClientError ? getUserGuidance(e) : getUserGuidance('UNKNOWN_EDGE_ERROR');
}
function message(e: unknown) {
  return administrationErrorMessage(e);
}
export async function readLogo(file: File) {
  if (file.size > 1048576) throw new Error('El logo excede 1 MiB.');
  const data = await file.arrayBuffer(),
    url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((ok, fail) => {
      image.onload = () => ok();
      image.onerror = () => fail(new Error('Imagen inválida.'));
      image.src = url;
    });
    if (image.naturalWidth > 2048 || image.naturalHeight > 2048)
      throw new Error('El logo excede 2048 px.');
    let binary = '';
    for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
    return {
      base64: btoa(binary),
      mime: file.type as 'image/png' | 'image/jpeg',
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
