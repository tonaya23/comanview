import { vi } from 'vitest';
import {
  RestaurantAdministrationStateSchema,
  type ProductResponse,
  type CategoryResponse,
  type TaxAdministrationState,
} from '@comanview/contracts';
export const ids = {
  product: '01991a00-0000-7000-8000-000000000701',
  category: '01991a00-0000-7000-8000-000000000702',
  tax: '01991a00-0000-7000-8000-000000000703',
  station: '01991a00-0000-7000-8000-000000000704',
  otherTax: '01991a00-0000-7000-8000-000000000705',
  otherCategory: '01991a00-0000-7000-8000-000000000706',
};
export const allPermissions = [
  'CATALOG_VIEW',
  'CATALOG_MANAGE',
  'ADMINISTRATION_VIEW',
  'TAX_PROFILE_MANAGE',
  'STATION_MANAGE',
];
export function catalogFixture() {
  const categories: CategoryResponse[] = [
    {
      id: ids.category,
      name: 'Uncategorized',
      systemKey: 'UNCATEGORIZED',
      version: 1,
      displayOrder: 0,
      active: true,
    },
    {
      id: ids.otherCategory,
      name: 'Category',
      systemKey: null,
      version: 2,
      displayOrder: 1,
      active: true,
    },
  ];
  const products: ProductResponse[] = [
    {
      id: ids.product,
      name: 'Café',
      description: 'Caliente',
      sku: 'CAFE',
      barcode: '123456',
      categoryId: ids.category,
      productType: 'STANDARD',
      basePrice: { amount: 10000, currency: 'MXN' },
      taxProfile: {
        id: ids.tax,
        name: 'IVA',
        rateBasisPoints: 1600,
        calculationMode: 'TAX_ADDED',
        active: true,
        revision: 1,
      },
      stationId: null,
      displayOrder: 0,
      active: true,
      available: true,
      version: 4,
      modifierGroups: [],
    },
  ];
  const tax: TaxAdministrationState = {
    fiscalPolicyVersion: 1,
    configurationVersion: 1,
    defaultTaxProfileId: ids.tax,
    products: [],
    profiles: [
      {
        id: ids.tax,
        name: 'IVA',
        rateBasisPoints: 1600,
        calculationMode: 'TAX_ADDED',
        active: true,
        version: 1,
      },
      {
        id: ids.otherTax,
        name: 'Exento',
        rateBasisPoints: 0,
        calculationMode: 'TAX_ADDED',
        active: true,
        version: 2,
      },
    ],
  };
  const admin = RestaurantAdministrationStateSchema.parse({
    businessProfile: {
      commercialName: 'Restaurante',
      legalName: null,
      phone: null,
      email: null,
      address: {},
      operatingHours: [],
      logo: null,
      confirmed: true,
      version: 1,
    },
    operational: {
      timeZone: 'America/Matamoros',
      rollover: '04:00',
      businessDayVersion: 1,
      currency: 'MXN',
      currencyLocked: false,
      defaultCashRegisterId: null,
      defaultTaxProfileId: ids.tax,
      fiscalPolicyVersion: 1,
      tipPreferences: null,
      version: 1,
    },
    cashRegisters: [],
    stations: [
      {
        id: ids.station,
        name: 'Cocina',
        purpose: 'KITCHEN',
        kdsVisible: true,
        active: true,
        displayOrder: 0,
        version: 2,
      },
    ],
    zones: [],
    tables: [],
  });
  const state = { recoveryEpoch: 0, catalogGeneration: 1 };
  const edge = {
    getProducts: vi.fn(async () => products.map((p) => ({ ...p }))),
    getCategories: vi.fn(async () => categories.map((c) => ({ ...c }))),
    getCatalogState: vi.fn(async () => ({ ...state })),
    getRestaurantAdministration: vi.fn(async () => admin),
    getTaxAdministration: vi.fn(async () => tax),
    catalogCommand: vi.fn(async () => ({ version: 5, entities: [], changed: true })),
    executeTaxAdministration: vi.fn(async () => ({ version: 6 })),
    executeRestaurantAdministration: vi.fn(async () => ({ version: 7 })),
  };
  return { categories, products, tax, admin, state, edge };
}
