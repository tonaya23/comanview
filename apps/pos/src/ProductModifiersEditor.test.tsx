// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import type { ProductModifierConfiguration, CommercialModifierGroup } from '@comanview/contracts';
import { ProductModifiersEditor } from './ProductModifiersEditor.js';
afterEach(cleanup);
function setup(canManage = true) {
  const id = () => crypto.randomUUID(),
    g: CommercialModifierGroup = {
      id: id(),
      version: 1,
      name: 'Extras',
      active: true,
      minSelections: 0,
      maxSelections: 3,
      products: [],
      options: [],
    };
  g.options = [
    {
      id: id(),
      groupId: g.id,
      version: 1,
      name: 'Queso',
      active: true,
      available: true,
      displayOrder: 0,
      unitPriceDelta: { amount: 1500, currency: 'MXN' },
    },
  ];
  const second = { ...g, id: id(), name: 'Tamaño', options: [] };
  let config: ProductModifierConfiguration = {
    productId: id(),
    version: 4,
    currency: 'MXN',
    assignments: [],
    groups: [],
  };
  const command = vi.fn(async () => ({}));
  const edge = {
    getProductModifierConfiguration: vi.fn(async () => structuredClone(config)),
    getModifierAdministration: vi.fn(async () => ({
      currency: 'MXN',
      groups: structuredClone([g, second]),
    })),
    catalogCommand: command,
  } as unknown as EdgeClient;
  const props = {
    edge,
    productId: config.productId,
    productVersion: 4,
    disabled: false,
    canManage,
    refreshToken: 0,
    onDirty: vi.fn(),
    onBusy: vi.fn(),
    onSaved: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
  };
  const view = render(<ProductModifiersEditor {...props} />);
  return {
    g,
    second,
    props,
    view,
    command,
    setConfig: (next: Partial<ProductModifierConfiguration>) => {
      config = { ...config, ...next };
    },
  };
}
async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}
async function assign(id: string) {
  fireEvent.change(await screen.findByLabelText('Añadir grupo'), { target: { value: id } });
  await click('Asignar grupo');
}
it('assigns reusable groups, reorders, saves overrides using Product.version and clears to inheritance', async () => {
  const f = setup();
  await assign(f.g.id);
  await assign(f.second.id);
  await click('Subir Tamaño');
  fireEvent.change(screen.getByLabelText('Precio de Queso para este producto'), {
    target: { value: '10.00' },
  });
  await click('Guardar opciones y extras');
  await waitFor(() => expect(f.command).toHaveBeenCalled());
  expect(f.command.mock.calls[0]).toMatchObject([
    {
      kind: 'SET_PRODUCT_MODIFIERS',
      expectedVersion: 4,
      payload: {
        assignments: [
          { groupId: f.second.id, displayOrder: 0, groupVersion: 1, overrides: {} },
          {
            groupId: f.g.id,
            displayOrder: 1,
            groupVersion: 1,
            overrides: { [f.g.options[0]!.id]: { amount: 1000, currency: 'MXN' } },
          },
        ],
      },
    },
  ]);
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalled());
  await assign(f.g.id);
  fireEvent.change(screen.getByLabelText('Precio de Queso para este producto'), {
    target: { value: '20' },
  });
  await click('Heredar Queso');
  expect(
    (screen.getByLabelText('Precio de Queso para este producto') as HTMLInputElement).value,
  ).toBe('');
  await click('Quitar Extras');
  await waitFor(() =>
    expect(screen.queryByLabelText('Precio de Queso para este producto')).toBeNull(),
  );
  expect(f.command).toHaveBeenCalledTimes(1);
});
it('realtime conflict preserves override draft and explicit rebase uses fresh Product version', async () => {
  const f = setup();
  await assign(f.g.id);
  fireEvent.change(screen.getByLabelText('Precio de Queso para este producto'), {
    target: { value: '12.00' },
  });
  f.setConfig({ version: 5 });
  f.view.rerender(<ProductModifiersEditor {...f.props} refreshToken={1} />);
  await screen.findByText(/El producto o un grupo compartido cambió/);
  expect(
    (screen.getByLabelText('Precio de Queso para este producto') as HTMLInputElement).value,
  ).toBe('12.00');
  await click('Usar versiones consultadas');
  await click('Guardar opciones y extras');
  await waitFor(() => expect(f.command).toHaveBeenCalled());
  expect(f.command.mock.calls[0]).toMatchObject([{ expectedVersion: 5 }]);
});
it('ACK-lost retains immutable command; successful save plus refresh failure does not repeat mutation', async () => {
  const f = setup();
  await assign(f.g.id);
  f.command.mockRejectedValueOnce(new EdgeClientError('offline', 'EDGE_UNREACHABLE', null));
  await click('Guardar opciones y extras');
  await screen.findByRole('button', { name: 'Reintentar opciones' });
  f.props.onSaved.mockRejectedValueOnce(new Error('refresh'));
  await click('Reintentar opciones');
  await screen.findByText('Guardado confirmado; falta actualizar la vista. No repitas el cambio.');
  expect(f.command.mock.calls[0]).toEqual(f.command.mock.calls[1]);
  await click('Consultar opciones guardadas');
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledTimes(2));
  expect(f.command).toHaveBeenCalledTimes(2);
});
it('read permission does not enable mutations and separate product changes block assignment save', async () => {
  const f = setup(false);
  const select = await screen.findByLabelText('Añadir grupo');
  expect(select.closest('fieldset')!.disabled).toBe(true);
  expect(f.command).not.toHaveBeenCalled();
  f.view.rerender(<ProductModifiersEditor {...f.props} canManage disabled />);
  expect(select.closest('fieldset')!.disabled).toBe(true);
});
