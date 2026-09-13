import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect,vi } from 'vitest';
import type { EdgeClient } from '@comanview/client-sdk';
import type { OrderResponse } from '@comanview/contracts';
import { PersonnelPinDialog,validPersonnelPin } from './PersonnelPinDialog.js';
import { CashRegisterCreateAction,administrationErrorMessage,cashRegisterCreationIssue } from './AdministrationPanel.js';
import { EdgeClientError } from '@comanview/client-sdk';
import { AdministrationDrafts,administrationSections,loadAdministrationResources } from './administrationLoading.js';
import { discardCounterSale,openCurrentCounterSale,isDiscardableCounterSale } from './counterSales.js';

describe('1W functional hardening',()=>{
  it.each([true,false])('masks every PIN input (current PIN required: %s)',requireCurrent=>{
    const html=renderToStaticMarkup(createElement(PersonnelPinDialog,{requireCurrent,onSubmit:vi.fn(),onCancel:vi.fn()}));
    const inputs=html.match(/<input\b[^>]*>/g)??[];
    expect(inputs).toHaveLength(requireCurrent?2:1);
    for(const input of inputs){expect(input).toContain('type="password"');expect(input).toContain('maxLength="12"');expect(input).toContain('value=""');}
    expect(validPersonnelPin('1234')).toBe(true);expect(validPersonnelPin('123456789012')).toBe(true);
    for(const value of ['123','1234567890123','12ab',' 1234'])expect(validPersonnelPin(value)).toBe(false);
  });
  it('keeps independent drafts dirty across navigation and unrelated confirmed actions',()=>{
    const drafts=new AdministrationDrafts();
    drafts.mark('profile');drafts.mark('currency');drafts.mark('day');
    drafts.saved('day');
    expect(drafts.has('profile')).toBe(true);expect(drafts.has('currency')).toBe(true);
    expect(drafts.has('day')).toBe(false);expect(drafts.dirty).toBe(true);
    drafts.saved();expect(drafts.dirty).toBe(true);
    let profile={name:'Borrador de B',version:1};
    drafts.refresh('profile',()=>{profile={name:'Servidor',version:2};});
    expect(profile).toEqual({name:'Borrador de B',version:1});
    drafts.saved('profile');
    drafts.refresh('profile',()=>{profile={name:'Guardado autoritativo',version:3};});
    expect(profile).toEqual({name:'Guardado autoritativo',version:3});
  });
  it('requires persisted currency before creating a cash register and explains the Edge fallback',()=>{
    expect(cashRegisterCreationIssue(null,'Caja principal')).toBe('Establece y guarda primero la moneda en Día y moneda para crear una caja.');
    expect(cashRegisterCreationIssue('MXN','   ')).toBe('Escribe un nombre para la caja.');
    expect(cashRegisterCreationIssue('MXN','Caja principal')).toBeNull();
    expect(administrationErrorMessage(new EdgeClientError('La configuración no fue modificada.','CURRENCY_REQUIRED',409)))
      .toBe('Establece y guarda primero la moneda en Día y moneda para crear una caja.');
    const blocked=renderToStaticMarkup(createElement(CashRegisterCreateAction,{busy:false,issue:cashRegisterCreationIssue(null,'Caja principal')}));
    expect(blocked).toContain('<button disabled="">');expect(blocked).toContain('guarda primero la moneda');
    const ready=renderToStaticMarkup(createElement(CashRegisterCreateAction,{busy:false,issue:cashRegisterCreationIssue('MXN','Caja principal')}));
    expect(ready).toContain('<button>');expect(ready).not.toContain('disabled');
  });
  it('loads Personnel without calling unauthorized independent endpoints',async()=>{
    const people={users:[],ownerRecoveryRequired:false};
    const edge={getPersonnel:vi.fn().mockResolvedValue(people),getProducts:vi.fn().mockRejectedValue(new Error('403')),
      getRestaurantAdministration:vi.fn(),getTaxAdministration:vi.fn(),getEdgeConfiguration:vi.fn()} as unknown as EdgeClient;
    const result=await loadAdministrationResources(edge,['PERSONNEL_VIEW']);
    expect(result.people).toEqual({status:'fulfilled',value:people});
    expect(edge.getProducts).not.toHaveBeenCalled();expect(edge.getRestaurantAdministration).not.toHaveBeenCalled();
    expect(administrationSections(['PERSONNEL_VIEW'])).toEqual([7]);
  });
  it('isolates an authorized resource failure from Personnel',async()=>{
    const edge={getPersonnel:vi.fn().mockResolvedValue({users:[]}),getProducts:vi.fn().mockRejectedValue(new Error('403')),
      getRestaurantAdministration:vi.fn().mockRejectedValue(new Error('unavailable')),getTaxAdministration:vi.fn().mockResolvedValue(null),getEdgeConfiguration:vi.fn().mockResolvedValue(null)} as unknown as EdgeClient;
    const result=await loadAdministrationResources(edge,['PERSONNEL_VIEW','ADMINISTRATION_VIEW','CATALOG_VIEW']);
    expect(result.people.status).toBe('fulfilled');expect(result.products.status).toBe('rejected');
  });
  const sale={id:'sale',version:3,orderType:'COUNTER',status:'OPEN',items:[],rounds:[],payments:[]} as unknown as OrderResponse;
  it('selects only a freshly fetched open sale',async()=>{
    const edge={getOrder:vi.fn().mockResolvedValue({...sale,version:8})};
    expect((await openCurrentCounterSale(edge,sale.id)).version).toBe(8);
    expect(edge.getOrder).toHaveBeenCalledWith(sale.id);
    edge.getOrder.mockResolvedValue({...sale,status:'CLOSED'});
    await expect(openCurrentCounterSale(edge,sale.id)).rejects.toThrow('ya no está abierta');
  });
  it('confirms cancellation before refresh and returns remaining sales without opening them',async()=>{
    const remaining={...sale,id:'other',items:[{}]};
    const confirmed=vi.fn();
    const edge={cancelOrder:vi.fn().mockResolvedValue({...sale,status:'CANCELLED'}),getOpenCounterOrders:vi.fn().mockImplementation(async()=>{
      expect(confirmed).toHaveBeenCalledOnce();return [remaining];})};
    const result=await discardCounterSale(edge,sale,confirmed);
    expect(edge.cancelOrder).toHaveBeenCalledWith('sale',{expectedVersion:3,emptyCounterOnly:true});
    expect(result).toEqual({remaining:[remaining],refreshFailed:false});
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({id:'sale',status:'CANCELLED'}));
  });
  it('does not report a confirmed cancellation as failed when refresh fails',async()=>{
    const confirmed=vi.fn();
    const edge={cancelOrder:vi.fn().mockResolvedValue({...sale,status:'CANCELLED'}),getOpenCounterOrders:vi.fn().mockRejectedValue(new Error('offline'))};
    expect(await discardCounterSale(edge,sale,confirmed)).toEqual({remaining:null,refreshFailed:true});
    expect(confirmed).toHaveBeenCalledOnce();
  });
  it('requires a completely empty open COUNTER sale before discard',async()=>{
    const edge={cancelOrder:vi.fn(),getOpenCounterOrders:vi.fn()};
    for(const invalid of [{...sale,items:[{}]},{...sale,rounds:[{}]},{...sale,payments:[{}]},{...sale,orderType:'TABLE'},{...sale,status:'CLOSED'}]){
      expect(isDiscardableCounterSale(invalid as OrderResponse)).toBe(false);
      await expect(discardCounterSale(edge,invalid as OrderResponse,vi.fn())).rejects.toThrow('Solo puedes');
    }
    expect(edge.cancelOrder).not.toHaveBeenCalled();
  });
});
