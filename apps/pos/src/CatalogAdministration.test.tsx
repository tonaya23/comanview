// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import { CatalogAdministration } from './CatalogAdministration.js';
import { AdministrationPanel } from './AdministrationPanel.js';
import { catalogFixture, allPermissions, ids } from './catalogAdminFixtures.js';
import userEvent from '@testing-library/user-event';
afterEach(cleanup);

describe('B2 UX polish', () => {
  it('defaults to in-catalog, including unavailable; retired visibility combines with search', async () => {
    const f = setup();
    f.products[0] = { ...f.products[0]!, available: false };
    f.products.push({
      ...f.products[0]!,
      id: 'retired',
      name: 'Retirado de prueba',
      active: false,
    });
    await screen.findByRole('button', { name: 'Marcar disponible: Café' });
    expect(screen.queryByRole('button', { name: 'Más acciones: Retirado de prueba' })).toBeNull();
    fireEvent.click(screen.getByText('Filtros', { selector: 'summary' }));
    fireEvent.click(screen.getByLabelText('Mostrar retirados'));
    expect(screen.getByText('Retirado de prueba')).toBeTruthy();
    change('Buscar producto', 'Retirado de prueba');
    expect(screen.queryByText('Café')).toBeNull();
    expect(screen.getByText('Retirado')).toBeTruthy();
  });
  it('cancel retirement sends nothing; confirmed retirement changes active only', async () => {
    const f = setup();
    await screen.findByText('Café');
    fireEvent.click(screen.getByLabelText('Más acciones: Café'));
    f.props.confirm.mockResolvedValueOnce(false);
    await click('Retirar del catálogo');
    await waitFor(() => expect(f.props.confirm).toHaveBeenCalled());
    expect(f.edge.catalogCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Más acciones: Café'));
    await click('Retirar del catálogo');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(1));
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'SET_PRODUCT_ACTIVE', expectedVersion: 4, payload: { active: false } },
    ]);
    expect(f.edge.catalogCommand).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { active: false } }),
    );
    expect(f.props.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Las ventas anteriores se conservarán'),
    );
  });
  it('reactivation keeps unavailable and makes this explicit after ACK', async () => {
    const f = setup();
    f.products[0] = { ...f.products[0]!, active: false, available: false };
    await screen.findByText('Filtros', { selector: 'summary' });
    fireEvent.click(screen.getByText('Filtros', { selector: 'summary' }));
    fireEvent.click(screen.getByLabelText('Mostrar retirados'));
    fireEvent.click(screen.getByLabelText('Más acciones: Café'));
    await click('Reactivar');
    await screen.findByText(/Producto reactivado. Continúa marcado como no disponible/);
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'SET_PRODUCT_ACTIVE', payload: { active: true } },
    ]);
    expect(f.edge.catalogCommand).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { active: true } }),
    );
  });
  it('retirement lost ACK retries the same command and retains entity feedback', async () => {
    const f = setup();
    f.edge.catalogCommand.mockRejectedValueOnce(new EdgeClientError('lost', 'EDGE_UNREACHABLE', 0));
    await screen.findByText('Café');
    fireEvent.click(screen.getByLabelText('Más acciones: Café'));
    await click('Retirar del catálogo');
    await click('Reintentar cambio');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(2));
    expect(f.edge.catalogCommand.mock.calls[0]).toEqual(f.edge.catalogCommand.mock.calls[1]);
    await screen.findByText(/Café: Producto retirado del catálogo/);
  });
  it('dedicated editor preserves every filter and returns focus to its row', async () => {
    setup();
    await screen.findByText('Café');
    change('Buscar producto', 'CAFE');
    change('Categoría', ids.category);
    fireEvent.click(screen.getByText('Filtros', { selector: 'summary' }));
    change('Estación', 'none');
    change('Disponibilidad', 'true');
    fireEvent.click(screen.getByLabelText('Mostrar retirados'));
    const edit = screen.getByRole('button', { name: 'Editar' });
    edit.focus();
    fireEvent.click(edit);
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Buscar producto' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Opciones y extras' })).toBeTruthy();
    await click('Volver a productos');
    await waitFor(() => expect(document.activeElement).toBe(edit));
    for (const [label, value] of [
      ['Buscar producto', 'CAFE'],
      ['Categoría', ids.category],
      ['Estación', 'none'],
      ['Disponibilidad', 'true'],
    ]) {
      expect((screen.getByLabelText(label!) as HTMLInputElement).value).toBe(value);
    }
    expect((screen.getByLabelText('Mostrar retirados') as HTMLInputElement).checked).toBe(true);
  });
  it('category failure stays in category context and CTA resets incompatible product filters', async () => {
    const f = setup();
    await screen.findByText('Café');
    change('Buscar producto', 'no existe');
    f.rerender(<CatalogAdministration {...f.props} section="categories" />);
    f.edge.catalogCommand.mockRejectedValueOnce(
      new EdgeClientError('blocked', 'CATEGORY_HAS_ACTIVE_PRODUCTS', 409),
    );
    fireEvent.click(screen.getByLabelText('Más acciones: Category'));
    await click('Desactivar Category');
    await screen.findByText(/No puedes desactivar esta categoría/);
    await click('Ver productos');
    f.rerender(<CatalogAdministration {...f.props} section="products" />);
    expect(screen.queryByText(/No puedes desactivar esta categoría/)).toBeNull();
    expect((screen.getByLabelText('Categoría') as HTMLSelectElement).value).toBe(ids.otherCategory);
    expect((screen.getByLabelText('Buscar producto') as HTMLInputElement).value).toBe('');
    f.rerender(<CatalogAdministration {...f.props} section="categories" />);
    expect(screen.getByText(/No puedes desactivar esta categoría/)).toBeTruthy();
  });
  it('product error identifies the entity and does not appear in Categories or a new editor', async () => {
    const f = setup();
    f.edge.catalogCommand.mockRejectedValueOnce(
      new EdgeClientError('duplicate', 'SKU_CONFLICT', 409),
    );
    await click('Editar');
    change('SKU', 'taken');
    await click('Guardar producto');
    await screen.findByText('Café:', { selector: 'strong' });
    expect(document.querySelector('form')?.getAttribute('aria-describedby')).toBe(
      'catalog-command-error',
    );
    f.rerender(<CatalogAdministration {...f.props} section="categories" />);
    expect(screen.queryByText('Café:', { selector: 'strong' })).toBeNull();
    f.rerender(<CatalogAdministration {...f.props} section="products" />);
    await click('Volver a productos');
    await click('Nuevo producto');
    expect(document.getElementById('catalog-command-error')).toBeNull();
  });
  it('inactive categories are hidden; global reorder includes hidden categories', async () => {
    const f = setup('categories');
    f.categories.splice(1, 0, {
      ...f.categories[1]!,
      id: 'hidden',
      name: 'Oculta',
      active: false,
      displayOrder: 0,
    });
    await screen.findByRole('heading', { name: 'Categorías' });
    expect(screen.queryByRole('button', { name: 'Editar Oculta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Subir Category' })).toBeNull();
    await click('Ordenar categorías');
    await click('Subir Category');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      {
        kind: 'REORDER_CATEGORIES',
        payload: {
          categories: [{ id: ids.category }, { id: ids.otherCategory }, { id: 'hidden' }],
        },
      },
    ]);
    fireEvent.click(screen.getByLabelText('Mostrar inactivas'));
    expect(screen.getByRole('button', { name: 'Editar Oculta' })).toBeTruthy();
  });
  it('system/legacy explanations are on demand without impossible actions', async () => {
    setup('categories');
    await screen.findByText('Del sistema');
    expect(screen.getByText('Del sistema').closest('details')?.open).toBe(false);
    expect(screen.getByText('Revisar nombre').closest('details')?.open).toBe(false);
    expect(screen.queryByLabelText('Más acciones: Sin categoría')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar Sin categoría' })).toBeNull();
  });
  it('native disclosure permits keyboard traversal and Escape restores focus', async () => {
    setup();
    await screen.findByText('Café');
    const user = userEvent.setup(),
      menu = screen.getByLabelText('Más acciones: Café');
    // jsdom does not implement summary's native Enter activation; click exercises the native toggle.
    await user.click(menu);
    expect((menu.parentElement as HTMLDetailsElement).open).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Retirar del catálogo' }),
    );
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(menu);
    expect((menu.parentElement as HTMLDetailsElement).open).toBe(false);
    const filter = screen.getByText('Filtros', { selector: 'summary' });
    await user.click(filter);
    expect((filter.parentElement as HTMLDetailsElement).open).toBe(true);
  });
});
describe('B2 Admin shell integration', () => {
  it('retains a product draft across sections and warns before closing Admin', async () => {
    const f = catalogFixture(),
      close = vi.fn();
    render(
      <AdministrationPanel
        edge={f.edge as unknown as EdgeClient}
        currentUserId="owner"
        permissions={allPermissions}
        initialTarget={{ surface: 'administration', section: 'products' }}
        onClose={close}
      />,
    );
    await click('Editar');
    change('Nombre', 'Pendiente de guardar');
    const nav = within(screen.getByRole('navigation', { name: 'Administración del restaurante' }));
    fireEvent.click(nav.getByRole('button', { name: /Categorías/ }));
    await screen.findByRole('heading', { name: 'Categorías' });
    fireEvent.click(nav.getByRole('button', { name: /Productos/ }));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe(
      'Pendiente de guardar',
    );
    await click('Volver al POS');
    await screen.findByRole('heading', { name: 'Confirma antes de continuar' });
    expect(close).not.toHaveBeenCalled();
  });
  it('catalog-only reader loads without requiring independent administration permissions', async () => {
    const f = catalogFixture();
    render(
      <AdministrationPanel
        edge={f.edge as unknown as EdgeClient}
        currentUserId="reader"
        permissions={['CATALOG_VIEW']}
        initialTarget={{ surface: 'administration', section: 'products' }}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('Café');
    expect(f.edge.getRestaurantAdministration).not.toHaveBeenCalled();
    expect(f.edge.getTaxAdministration).not.toHaveBeenCalled();
  });
});
function setup(section: 'products' | 'categories' = 'products', permissions = allPermissions) {
  const f = catalogFixture(),
    onProducts = vi.fn(),
    onDirty = vi.fn(),
    confirm = vi.fn(async () => true);
  const props = {
    edge: f.edge as unknown as EdgeClient,
    permissions,
    section,
    onProducts,
    onDirty,
    onBusy: vi.fn(),
    confirm,
    onTaxes: vi.fn(),
    onCurrency: vi.fn(),
  };
  const view = render(<CatalogAdministration {...props} />);
  return { ...f, ...view, props };
}
const click = async (name: string | RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name }));
};
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function create() {
  await click('Nuevo producto');
  change('Nombre', 'Té');
  change('Precio (MXN)', '12.34');
}
describe('B2 Product UI', () => {
  it('refreshes configuration when returning from another Admin section without replacing draft', async () => {
    const f = setup();
    await click('Editar');
    change('Nombre', 'Pendiente');
    f.rerender(<CatalogAdministration {...f.props} visible={false} />);
    const previous = f.edge.getTaxAdministration.mock.calls.length;
    f.tax.defaultTaxProfileId = ids.otherTax;
    f.rerender(<CatalogAdministration {...f.props} visible />);
    await waitFor(() =>
      expect(f.edge.getTaxAdministration.mock.calls.length).toBeGreaterThan(previous),
    );
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Pendiente');
  });
  it('distinguishes empty catalog from unavailable source', async () => {
    const f = setup();
    f.products.splice(0);
    f.state.catalogGeneration++;
    f.rerender(<CatalogAdministration {...f.props} refreshToken={1} />);
    await screen.findByText('No hay productos todavía.');
    f.edge.getCatalogState.mockRejectedValue(new EdgeClientError('offline', 'EDGE_UNREACHABLE', 0));
    f.rerender(<CatalogAdministration {...f.props} refreshToken={2} />);
    await screen.findByText(/Los datos pueden estar desactualizados/);
  });
  it('missing default tax disables create with concrete guidance', async () => {
    const f = setup();
    f.tax.defaultTaxProfileId = null;
    f.rerender(<CatalogAdministration {...f.props} refreshToken={1} />);
    await screen.findByText('Configura un impuesto predeterminado activo.');
    expect(
      (screen.getByRole('button', { name: 'Nuevo producto' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('currency prerequisite is explicit and does not mutate catalog', async () => {
    const f = setup();
    f.admin.operational.currency = null;
    f.rerender(<CatalogAdministration {...f.props} refreshToken={1} />);
    await screen.findByText('Configura primero la moneda del restaurante.');
    expect(f.edge.catalogCommand).not.toHaveBeenCalled();
  });
  it('editor focus and labels are accessible and confirms dirty discard', async () => {
    const f = setup();
    await click('Editar');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Editar producto' }));
    change('Nombre', 'Pendiente');
    f.props.confirm.mockResolvedValueOnce(false);
    await click('Volver a productos');
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Pendiente');
  });
  it('loads human labels and filters name, SKU and barcode without refetch', async () => {
    const f = setup();
    await screen.findByText('Café');
    const count = f.edge.getProducts.mock.calls.length;
    change('Buscar producto', '123456');
    expect(screen.getByText('Café')).toBeTruthy();
    change('Buscar producto', 'ausente');
    expect(screen.getByText('No encontramos productos con estos filtros.')).toBeTruthy();
    expect(f.edge.getProducts).toHaveBeenCalledTimes(count);
    change('Buscar producto', '');
    fireEvent.click(screen.getByText('Filtros', { selector: 'summary' }));
    change('Disponibilidad', 'false');
    expect(screen.getByText('No encontramos productos con estos filtros.')).toBeTruthy();
  });
  it('denies reads without catalog permission', () => {
    const f = setup('products', []);
    expect(screen.getByText('No tienes permiso para consultar el catálogo.')).toBeTruthy();
    expect(f.edge.getProducts).not.toHaveBeenCalled();
  });
  it('read-only actor cannot create or change availability', async () => {
    const f = setup('products', ['CATALOG_VIEW']);
    f.products[0]!.stationId = ids.station;
    await screen.findByText('Café');
    expect(
      (screen.getByRole('button', { name: 'Nuevo producto' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Marcar no disponible: Café' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await click('Ver producto');
    expect((screen.getByLabelText('Estación de preparación') as HTMLSelectElement).value).toBe(
      ids.station,
    );
    expect(screen.getByRole('option', { name: 'Estación asignada (solo consulta)' })).toBeTruthy();
  });
  it('creates with system category, default tax, no station, exact price, active and available', async () => {
    const f = setup();
    await create();
    expect((screen.getByLabelText('Categoría del producto') as HTMLSelectElement).value).toBe(
      ids.category,
    );
    expect((screen.getByLabelText('Impuesto del producto') as HTMLSelectElement).value).toBe(
      ids.tax,
    );
    await click('Guardar producto');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(1));
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      {
        kind: 'CREATE_PRODUCT',
        payload: {
          category: { id: ids.category },
          taxProfile: { id: ids.tax },
          station: null,
          active: true,
          available: true,
          basePrice: { amount: 1234, currency: 'MXN' },
        },
      },
    ]);
  });
  it('manager sees default tax and station as read-only', async () => {
    const f = setup('products', ['CATALOG_VIEW', 'CATALOG_MANAGE', 'ADMINISTRATION_VIEW']);
    await create();
    expect((screen.getByLabelText('Impuesto del producto') as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText('Estación de preparación') as HTMLSelectElement).disabled).toBe(
      true,
    );
    await click('Guardar producto');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).not.toMatchObject([
      { payload: { taxProfile: { id: ids.tax } } },
    ]);
  });
  it('lost create ACK retries the immutable command without duplicate intention', async () => {
    const f = setup();
    f.edge.catalogCommand.mockRejectedValueOnce(new EdgeClientError('lost', 'EDGE_UNREACHABLE', 0));
    await create();
    await click('Guardar producto');
    await click('Reintentar guardado pendiente');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(2));
    expect(f.edge.catalogCommand.mock.calls[0]).toEqual(f.edge.catalogCommand.mock.calls[1]);
  });
  it('SKU rejection retains draft and allows correction/new command', async () => {
    const f = setup();
    f.edge.catalogCommand.mockRejectedValueOnce(
      new EdgeClientError('duplicate', 'SKU_CONFLICT', 409),
    );
    await create();
    change('SKU', 'taken');
    await click('Guardar producto');
    await waitFor(() =>
      expect((screen.getByLabelText('SKU') as HTMLInputElement).disabled).toBe(false),
    );
    change('SKU', 'new');
    await click('Guardar producto');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(2));
    expect(f.edge.catalogCommand.mock.calls[0]).not.toEqual(f.edge.catalogCommand.mock.calls[1]);
  });
  it('quick availability waits for ACK and uses versioned command', async () => {
    const f = setup();
    await click('Marcar no disponible: Café');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'SET_PRODUCT_AVAILABILITY', expectedVersion: 4, payload: { available: false } },
    ]);
  });
  it('remote change refreshes list, preserves dirty editor, blocks stale save, and allows manual rebase', async () => {
    const f = setup();
    await click('Editar');
    change('Nombre', 'Mi intención');
    f.products[0] = { ...f.products[0]!, name: 'Remoto', version: 5 };
    f.state.catalogGeneration++;
    f.rerender(<CatalogAdministration {...f.props} refreshToken={1} />);
    await screen.findByText('Remoto');
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Mi intención');
    expect(
      (screen.getByRole('button', { name: 'Guardar producto' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await click('Revisar estado actual');
    await click('Aplicar mi borrador sobre esta base');
    await click('Guardar producto');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { expectedVersion: 5, payload: { name: 'Mi intención' } },
    ]);
  });
  it('partial save exposes progress and retry sends only remaining identical intent', async () => {
    const f = setup();
    f.edge.catalogCommand
      .mockResolvedValueOnce({ version: 5, entities: [], changed: true })
      .mockRejectedValueOnce(new EdgeClientError('lost', 'EDGE_UNREACHABLE', 0));
    await click('Editar');
    change('Nombre', 'Nuevo');
    change('Precio (MXN)', '120');
    change('Motivo del cambio de precio', 'Costos');
    await click('Guardar producto');
    await screen.findByText(/Guardado: Información/);
    await click('Reintentar guardado pendiente');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(3));
    expect(f.edge.catalogCommand.mock.calls[1]).toEqual(f.edge.catalogCommand.mock.calls[2]);
  });
  it('preserves list context across editor close', async () => {
    setup();
    await screen.findByText('Café');
    change('Buscar producto', 'CAFE');
    await click('Editar');
    await click('Volver a productos');
    expect((screen.getByLabelText('Buscar producto') as HTMLInputElement).value).toBe('CAFE');
  });
  it('confirms deactivation and does not change orders', async () => {
    const f = setup();
    await click('Editar');
    fireEvent.click(screen.getByLabelText('En catálogo'));
    await click('Guardar producto');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.props.confirm).toHaveBeenCalled();
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'SET_PRODUCT_ACTIVE', payload: { active: false } },
    ]);
  });
});
describe('B2 Category UI', () => {
  it('activates an inactive category using its current version', async () => {
    const f = setup('categories');
    f.categories[1] = { ...f.categories[1]!, active: false };
    f.state.catalogGeneration++;
    f.rerender(<CatalogAdministration {...f.props} refreshToken={1} />);
    await screen.findByLabelText('Mostrar inactivas');
    fireEvent.click(screen.getByLabelText('Mostrar inactivas'));
    fireEvent.click(screen.getByLabelText('Más acciones: Category'));
    await click('Reactivar Category');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'SET_CATEGORY_ACTIVE', expectedVersion: 2, payload: { active: true } },
    ]);
  });
  it('lists counts, system category and non-destructive legacy notice', async () => {
    setup('categories');
    await screen.findByText('Sin categoría', { selector: 'strong' });
    expect(screen.getByText(/1 productos · 1 en catálogo/)).toBeTruthy();
    expect(screen.getByText(/Puede provenir de una configuración anterior/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desactivar Sin categoría' })).toBeNull();
  });
  it('creates a category with a new command', async () => {
    const f = setup('categories');
    await click('Nueva categoría');
    change('Nombre de la categoría', 'Bebidas');
    await click('Guardar categoría');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'CREATE_CATEGORY', expectedVersion: 0, payload: { name: 'Bebidas' } },
    ]);
  });
  it('renames with OCC preserving legacy until explicitly saved', async () => {
    const f = setup('categories');
    await click('Editar Category');
    change('Nombre de la categoría', 'Comidas');
    expect(f.edge.catalogCommand).not.toHaveBeenCalled();
    await click('Guardar categoría');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      { kind: 'UPDATE_CATEGORY', expectedVersion: 2, payload: { name: 'Comidas' } },
    ]);
  });
  it('deactivation rejection offers product navigation without batch deactivation', async () => {
    const f = setup('categories');
    f.edge.catalogCommand.mockRejectedValueOnce(
      new EdgeClientError('active', 'CATEGORY_HAS_ACTIVE_PRODUCTS', 409),
    );
    await screen.findByLabelText('Más acciones: Category');
    fireEvent.click(screen.getByLabelText('Más acciones: Category'));
    await click('Desactivar Category');
    await screen.findByText(/No puedes desactivar esta categoría/);
    await click('Ver productos de Category');
    expect(f.props.onProducts).toHaveBeenCalled();
    expect(f.edge.catalogCommand).toHaveBeenCalledTimes(1);
  });
  it('reorders atomically using all authoritative category versions', async () => {
    const f = setup('categories');
    await click('Ordenar categorías');
    await click('Subir Category');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalled());
    expect(f.edge.catalogCommand.mock.calls[0]).toMatchObject([
      {
        kind: 'REORDER_CATEGORIES',
        payload: {
          categories: [
            { id: ids.otherCategory, expectedVersion: 2, displayOrder: 0 },
            { id: ids.category, expectedVersion: 1, displayOrder: 1 },
          ],
        },
      },
    ]);
  });
  it('conflict retains proposed name and requires explicit rebase', async () => {
    const f = setup('categories');
    f.edge.catalogCommand.mockRejectedValueOnce(
      new EdgeClientError('conflict', 'CATALOG_VERSION_CONFLICT', 409),
    );
    await click('Editar Category');
    change('Nombre de la categoría', 'Mi nombre');
    f.categories[1] = { ...f.categories[1]!, version: 3, name: 'Externo' };
    f.state.catalogGeneration++;
    await click('Guardar categoría');
    await screen.findByText(/Esta categoría cambió/);
    expect((screen.getByLabelText('Nombre de la categoría') as HTMLInputElement).value).toBe(
      'Mi nombre',
    );
    await click('Revisar y usar base actual');
    await click('Guardar categoría');
    await waitFor(() => expect(f.edge.catalogCommand).toHaveBeenCalledTimes(2));
    expect(f.edge.catalogCommand.mock.calls[1]).toMatchObject([{ expectedVersion: 3 }]);
  });
  it('preserves independent product and category drafts across sections', async () => {
    const f = setup();
    await click('Editar');
    change('Nombre', 'Pendiente');
    f.rerender(<CatalogAdministration {...f.props} section="categories" />);
    await click('Nueva categoría');
    change('Nombre de la categoría', 'Bebidas');
    await click('Guardar categoría');
    await screen.findByText('Categoría guardada.');
    f.rerender(<CatalogAdministration {...f.props} section="products" />);
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Pendiente');
  });
});
