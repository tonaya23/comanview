// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

const api = vi.hoisted(() => ({ getSession: vi.fn(), getLocations: vi.fn(), getTenants: vi.fn(), getCanonicalLocations: vi.fn(), getOverview: vi.fn() }));
vi.mock('@comanview/client-sdk', async (original) => ({ ...(await original<typeof import('@comanview/client-sdk')>()), createCloudAdminClient: () => api }));
const location = { locationId: 'location', tenantId: 'tenant', edgeId: 'edge', edgeStatus: 'ONLINE', lastSeenAt: null, edgeVersion: '1', schemaVersion: '15', pendingEventCount: 0, projectionHealth: { lastProjectionProcessedAt: null, lastEventReceivedAt: null } };
beforeEach(() => {
  vi.resetAllMocks();
  api.getSession.mockResolvedValue({ user: { displayName: 'Auditor', role: 'VIEWER', permissions: ['CLOUD_LOCATION_VIEW', 'CLOUD_FINANCIAL_VIEW'] } });
  api.getLocations.mockResolvedValue({ data: [location], page: { nextCursor: null } });
  api.getTenants.mockResolvedValue({ data: [{ tenantId: 'tenant', displayName: 'Restaurante Norte' }] });
  api.getCanonicalLocations.mockResolvedValue({ data: [{ locationId: 'location', displayName: 'Sucursal Centro' }] });
  api.getOverview.mockResolvedValue({ location, orderCounts: { open: 0, closed: 0, cancelled: 0 }, recentOrders: [], financial: { completeSalesTotals: [], incompleteSaleCount: 0 } });
});
afterEach(cleanup);
describe('Round 2 operational Cloud presentation', () => {
  it('shows canonical names and distinguishes unprocessed projections from zero activity', async () => {
    render(<App/>);
    await userEvent.click(await screen.findByRole('button', { name: /Sucursal Centro.*Restaurante Norte/ }));
    await screen.findByText(/No equivale a actividad cero/);
    const metric = screen.getByText('Pedidos abiertos').closest('article')!;
    expect(within(metric).getByText('—')).toBeTruthy();
    expect(screen.queryByText('Sin ventas completas en las últimas 24 horas.')).toBeNull();
    expect(screen.getByText('Esperando datos procesados de ventas.')).toBeTruthy();
    expect(api.getOverview).toHaveBeenCalledExactlyOnceWith('location');
  });
  it('shows a real zero once a projection has been processed', async () => {
    api.getOverview.mockResolvedValue({ location: { ...location, projectionHealth: { ...location.projectionHealth, lastProjectionProcessedAt: '2026-09-16T00:00:00Z' } }, orderCounts: { open: 0, closed: 0, cancelled: 0 }, recentOrders: [], financial: null });
    render(<App/>);
    await userEvent.click(await screen.findByRole('button', { name: /Sucursal Centro.*Restaurante Norte/ }));
    const metric = (await screen.findByText('Pedidos abiertos')).closest('article')!;
    expect(within(metric).getByText('0')).toBeTruthy();
    expect(screen.queryByText(/No equivale a actividad cero/)).toBeNull();
  });
  it('keeps operational Locations usable if supplemental names cannot be read', async () => {
    api.getTenants.mockRejectedValue(new Error('unavailable'));
    render(<App/>);
    await userEvent.click(await screen.findByRole('button', { name: /Nombre no disponible/ }));
    await screen.findByText(/No equivale a actividad cero/);
    expect(api.getOverview).toHaveBeenCalledWith('location');
  });
});
