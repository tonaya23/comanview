// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CloudAdminClientError } from '@comanview/client-sdk';
import { CloudPermissionSchema, type LocationLicenseAssignment } from '@comanview/contracts';
import { ControlPlane } from './App.js';
import {
  AuthorizationDelivery,
  SensitiveActionDialog,
  parseTipPercentages,
  cloudGuidance,
  type SensitiveAction,
} from './SensitiveActionDialog.js';
import { OwnerRecoveryPanel } from './OwnerRecoveryPanel.js';
import { InstallationAuthorizationPanel } from './InstallationAuthorizationPanel.js';

const api = vi.hoisted(() => ({
  getTenants: vi.fn(),
  getPlans: vi.fn(),
  getCanonicalLocations: vi.fn(),
  getEdges: vi.fn(),
  getPendingReplacement: vi.fn(),
  getLocationLicense: vi.fn(),
  getLatestInstallationAuthorization: vi.fn(),
  updateLocationConfiguration: vi.fn(),
  updateLocationLicenseState: vi.fn(),
  revokeEdge: vi.fn(),
  initiateReplacement: vi.fn(),
  cancelReplacement: vi.fn(),
  revokeProvisioningCode: vi.fn(),
  issueRecoveryAuthorization: vi.fn(),
  issueOwnerRecoveryAuthorization: vi.fn(),
  issueInstallationAuthorization: vi.fn(),
}));
vi.mock('@comanview/client-sdk', async (original) => ({
  ...(await original<typeof import('@comanview/client-sdk')>()),
  createCloudAdminClient: () => api,
}));
const id = '11111111-1111-4111-8111-111111111111',
  source = '22222222-2222-4222-8222-222222222222',
  backup = '33333333-3333-4333-8333-333333333333';
