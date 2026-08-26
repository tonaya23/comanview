export interface EdgeOperationalContext {
  tenantId: string;
  locationId: string;
  cashRegisterId: string;
  operatorId: string;
  currency: string;
  tipsEnabled: boolean;
  tipPercentageOptionsBasisPoints: number[];
}

export const defaultOperationalContext: EdgeOperationalContext = {
  tenantId: '01991a00-0000-7000-8000-000000000301',
  locationId: '01991a00-0000-7000-8000-000000000302',
  cashRegisterId: '01991a00-0000-7000-8000-000000000303',
  operatorId: '01991a00-0000-7000-8000-000000000304',
  currency: 'MXN',
  tipsEnabled: process.env['COMANVIEW_TIPS_ENABLED'] !== 'false',
  tipPercentageOptionsBasisPoints: [1000, 1500, 2000],
};
