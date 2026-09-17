import { describe,expect,it } from 'vitest';
import { getUserGuidance } from './guidance.js';
import { navigationTarget } from './navigation.js';
import { UI_STATE_TAXONOMY } from './stateTaxonomy.js';
import { prerequisite, type PrerequisiteStatus } from './prerequisites.js';

describe('shared user guidance',()=>{
  it.each(['PERSONNEL_SECURITY_UNAVAILABLE','PERSONNEL_SECURITY_NOT_INITIALIZED','PERSONNEL_COMMAND_FIELDS_INVALID'])(
    'explains %s without a blind retry or generic fallback',code=>{
      const guidance=getUserGuidance({code,details:{diagnosticId:'req-safe'}});
      expect(guidance.title).not.toBe('No pudimos completar la operación');
      expect(guidance.retryability).toBe(code==='PERSONNEL_SECURITY_UNAVAILABLE'?'retry':'contact-administrator');
      expect(guidance.diagnosticReference).toBe('req-safe');
    });
  it('maps a known ErrorCode to Spanish guidance and a typed target',()=>{
    expect(getUserGuidance('CURRENCY_REQUIRED')).toMatchObject({
      code:'CURRENCY_REQUIRED',title:'Configura primero la moneda',
      action:{target:{surface:'administration',section:'day-currency'}},
    });
  });
  it('applies a partial surface override without duplicating base guidance',()=>{
    const value=getUserGuidance('CURRENCY_REQUIRED',{title:'Moneda pendiente'});
    expect(value.title).toBe('Moneda pendiente');
    expect(value.explanation).toContain('guarda primero la moneda');
    expect(value.action?.target).toEqual(navigationTarget.administration('day-currency'));
  });
  it('allows a surface to suppress an action it cannot resolve locally',()=>{
    expect(getUserGuidance('CURRENCY_REQUIRED',{action:null}).action).toBeUndefined();
  });
  it('uses safe fallbacks and only exposes the allowlisted diagnostic reference',()=>{
    expect(getUserGuidance({code:'UNEXPECTED_TRANSPORT',details:{diagnosticId:'request-42'}})).toMatchObject({
      title:'No pudimos completar la operación',diagnosticReference:'request-42',
    });
    expect(JSON.stringify(getUserGuidance('UNKNOWN_EDGE_ERROR'))).not.toContain('Edge');
  });
});

describe('state and prerequisite semantics',()=>{
  it('keeps distinct semantics for security and operational states',()=>{
    expect(UI_STATE_TAXONOMY['permission-denied'].expectedAction).toBe('request-access');
    expect(UI_STATE_TAXONOMY['missing-prerequisite'].expectedAction).toBe('configure');
    expect(UI_STATE_TAXONOMY.offline.kind).not.toBe(UI_STATE_TAXONOMY.degraded.kind);
    expect(UI_STATE_TAXONOMY['recovery-required'].presentation).toBe('blocking');
    expect(UI_STATE_TAXONOMY['suspended-licensing'].expectedAction).toBe('contact-administrator');
    expect(UI_STATE_TAXONOMY['stale-occ'].expectedAction).toBe('refresh');
  });
  it.each<PrerequisiteStatus>(['complete','missing','blocked','unavailable','not-applicable'])('represents %s prerequisites',status=>{
    expect(prerequisite({key:'currency',label:'Moneda',status}).status).toBe(status);
  });
  it('carries authority and staleness without treating it as business authority',()=>{
    expect(prerequisite({key:'tax',label:'Impuestos',status:'missing',reasonCode:'TAX_CONFIGURATION_REQUIRED',authority:{source:'edge',stale:true}})).toMatchObject({authority:{source:'edge',stale:true}});
  });
});
