import { v7 as uuidv7, validate as validateUuid, version as uuidVersion } from 'uuid';

export class InvalidEntityIdError extends Error {
  constructor(public readonly value: string) {
    super(`Invalid EntityId: ${value}. Must be a valid UUID.`);
    this.name = 'InvalidEntityIdError';
  }
}

export class EntityId {
  public readonly value: string;

  private constructor(value: string) {
    if (!validateUuid(value)) {
      throw new InvalidEntityIdError(value);
    }
    this.value = value;
  }

  public static generate(): EntityId {
    return new EntityId(uuidv7());
  }

  public static fromString(value: string): EntityId {
    return new EntityId(value);
  }

  public equals(other: EntityId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}
