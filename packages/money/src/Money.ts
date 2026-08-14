export class CurrencyMismatchError extends Error {
  constructor(public readonly currencyA: string, public readonly currencyB: string) {
    super(`Cannot operate on different currencies: ${currencyA} and ${currencyB}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyAmountError extends Error {
  constructor(public readonly amount: number) {
    super(`Invalid money amount: ${amount}. Must be a safe integer representing minor units.`);
    this.name = 'InvalidMoneyAmountError';
  }
}

export class Money {
  public readonly amount: number;
  public readonly currency: string;

  private constructor(amount: number, currency: string) {
    if (!Number.isSafeInteger(amount)) {
      throw new InvalidMoneyAmountError(amount);
    }
    this.amount = amount;
    this.currency = currency.toUpperCase();
  }

  public static fromMinorUnits(amount: number, currency: string): Money {
    return new Money(amount, currency);
  }

  public static zero(currency: string): Money {
    return new Money(0, currency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  public multiply(multiplier: number): Money {
    if (!Number.isInteger(multiplier)) {
      throw new Error(`Multiplier must be an integer, got: ${multiplier}`);
    }
    return new Money(this.amount * multiplier, this.currency);
  }

  public equals(other: Money): boolean {
    if (this.currency !== other.currency) {
      return false;
    }
    return this.amount === other.amount;
  }

  public greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  public greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount >= other.amount;
  }

  public lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount < other.amount;
  }

  public lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount <= other.amount;
  }

  public isZero(): boolean {
    return this.amount === 0;
  }

  public isPositive(): boolean {
    return this.amount > 0;
  }

  public isNegative(): boolean {
    return this.amount < 0;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  public toJSON(): { amount: number; currency: string } {
    return {
      amount: this.amount,
      currency: this.currency,
    };
  }
}
