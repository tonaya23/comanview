import { DomainError } from '../shared/DomainError.js';

export class ProductUnavailableError extends DomainError {
  constructor(productId: string) {
    super(`Product ${productId} is not available (86'd).`, 'PRODUCT_UNAVAILABLE');
  }
}

export class ProductInactiveError extends DomainError {
  constructor(productId: string) {
    super(`Product ${productId} is inactive.`, 'PRODUCT_INACTIVE');
  }
}

export class TaxProfileInactiveError extends DomainError {
  constructor(taxProfileId: string) {
    super(`TaxProfile ${taxProfileId} is inactive.`, 'TAX_PROFILE_INACTIVE');
  }
}

export class InvalidModifierSelectionError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_MODIFIER_SELECTION');
  }
}

export class ModifierUnavailableError extends DomainError {
  constructor(modifierId: string) {
    super(`Modifier ${modifierId} is not available.`, 'MODIFIER_UNAVAILABLE');
  }
}

export class ModifierInactiveError extends DomainError {
  constructor(modifierId: string) {
    super(`Modifier ${modifierId} is inactive.`, 'MODIFIER_INACTIVE');
  }
}
