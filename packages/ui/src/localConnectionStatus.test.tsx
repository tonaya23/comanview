// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocalConnectionStatus, localConnectionPresentation } from './LocalConnectionStatus.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('keeps connecting, disconnected, realtime-degraded and locally operational offline distinct', () => {
  expect(localConnectionPresentation('CONNECTING', false, true).title).toBe(
    'Comprobando conexión local',
  );
  expect(localConnectionPresentation('DISCONNECTED', true, true).tone).toBe('error');
  expect(localConnectionPresentation('CONNECTED', false, true).title).toBe(
    'Reconectando avisos en vivo',
  );
  expect(localConnectionPresentation('CONNECTED', true, false).title).toContain('red limitada');
  expect(localConnectionPresentation('CONNECTED', true, true).title).toBe(
    'Operación local disponible',
  );
});
it('announces status and never treats a browser offline hint as loss of the local service', () => {
  render(<LocalConnectionStatus local="CONNECTED" realtime />);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  fireEvent(window, new Event('offline'));
  expect(screen.getByRole('status').textContent).toContain('Operación local disponible');
  expect(screen.getByRole('status').textContent).toContain('red limitada');
});
