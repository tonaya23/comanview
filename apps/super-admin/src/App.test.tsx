import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { activateRow, App, statusLabel } from './App.js';
import { InstallationAuthorizationPanel } from './InstallationAuthorizationPanel.js';

describe('Super Admin application smoke', () => {
  it('renders the session restoration boundary before exposing Cloud data', () => {
    expect(renderToString(<App />)).toContain('Restaurando sesión Cloud');
  });

  it('renders the structured first Device authorization flow with contextual status and error', () => {
    const html = renderToString(<InstallationAuthorizationPanel locationName="Sucursal Centro"
      status={{authorizationId:'01991a00-0000-7000-8000-000000000501',status:'ISSUED',
        issuedAt:'2026-08-29T12:00:00.000Z',expiresAt:'2026-08-29T12:10:00.000Z',consumedAt:null}}
      busy={false} error="La autorización no coincide con esta solicitud." onClose={()=>undefined} onSubmit={()=>undefined}/>);
    expect(html).toContain('Autorizar instalación inicial');
    expect(html).toContain('Datos para autorizar este dispositivo');
    expect(html).toContain('Nombre del OWNER inicial');
    expect(html).toContain('ISSUED');
    expect(html).toContain('La autorización no coincide con esta solicitud.');
    expect(html).toContain('disabled');
    expect(html).not.toContain('requestToken');
  });

  it('uses human status language and keyboard activation for interactive administrative rows',()=>{
    expect(statusLabel('ONLINE')).toBe('En línea');
    expect(statusLabel('GRACE_PERIOD')).toBe('Periodo de gracia');
    const action=vi.fn(),preventDefault=vi.fn();
    activateRow({key:'Enter',preventDefault} as never,action);
    expect(action).toHaveBeenCalledOnce();expect(preventDefault).toHaveBeenCalledOnce();
    activateRow({key:'Escape',preventDefault} as never,action);
    expect(action).toHaveBeenCalledOnce();
  });
});
