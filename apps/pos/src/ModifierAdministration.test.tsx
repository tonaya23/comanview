// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import type {
  CommercialModifierGroup as Group,
  CatalogCommandInput,
  CatalogCommandResult,
} from '@comanview/contracts';
import { ModifierAdministration } from './ModifierAdministration.js';
import { groupDraft, groupPayload, signedMinor, decimalMinor, selectionRule } from './modifierEditor.js';
import {
  ADMIN_SECTIONS,
  canOpenAdminSection,
  AdministrationResources,
} from './administrationModel.js';
afterEach(cleanup);
it('defaults optional groups to three and explains a deliberately zero maximum without changing its meaning', () => {
  expect(groupPayload({...groupDraft(null),name:'Extras'})).toMatchObject({minSelections:0,maxSelections:3});
  expect(selectionRule(0,0)).toBe('Sin selecciones permitidas');
  expect(groupPayload({name:'Paused',min:'0',max:'0',active:true})).toMatchObject({minSelections:0,maxSelections:0});
});
const id = () => crypto.randomUUID();
function setup(permissions = ['CATALOG_VIEW', 'CATALOG_MANAGE'], secondOption = false) {
  const group: Group = {
    id: id(),
    name: 'Extras',
    version: 1,
    minSelections: 0,
    maxSelections: 3,
    active: true,
    products: [{ id: id(), name: 'Hamburguesa', active: true }],
    options: [
      {
        id: id(),
        groupId: '',
        name: 'Queso',
        version: 1,
        unitPriceDelta: { amount: 1500, currency: 'MXN' },
        active: true,
        available: true,
        displayOrder: 0,
      },
    ],
  };
  group.options[0]!.groupId = group.id;
  if (secondOption)
    group.options.push({ ...group.options[0]!, id: id(), name: 'Tocino', displayOrder: 1 });
  let groups = [
    group,
    { ...group, id: id(), name: 'Retirado', active: false, products: [], options: [] },
  ];
  const get = vi.fn(async () => ({ currency: 'MXN', groups: structuredClone(groups) }));
  const command = vi.fn(async (c: CatalogCommandInput): Promise<CatalogCommandResult> => {
    let g =
      groups.find(
        (x) => x.id === ('group' in c ? c.group.id : 'entityId' in c ? c.entityId : ''),
      ) ?? group;
    if (c.kind === 'CREATE_MODIFIER_GROUP') {
      g = { id: id(), version: 1, ...c.payload, options: [], products: [] };
      groups.push(g);
    } else if (c.kind === 'UPDATE_MODIFIER_GROUP') {
      Object.assign(g, c.payload);
      g.version++;
    } else if (c.kind === 'CREATE_MODIFIER_OPTION') {
      g.options.push({ id: id(), version: 1, groupId: g.id, ...c.payload });
      g.version++;
    } else if (c.kind === 'UPDATE_MODIFIER_OPTION') {
      Object.assign(
        g.options.find((o) => o.id === c.entityId)!,
        c.payload,
      );
      g.options.find((o) => o.id === c.entityId)!.version++;
      g.version++;
    } else if (c.kind === 'SET_MODIFIER_OPTION_AVAILABILITY') {
      g.options.find((o) => o.id === c.entityId)!.available = c.payload.available;
      g.version++;
    } else if (c.kind === 'SET_MODIFIER_OPTION_ACTIVE') {
      g.options.find((o) => o.id === c.entityId)!.active = c.payload.active;
      g.version++;
    } else if (c.kind === 'SET_MODIFIER_GROUP_ACTIVE') {
      g.active = c.payload.active;
      g.version++;
    } else if (c.kind === 'REORDER_MODIFIER_OPTIONS') {
      for (const e of c.payload.options)
        g.options.find((o) => o.id === e.id)!.displayOrder = e.displayOrder;
      g.options.sort((a, b) => a.displayOrder - b.displayOrder);
      g.version++;
    }
    return {
      commandId: c.commandId,
      entityType: 'MODIFIER_GROUP',
      entityId: g.id,
      version: g.version,
      catalogGeneration: 1,
      recoveryEpoch: 0,
      changed: true,
      entities: [structuredClone(g)],
    };
  });
  const edge = { getModifierAdministration: get, catalogCommand: command } as unknown as EdgeClient;
  const props = {
    edge,
    permissions,
    visible: true,
    refreshToken: 0,
    onDirty: vi.fn(),
    onBusy: vi.fn(),
    confirm: vi.fn(async () => true),
  };
  const view = render(<ModifierAdministration {...props} />);
  return {
    group,
    props,
    view,
    command,
    get,
    setGroups: (value: Group[]) => {
      groups = value;
    },
  };
}
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}
it('navigation uses catalog permission without loading unrelated admin resources', async () => {
  expect(ADMIN_SECTIONS).toContainEqual({
    id: 'modifiers',
    label: 'Modificadores',
    group: 'Catálogo',
  });
  expect(canOpenAdminSection('modifiers', ['CATALOG_VIEW'])).toBe(true);
  expect(canOpenAdminSection('modifiers', ['ADMINISTRATION_VIEW'])).toBe(false);
  expect(
    await new AdministrationResources().load({} as EdgeClient, 'modifiers', ['CATALOG_VIEW']),
  ).toEqual({ denied: false, resources: {} });
});
it('lists commercial rules and usage, hides inactive groups until requested', async () => {
  setup();
  await screen.findByText('Extras');
  expect(screen.queryByText('Retirado')).toBeNull();
  expect(screen.getByText(/Opcional · Hasta 3/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Mostrar inactivos'));
  expect(screen.getByText('Retirado')).toBeTruthy();
  await click('Editar Extras');
  await click('Ver productos');
  expect(screen.getByText(/Hamburguesa/)).toBeTruthy();
});
it('creates and edits a Group with real numeric preset payloads', async () => {
  const f = setup();
  await click('Nuevo grupo');
  change('Nombre del grupo', 'Tamaño');
  await click('Elegir uno');
  await click('Guardar grupo');
  await screen.findByRole('heading', { name: 'Editar Tamaño' });
  expect(f.command).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'CREATE_MODIFIER_GROUP',
      expectedVersion: 0,
      payload: { name: 'Tamaño', minSelections: 1, maxSelections: 1, active: true },
    }),
  );
  change('Nombre del grupo', 'Tamaños');
  await click('Elegir varias');
  await click('Guardar grupo');
  await screen.findByRole('heading', { name: 'Editar Tamaños' });
  expect(f.command).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'UPDATE_MODIFIER_GROUP',
      expectedVersion: 1,
      payload: expect.objectContaining({ minSelections: 1, maxSelections: 3 }),
    }),
  );
});
it('creates/edits signed Option prices and keeps active separate from available', async () => {
  const f = setup();
  await click('Editar Extras');
  await click('Nueva opción');
  change('Nombre de la opción', 'Sin queso');
  change('Ajuste de precio por unidad (MXN)', '-10.00');
  await click('Guardar opción');
  await screen.findByRole('button', { name: 'Editar Sin queso' });
  expect(f.command).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: 'CREATE_MODIFIER_OPTION',
      payload: expect.objectContaining({ unitPriceDelta: { amount: -1000, currency: 'MXN' } }),
    }),
  );
  await click('Editar Sin queso');
  change('Ajuste de precio por unidad (MXN)', '0');
  await click('Guardar opción');
  await screen.findByRole('button', { name: 'Editar Sin queso' });
  await click('Marcar no disponible Queso');
  await waitFor(() => expect(f.group.options[0]!.available).toBe(false));
  expect(f.group.options[0]!.active).toBe(true);
  await click('Retirar Queso');
  await waitFor(() => expect(f.group.options[0]!.active).toBe(false));
  expect(f.props.confirm).toHaveBeenCalledWith(expect.stringContaining('1 productos'));
});
it('reorders using keyboard-accessible buttons and persists after refresh', async () => {
  const f = setup(undefined, true),
    first = f.group.options[0]!.id,
    second = f.group.options[1]!.id;
  await click('Editar Extras');
  await click('Bajar Queso');
  await waitFor(() =>
    expect(f.command).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'REORDER_MODIFIER_OPTIONS',
        expectedVersion: 1,
        payload: {
          options: [
            { id: second, expectedVersion: 1, displayOrder: 0 },
            { id: first, expectedVersion: 1, displayOrder: 1 },
          ],
        },
      }),
    ),
  );
  await click('Volver a modificadores');
  await click('Actualizar lista');
  await click('Editar Extras');
  expect((screen.getByRole('button', { name: 'Subir Tocino' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it('realtime preserves dirty Group/Option drafts and explicit rebase adopts current versions', async () => {
  const f = setup();
  await click('Editar Extras');
  await click('Editar Queso');
  change('Nombre de la opción', 'Queso local');
  f.group.version = 2;
  f.group.name = 'Extras remotos';
  f.group.options[0]!.version = 2;
  f.group.options[0]!.unitPriceDelta.amount = 1800;
  f.view.rerender(<ModifierAdministration {...f.props} refreshToken={1} />);
  await screen.findByText('El grupo cambió');
  expect((screen.getByLabelText('Nombre de la opción') as HTMLInputElement).value).toBe(
    'Queso local',
  );
  await click('Usar base consultada');
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Ajuste de precio por unidad (MXN)') as HTMLInputElement).value,
    ).toBe('18.00'),
  );
  await click('Guardar opción');
  await waitFor(() =>
    expect(f.command).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'UPDATE_MODIFIER_OPTION',
        expectedVersion: 2,
        group: { id: f.group.id, version: 2 },
        payload: expect.objectContaining({
          name: 'Queso local',
          unitPriceDelta: { amount: 1800, currency: 'MXN' },
        }),
      }),
    ),
  );
});
it('ACK-lost retries the immutable command and blocks other changes', async () => {
  const f = setup();
  await click('Editar Extras');
  change('Nombre del grupo', 'Editado');
  f.command.mockRejectedValueOnce(new EdgeClientError('offline', 'EDGE_UNREACHABLE', null));
  await click('Guardar grupo');
  await screen.findByText('Confirmación pendiente');
  expect(screen.getByLabelText('Nombre del grupo').closest('fieldset')!.disabled).toBe(true);
  await click('Reintentar operación');
  await screen.findByRole('heading', { name: 'Editar Editado' });
  expect(f.command.mock.calls[1]![0]).toEqual(f.command.mock.calls[0]![0]);
});
it('permission denied and invalid rules keep drafts without internal details', async () => {
  const f = setup();
  await click('Editar Extras');
  change('Mínimo de selecciones', '4');
  await click('Guardar grupo');
  expect(f.command).not.toHaveBeenCalled();
  await screen.findByText('El máximo debe ser igual o mayor que el mínimo.');
  change('Mínimo de selecciones', '0');
  change('Nombre del grupo', 'Local');
  f.command.mockRejectedValueOnce(
    new EdgeClientError('private internals', 'PERMISSION_DENIED', 403),
  );
  await click('Guardar grupo');
  await waitFor(() => expect(f.command).toHaveBeenCalled());
  expect(screen.queryByText('private internals')).toBeNull();
  expect((screen.getByLabelText('Nombre del grupo') as HTMLInputElement).value).toBe('Local');
});
it('read-only users can consult but cannot send mutations; leaving warns and restores focus', async () => {
  const f = setup(['CATALOG_VIEW']);
  await click('Consultar Extras');
  expect(
    (screen.getByLabelText('Nombre del grupo') as HTMLInputElement).closest('fieldset')!.disabled,
  ).toBe(true);
  expect(f.command).not.toHaveBeenCalled();
});
it('dirty navigation preserves editor; cancel back retains draft, confirmed back restores focus', async () => {
  const f = setup();
  const button = await screen.findByRole('button', { name: 'Editar Extras' });
  button.focus();
  await click('Editar Extras');
  change('Nombre del grupo', 'Pendiente');
  f.view.rerender(<ModifierAdministration {...f.props} visible={false} />);
  f.view.rerender(<ModifierAdministration {...f.props} visible />);
  expect((screen.getByLabelText('Nombre del grupo') as HTMLInputElement).value).toBe('Pendiente');
  f.props.confirm.mockResolvedValueOnce(false);
  await click('Volver a modificadores');
  expect(screen.getByLabelText('Nombre del grupo')).toBeTruthy();
  await click('Volver a modificadores');
  await screen.findByRole('button', { name: 'Editar Extras' });
});
it('money conversion is integer-exact for positive, zero and negative deltas', () => {
  for (const [text, value] of [
    ['15.00', 1500],
    ['0', 0],
    ['-0.05', -5],
    ['-10,00', -1000],
  ] as const)
    expect(signedMinor(text)).toBe(value);
  expect(decimalMinor(-5)).toBe('-0.05');
  expect(() => signedMinor('0.001')).toThrow();
  expect(() => signedMinor('900719925474099.99')).toThrow();
  expect(selectionRule(1, 1)).toBe('Obligatorio · Elegir 1');
  expect(() => groupPayload({ name: 'x', min: '4', max: '2', active: true })).toThrow();
});
