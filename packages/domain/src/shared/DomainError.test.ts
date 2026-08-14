import { describe, it, expect } from 'vitest';
import { DomainError } from './DomainError.js';

class TestDomainError extends DomainError {
  constructor(message: string) {
    super(message, 'TEST_ERROR_CODE');
  }
}

describe('DomainError', () => {
  it('instantiates correctly with message and code', () => {
    const error = new TestDomainError('Something went wrong');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.message).toBe('Something went wrong');
    expect(error.code).toBe('TEST_ERROR_CODE');
    expect(error.name).toBe('TestDomainError');
  });

  it('captures stack trace', () => {
    const error = new TestDomainError('Error with stack');
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });
});
