import { CatalogRepository } from '@comanview/database';
import { Product, EntityId, TaxProfile, ProductType } from '@comanview/domain';
import { Money } from '@comanview/money';
import { CreateProductRequest, SetProductAvailabilityRequest, ProductResponse } from '@comanview/contracts';

// Simplified for now, only creates REGULAR products without modifiers for testing
export class CatalogService {
  constructor(private readonly catalogRepo: CatalogRepository) {}

  async createProduct(request: CreateProductRequest): Promise<ProductResponse> {
    // We assume the tax profile is fetched or mocked. For now, creating a mock one
    // In a real scenario, we'd load it from the repository.
    const taxProfile = new TaxProfile({
      id: EntityId.fromString(request.taxProfileId),
      name: 'Standard Tax',
      rateBasisPoints: 1600,
      calculationMode: 'TAX_ADDED',
      active: true,
    });

    const product = new Product({
      id: EntityId.generate(),
      name: request.name,
      description: request.description,
      productType: request.productType,
      categoryId: request.categoryId ? EntityId.fromString(request.categoryId) : EntityId.generate(),
      taxProfile,
      basePrice: Money.fromMinorUnits(request.basePrice.amount, request.basePrice.currency),
      stationId: request.stationId ? EntityId.fromString(request.stationId) : null,
      sku: null,
      barcode: null,
      displayOrder: 0,
      active: true,
      available: true,
      modifierGroups: [],
    });

    this.catalogRepo.saveProduct(product);

    return this.mapToResponse(product);
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

  async setProductAvailability(id: string, request: SetProductAvailabilityRequest): Promise<ProductResponse | null> {
    const product = this.catalogRepo.getProductById(EntityId.fromString(id));
    if (!product) return null;

    if (request.available) {
      product.markAsAvailable();
    } else {
      product.markAsUnavailable();
    }

    this.catalogRepo.saveProduct(product);
    return this.mapToResponse(product);
  }

  private mapToResponse(product: Product): ProductResponse {
    return {
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
      modifierGroups: product.modifierGroups.map(pmg => ({
        modifierGroup: {
          id: pmg.modifierGroup.id.toString(),
          name: pmg.modifierGroup.name,
          minSelections: pmg.modifierGroup.minSelections,
          maxSelections: pmg.modifierGroup.maxSelections,
          active: pmg.modifierGroup.active,
          options: pmg.modifierGroup.options.map(o => ({
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
        priceDeltaOverrides: {}, // Simplified for now since domain doesn't expose it
      })),
    };
  }
}
