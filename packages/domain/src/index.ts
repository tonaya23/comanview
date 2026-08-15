/**
 * @comanview/domain
 *
 * Core domain layer — entities, value objects, invariants, domain events.
 *
 * ARCHITECTURE CONSTRAINT: This package MUST have ZERO dependencies on:
 * Fastify, React, Next.js, Vite, Drizzle, SQLite, PostgreSQL, AWS.
 *
 * Domain behavior is implemented here once the PRD is complete.
 * @see Master_PRD.md
 */

export * from './shared/EntityId.js';
export * from './shared/DomainError.js';
export * from './catalog/index.js';
export * from './order/index.js';
