import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DeviceOnboardingCard, type DeviceOnboardingState } from '@comanview/ui';

describe('KDS Device onboarding',()=>{
  it.each([
    ['UNREGISTERED','Emparejar dispositivo'],
    ['PENDING','Código temporal'],
    ['ACTIVE','Dispositivo autorizado'],
    ['REVOKED','Emparejar nuevamente'],
  ] as const)('renders %s with the appropriate visual action',(state,expected)=>{
    const html=renderToString(createElement(DeviceOnboardingCard,props(state)));
    expect(html).toContain(expected);
    if(state==='ACTIVE')expect(html).not.toContain('Emparejar dispositivo');
    if(state==='PENDING')expect(html).toContain('123456');
  });
});
function props(state:DeviceOnboardingState){return {productLabel:'KDS',state,displayName:'KDS Cocina',pairingCode:'123456',
  pairingId:'01991a00-0000-7000-8000-000000000401',expiresAt:'2099-08-29T12:10:00.000Z',
  pending:false,onDisplayName:vi.fn(),onPair:vi.fn(),onRetry:vi.fn()};}