const expiry = '2026-09-13T12:30:00.000Z';
const authorization = {
  protected: 'fixture-only-header',
  payload: 'fixture-only-payload',
  signature: 'fixture-only-signature',
};
const context = {
  tenantId: id,
  locationId: id,
  sourceEdgeId: source,
  targetEdgeId: id,
  recoveryId: id,
  backupId: backup,
  recoveryEpoch: 2,
  restoreAuthorizationId: id,
  trustDomainId: id,
  accessGeneration: 1,
  challengeId: id,
  deviceId: id,
  pairingId: null,
};
const pairing = {
  schemaVersion: 1,
  pairingId: id,
  pairingCode: '123456',
  deviceId: id,
  deviceType: 'POS',
  displayName: 'Caja Centro',
};
const license: LocationLicenseAssignment = {
  tenantId: id,
  locationId: id,
  planId: id,
  planCode: 'PRO',
  declaredState: 'ACTIVE',
  revision: 4,
  capabilities: ['CORE_POS'],
  deviceLimits: { POS: 2, WAITER: 2, KDS: 1 },
  configuration: {
    payment: { tipsEnabled: true, tipPercentageOptionsBasisPoints: [1000] },
    tipPolicy: {
      ownerConfigurable: true,
      allowPercentages: true,
      allowedPercentagesBasisPoints: [1000],
      allowFixedAmount: false,
    },
  },
  configurationRevision: 3,
  updatedAt: expiry,
};
beforeEach(() => {
  vi.resetAllMocks();
  api.getTenants.mockResolvedValue({
    data: [{ tenantId: id, displayName: 'Restaurante de prueba', status: 'ACTIVE' }],
  });
  api.getPlans.mockResolvedValue({ data: [] });
  api.getCanonicalLocations.mockResolvedValue({
    data: [
      {
        tenantId: id,
        locationId: id,
        displayName: 'Sucursal Centro',
        timezone: 'America/Matamoros',
        configurationStatus: 'CONFIGURED',
      },
    ],
  });
  api.getEdges.mockResolvedValue({
    data: [
      { edgeId: id, status: 'ACTIVE' },
      { edgeId: source, status: 'REPLACED' },
    ],
  });
  api.getPendingReplacement.mockResolvedValue({ replacement: null });
  api.getLocationLicense.mockResolvedValue(license);
  api.getLatestInstallationAuthorization.mockResolvedValue({ authorization: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function control(permissions: readonly string[] = CloudPermissionSchema.options) {
  render(<ControlPlane onError={vi.fn()} permissions={permissions} />);
  await userEvent.click(await screen.findByRole('button', { name: /Restaurante de prueba/ }));
  await userEvent.click(await screen.findByRole('button', { name: /Sucursal Centro/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Licencia' }));
  await screen.findByRole('button', { name: 'Configurar propinas' });
}
const base: SensitiveAction = {
  kind: 'reason',
  title: 'Revocar equipo',
  entity: 'Sucursal Centro',
  details: { Equipo: id },
  impact: 'Revoca el equipo activo. No es una pausa reversible.',
  confirmLabel: 'Confirmar revocación',
  onConfirm: async () => {},
};
function Harness({ action }: { action: SensitiveAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir operación</button>
      {open && <SensitiveActionDialog action={action} onClose={() => setOpen(false)} />}
    </>
  );
}

describe('Sensitive action pattern', () => {
  it('cancels safely with Escape and restores focus without issuing a command', async () => {
    const submit = vi.fn();
    render(<Harness action={{ ...base, onConfirm: submit }} />);
    const open = screen.getByRole('button', { name: 'Abrir operación' });
    await userEvent.click(open);
    expect(screen.getByRole('dialog', { name: 'Revocar equipo' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(submit).not.toHaveBeenCalled();
  });
  it('validates, locks during saving, blocks Escape and keeps backend rejection local', async () => {
    let reject: (e: Error) => void = () => {};
    const submit = vi.fn(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    );
    render(<Harness action={{ ...base, onConfirm: submit }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir operación' }));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'a' } });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar revocación' }));
    expect(submit).not.toHaveBeenCalled();
    await screen.findByText(/mínimo 3/);
    expect(screen.getByLabelText('Motivo').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(screen.getByLabelText('Motivo').getAttribute('aria-describedby')!)?.textContent).toContain('mínimo 3');
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Equipo retirado' } });
    expect(screen.getByLabelText('Motivo').getAttribute('aria-invalid')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar revocación' }));
    expect(screen.getByRole('button', { name: 'Cancelar' }).matches(':disabled')).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () =>
      reject(new CloudAdminClientError('raw-private', 'UNKNOWN_CLOUD_ERROR', 403)),
    );
    await screen.findByText(/No tienes permiso/);
    expect(screen.queryByText('raw-private')).toBeNull();
    expect((screen.getByLabelText('Motivo') as HTMLTextAreaElement).value).toBe('Equipo retirado');
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('validates tip precision, empty disable, bounds and the existing limit of 12 options', () => {
    expect(parseTipPercentages('10, 15.5')).toEqual([10, 15.5]);
    expect(parseTipPercentages('')).toEqual([]);
    for (const input of ['NaN', '10,,20', '-1', '101', '0.001', Array(13).fill('10').join(',')])
      expect(parseTipPercentages(input)).toBeNull();
  });
  it('maps actual HTTP403 fallback and Cloud connection failure without exposing internals', () => {
    expect(
      cloudGuidance(new CloudAdminClientError('private', 'UNKNOWN_CLOUD_ERROR', 403)),
    ).toContain('permiso');
    expect(
      cloudGuidance(new CloudAdminClientError('private', 'CLOUD_UNREACHABLE', null)),
    ).toContain('Sin conexión con Cloud');
  });
});
describe('Critical flow command preservation', () => {
  it('confirms license state changes without changing the existing payload or applying on cancel', async () => {
    await control();
    await userEvent.selectOptions(screen.getByLabelText('Estado de licencia'), 'SUSPENDED');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.updateLocationLicenseState).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('Estado de licencia'), 'SUSPENDED');
    api.updateLocationLicenseState.mockResolvedValue(license);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cambio de estado' }));
    expect(api.updateLocationLicenseState).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      expectedRevision: 4,
      declaredState: 'SUSPENDED',
      reason: 'License state changed from Super Admin',
    });
  });
  it('preserves the original empty-percentage-list disable semantics', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Configurar propinas' }));
    fireEvent.change(screen.getByLabelText('Porcentajes permitidos (%)'), {
      target: { value: '' },
    });
    api.updateLocationConfiguration.mockResolvedValue(license);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar política' }));
    expect(api.updateLocationConfiguration).toHaveBeenCalledWith(id, {
      commandId: expect.any(String),
      expectedRevision: 3,
      configuration: {
        payment: { tipsEnabled: false, tipPercentageOptionsBasisPoints: [] },
        tipPolicy: {
          ownerConfigurable: true,
          allowPercentages: false,
          allowedPercentagesBasisPoints: [],
          allowFixedAmount: false,
        },
      },
      reason: 'Payment tip configuration changed from Super Admin',
    });
  });

  it('cancels tip editing and sends the exact previous configuration payload on confirmation', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Configurar propinas' }));
    fireEvent.change(screen.getByLabelText('Porcentajes permitidos (%)'), {
      target: { value: '10,15.5' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.updateLocationConfiguration).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Configurar propinas' }));
    fireEvent.change(screen.getByLabelText('Porcentajes permitidos (%)'), {
      target: { value: '10,15.5' },
    });
    await userEvent.click(screen.getByLabelText('Permitir importe fijo'));
    api.updateLocationConfiguration.mockResolvedValue(license);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar política' }));
    await waitFor(() =>
      expect(api.updateLocationConfiguration).toHaveBeenCalledExactlyOnceWith(id, {
        commandId: expect.any(String),
        expectedRevision: 3,
        configuration: {
          payment: { tipsEnabled: true, tipPercentageOptionsBasisPoints: [1000, 1550] },
          tipPolicy: {
            ownerConfigurable: true,
            allowPercentages: true,
            allowedPercentagesBasisPoints: [1000, 1550],
            allowFixedAmount: true,
          },
        },
        reason: 'Payment tip configuration changed from Super Admin',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('blocks invalid tips without a request and preserves edits after backend denial', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Configurar propinas' }));
    fireEvent.change(screen.getByLabelText('Porcentajes permitidos (%)'), {
      target: { value: '200' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar política' }));
    expect(api.updateLocationConfiguration).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Porcentajes permitidos (%)'), {
      target: { value: '15' },
    });
    api.updateLocationConfiguration.mockRejectedValue(
      new CloudAdminClientError('secret', 'UNKNOWN_CLOUD_ERROR', 403),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar política' }));
    await screen.findByText(/No tienes permiso/);
    expect((screen.getByLabelText('Porcentajes permitidos (%)') as HTMLInputElement).value).toBe(
      '15',
    );
  });
  it('revokes the exact active Edge with its reason after impact confirmation', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Equipo / Edge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revocar Edge' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sucursal Centro')).toBeTruthy();
    expect(within(dialog).getAllByText(id)).toHaveLength(2);
    expect(within(dialog).getByText(/pausa reversible/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Equipo retirado' } });
    api.revokeEdge.mockResolvedValue({});
    await userEvent.click(screen.getByRole('button', { name: 'Revocar equipo' }));
    expect(api.revokeEdge).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      reason: 'Equipo retirado',
    });
  });
  it('preserves replacement source binding and never initiates on cancellation', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Equipo / Edge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reemplazar Edge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.initiateReplacement).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reemplazar Edge' }));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Nuevo hardware' } });
    api.initiateReplacement.mockResolvedValue({
      replacementId: backup,
      provisioningCode: {
        provisioningCodeId: backup,
        code: 'fixture-only-code',
        expiresAt: expiry,
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Preparar reemplazo' }));
    expect(api.initiateReplacement).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      oldEdgeId: id,
      reason: 'Nuevo hardware',
    });
    expect(screen.queryByText('fixture-only-code')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Revocar código' }));
    api.revokeProvisioningCode.mockResolvedValue({});
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Revocar código de alta' })).getByRole('button', {
        name: 'Revocar código',
      }),
    );
    expect(api.revokeProvisioningCode).toHaveBeenCalledExactlyOnceWith(backup, expect.any(String));
  });
  it('cancels the exact pending replacement, preserving its command', async () => {
    api.getPendingReplacement.mockResolvedValue({
      replacement: {
        replacementId: backup,
        oldEdgeId: id,
        newEdgeId: null,
        status: 'PENDING',
        provisioningCode: { status: 'ISSUED', expiresAt: expiry },
      },
    });
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Equipo / Edge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reemplazo' }));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Cambio pospuesto' } });
    api.cancelReplacement.mockResolvedValue({});
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    expect(api.cancelReplacement).toHaveBeenCalledExactlyOnceWith(backup, {
      commandId: expect.any(String),
      reason: 'Cambio pospuesto',
    });
  });
  it('authorizes the same hardware source, target, backup and reason without rendering signed content', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Instalación / Recuperación' }));
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar recuperación' }));
    fireEvent.change(screen.getByLabelText(/Identificador del respaldo verificado/), {
      target: { value: backup },
    });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Equipo sustituido' } });
    api.issueRecoveryAuthorization.mockResolvedValue({ authorization, expiresAt: expiry });
    await userEvent.click(screen.getByRole('button', { name: 'Emitir autorización' }));
    await screen.findByRole('button', { name: 'Copiar autorización' });
    expect(api.issueRecoveryAuthorization).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      sourceEdgeId: source,
      targetEdgeId: id,
      backupId: backup,
      reason: 'Equipo sustituido',
    });
    expect(document.body.innerHTML).not.toContain('fixture-only');
    expect(screen.getByText(/Vence:/)).toBeTruthy();
  });
  it('sends the unchanged initial owner and pairing payload', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Instalación / Recuperación' }));
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar instalación inicial' }));
    fireEvent.change(screen.getByLabelText('Datos para autorizar este dispositivo'), {
      target: { value: JSON.stringify(pairing) },
    });
    fireEvent.change(screen.getByLabelText('Nombre del propietario inicial'), {
      target: { value: 'Responsable Centro' },
    });
    api.issueInstallationAuthorization.mockResolvedValue({ authorization, expiresAt: expiry });
    await userEvent.click(screen.getByRole('button', { name: 'Emitir autorización firmada' }));
    expect(api.issueInstallationAuthorization).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      pairingId: id,
      pairingCode: '123456',
      deviceId: id,
      deviceType: 'POS',
      displayName: 'Caja Centro',
      initialOwnerDisplayName: 'Responsable Centro',
      reason: 'Initial installation authorization from Super Admin',
    });
    await screen.findByRole('button', { name: 'Copiar autorización' });
    expect(document.body.innerHTML).not.toContain('fixture-only');
  });
  it('uses the existing owner recovery contract without selecting a different owner', async () => {
    await control();
    await userEvent.click(screen.getByRole('button', { name: 'Instalación / Recuperación' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Recuperar propietario contractual' }),
    );
    fireEvent.change(screen.getByLabelText('Contexto público de recuperación'), {
      target: { value: JSON.stringify(context) },
    });
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Restauración validada' },
    });
    api.issueOwnerRecoveryAuthorization.mockResolvedValue({ authorization, expiresAt: expiry });
    await userEvent.click(
      screen.getByRole('button', { name: 'Autorizar al propietario contractual' }),
    );
    expect(api.issueOwnerRecoveryAuthorization).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      context,
      reason: 'Restauración validada',
    });
    await screen.findByRole('button', { name: 'Copiar autorización' });
    expect(document.body.innerHTML).not.toContain('fixture-only');
  });
  it('disables critical actions when their known permissions are absent', async () => {
    await control([]);
    for (const [section, name] of [
      ['Licencia', 'Configurar propinas'],
      ['Equipo / Edge', 'Revocar Edge'],
      ['Equipo / Edge', 'Reemplazar Edge'],
      ['Instalación / Recuperación', 'Autorizar recuperación'],
      ['Instalación / Recuperación', 'Recuperar propietario contractual'],
      ['Instalación / Recuperación', 'Autorizar instalación inicial'],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: section }));
      expect(screen.getByRole('button', { name }).matches(':disabled')).toBe(true);
    }
  });
  it('keeps creation opt-in and prevents repeating a consumed initial authorization', async () => {
    api.getLatestInstallationAuthorization.mockResolvedValue({ authorization: { authorizationId: id, status: 'CONSUMED', issuedAt: expiry, expiresAt: expiry, consumedAt: expiry } });
    await control();
    expect(screen.queryByRole('heading', { name: 'Nuevo Tenant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Instalación / Recuperación' }));
    const action = screen.getByRole('button', { name: 'Autorizar instalación inicial' });
    expect(action.matches(':disabled')).toBe(true);
    expect(screen.getByText(/La autorización inicial ya fue consumida/)).toBeTruthy();
    await userEvent.click(action);
    expect(api.issueInstallationAuthorization).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo Tenant' }));
    expect(screen.getByRole('heading', { name: 'Nuevo Tenant' })).toBeTruthy();
  });
});
describe('Authorization validation and delivery', () => {
  it('rejects mismatched public owner context and unexpected secret fields without sending', () => {
    const submit = vi.fn();
    render(
      <OwnerRecoveryPanel
        locationName="Centro"
        tenantId={id}
        locationId={id}
        targetEdgeId={id}
        onClose={vi.fn()}
        onSubmit={submit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Contexto público de recuperación'), {
      target: { value: JSON.stringify({ ...context, tenantId: source }) },
    });
    expect(screen.getByLabelText('Contexto público de recuperación').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Contexto público de recuperación').getAttribute('aria-describedby')).toContain('owner-context-error');
    fireEvent.change(screen.getByLabelText('Contexto público de recuperación'), {
      target: { value: JSON.stringify({ ...context, secret: 'fixture-not-a-secret' }) },
    });
    expect(screen.getByLabelText('Contexto público de recuperación').getAttribute('aria-invalid')).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'Autorizar al propietario contractual' })
        .matches(':disabled'),
    ).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
  it('keeps initial authorization disabled for invalid pairing and displays server errors accessibly', () => {
    render(
      <InstallationAuthorizationPanel
        locationName="Centro"
        status={null}
        busy={false}
        error="La solicitud venció."
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Datos para autorizar este dispositivo'), {
      target: { value: '{}' },
    });
    expect(screen.getByLabelText('Datos para autorizar este dispositivo').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Datos para autorizar este dispositivo').getAttribute('aria-describedby')).toContain('pairing-data-error');
    expect(
      screen.getByRole('button', { name: 'Emitir autorización firmada' }).matches(':disabled'),
    ).toBe(true);
    expect(screen.getByText('La solicitud venció.')).toBeTruthy();
  });
  it('copies only after explicit action, reports denial and success, and never renders the document', async () => {
    const user = userEvent.setup(),
      write = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockRejectedValueOnce(new Error('denied'))
        .mockResolvedValue(undefined);
    render(
      <AuthorizationDelivery
        title="Autorización"
        document={JSON.stringify(authorization)}
        expiresAt={expiry}
        onClose={vi.fn()}
      />,
    );
    expect(write).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('fixture-only');
    await user.click(screen.getByRole('button', { name: 'Copiar autorización' }));
    await screen.findByText(/No se pudo copiar/);
    await user.click(screen.getByRole('button', { name: 'Copiar autorización' }));
    await screen.findByText('Copiado al portapapeles.');
    expect(write).toHaveBeenLastCalledWith(JSON.stringify(authorization));
  });
});
