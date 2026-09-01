import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CashMovementTypeSelector } from './CashMovementTypeSelector.js';

describe('CashMovementTypeSelector',()=>{
  it.each([['CASH_IN','Entrada'],['CASH_OUT','Salida']] as const)('maps %s to %s and selects only one option',(value,label)=>{
    const html=renderToString(createElement(CashMovementTypeSelector,{value,onChange:vi.fn()}));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(`data-movement-type="${value}"`);
    expect(html).toContain(`${label}</strong>`);
    expect((html.match(/aria-checked="true"/g)??[])).toHaveLength(1);
    expect((html.match(/aria-checked="false"/g)??[])).toHaveLength(1);
    expect(html).toContain(value==='CASH_IN'?'Dinero que entra físicamente a caja.':'Dinero que sale físicamente de caja.');
  });
});
