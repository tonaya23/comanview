import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CloudPlan, LocationLicenseAssignment } from '@comanview/contracts';
import { LocationCommercialSummary, formatDeviceLimit } from './LocationCommercialSummary.js';

const plan:CloudPlan={planId:'01991a00-0000-7000-8000-000000000101',code:'RESTAURANT_PRO',displayName:'Restaurant Pro',active:true,
  capabilities:['CORE_POS','KDS'],deviceLimits:{POS:9,WAITER:9,KDS:9},revision:7,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z'};
const license:LocationLicenseAssignment={tenantId:'01991a00-0000-7000-8000-000000000201',locationId:'01991a00-0000-7000-8000-000000000202',
  planId:plan.planId,planCode:plan.code,declaredState:'ACTIVE',revision:4,capabilities:['CORE_POS','TABLE_SERVICE','KDS','PRINTING'],
  deviceLimits:{POS:2,WAITER:null,KDS:1},configuration:{payment:{tipsEnabled:true,tipPercentageOptionsBasisPoints:[1000]}},configurationRevision:3,updatedAt:'2026-01-03T00:00:00.000Z'};

describe('Location commercial summary',()=>{
  it('separates assigned Plan identity from the effective authorized License snapshot',()=>{
    const html=renderToString(<LocationCommercialSummary plan={plan} license={license}/>);
    expect(html).toContain('Plan asignado');expect(html).toContain('Restaurant Pro');expect(html).toContain('RESTAURANT_PRO');expect(html).toContain('Plan activo');
    expect(html).toContain('Licencia autorizada por Cloud');expect(html).toContain('Activa');expect(html).toMatch(/Revisión[^<]*<!-- -->4/);
    expect(html).toContain('POS');expect(html).toContain('>2<');expect(html).toContain('WAITER');expect(html).toContain('Ilimitado');expect(html).toContain('KDS');expect(html).toContain('>1<');
    expect(html).toContain('Servicio en mesa');expect(html).toContain('Impresión');
    expect(html).not.toContain('signature');expect(html).not.toContain('credential');expect(html).not.toContain('protected');
    expect(html).not.toContain('>9<');
  });

  it('renders zero and null limits with their real semantics',()=>{
    expect(formatDeviceLimit(null)).toBe('Ilimitado');
    expect(formatDeviceLimit(0)).toBe('No incluido');
    expect(formatDeviceLimit(3)).toBe('3');
    const html=renderToString(<LocationCommercialSummary plan={plan} license={{...license,deviceLimits:{POS:0,WAITER:0,KDS:null}}}/>);
    expect(html.match(/No incluido/g)).toHaveLength(2);expect(html).toContain('Ilimitado');
  });
});
