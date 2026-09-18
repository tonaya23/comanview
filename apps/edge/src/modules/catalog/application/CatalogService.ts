import { AppError } from '../../../app/errorHandler.js';
import { CatalogRepository } from '@comanview/database';
import { Product, EntityId } from '@comanview/domain';
import {
  CreateProductRequest,
  SetProductAvailabilityRequest,
  ProductResponse,
} from '@comanview/contracts';

// Legacy reads remain compatible; all commercial writes require CatalogCommandService.
export class CatalogService {
  constructor(private readonly catalogRepo: CatalogRepository) {}

  async createProduct(request: CreateProductRequest): Promise<ProductResponse> {
    throw new AppError('CLIENT_CAPABILITY_REQUIRED',409,'Use catalog commands.');
  }

  async getProduct(id: string): Promise<ProductResponse | null> {
    const product = this.catalogRepo.getProductById(EntityId.fromString(id));
    if (!product) return null;
    return this.mapToResponse(product);
  }

  async getAllProducts(): Promise<ProductResponse[]> {
    const products = this.catalogRepo.getAllProducts();
    return products.map((p) => this.mapToResponse(p));
  }

  async getAllCategories(): Promise<{ id: string; name: string; active: boolean }[]> {
    return this.catalogRepo.getAllCategories();
  }

  async setProductAvailability(
    id: string,
    request: SetProductAvailabilityRequest,
  ): Promise<ProductResponse | null> {
    throw new AppError('CLIENT_CAPABILITY_REQUIRED',409,'Use catalog commands.');
  }

  private mapToResponse(product: Product): ProductResponse {
    return {
      version:this.catalogRepo.getProductVersion(product.id.toString()),
      id: product.id.toString(),
      name: product.name,
      description: product.description,
      productType: product.productType,
      categoryId: product.categoryId?.toString() ?? null,
      taxProfile: {
        id: product.taxProfile.id.toString(),
        name: product.taxProfile.name,
        rateBasisPoints: product.taxProfile.rateBasisPoints,
        calculationMode: product.taxProfile.calculationMode,
        active: product.taxProfile.active,
        revision: product.taxProfile.revision,
      },
      basePrice: {
        amount: product.basePrice.amount,
        currency: product.basePrice.currency,
      },
      stationId: product.stationId?.toString() ?? null,
      sku: product.sku,
      barcode: product.barcode,
      displayOrder: product.displayOrder,
      active: product.active,
      available: product.available,
      modifierGroups: product.modifierGroups.map((pmg) => ({
        displayOrder: pmg.displayOrder,
        modifierGroup: {
          id: pmg.modifierGroup.id.toString(),
          name: pmg.modifierGroup.name,
          minSelections: pmg.modifierGroup.minSelections,
          maxSelections: pmg.modifierGroup.maxSelections,
          active: pmg.modifierGroup.active,
          options: pmg.modifierGroup.options.map((o) => ({
            id: o.id.toString(),
            name: o.name,
            defaultPriceDelta: {
              amount: o.defaultPriceDelta.amount,
              currency: o.defaultPriceDelta.currency,
            },
            active: o.active,
            available: o.available,
            displayOrder: o.displayOrder,
          })),
        },
        priceDeltaOverrides: Object.fromEntries(
          pmg.modifierGroup.options.flatMap((option) => {
            const override = pmg.getPriceOverride(option.id);
            return override ? [[option.id.toString(), override.toJSON()]] : [];
          }),
        ),
      })),
    };
  }
}
