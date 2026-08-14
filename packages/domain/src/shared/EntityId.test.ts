import { describe, it, expect } from 'vitest';
import { EntityId, InvalidEntityIdError } from './EntityId.js';
import { version as uuidVersion } from 'uuid';

describe('EntityId', () => {
  it('generates a new UUID v7', () => {
    const id = EntityId.generate();
    expect(id).toBeInstanceOf(EntityId);
    expect(typeof id.value).toBe('string');
    expect(uuidVersion(id.value)).toBe(7);
  });

  it('creates an EntityId from a valid string', () => {
    const id = EntityId.generate();
    const recreated = EntityId.fromString(id.value);
    expect(recreated.value).toBe(id.value);
  });

  it('throws an error for an invalid UUID string', () => {
    expect(() => EntityId.fromString('not-a-uuid')).toThrow(InvalidEntityIdError);
  });

  it('checks equality correctly', () => {
    const id1 = EntityId.generate();
    const id1Copy = EntityId.fromString(id1.value);
    const id2 = EntityId.generate();

    expect(id1.equals(id1Copy)).toBe(true);
    expect(id1.equals(id2)).toBe(false);
  });

  it('toString returns the raw value', () => {
    const id = EntityId.generate();
    expect(id.toString()).toBe(id.value);
  });
});
