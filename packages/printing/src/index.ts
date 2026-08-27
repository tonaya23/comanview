/**
 * @comanview/printing
 *
 * PrintJob types and PrinterAdapter abstraction.
 *
 * RULES:
 * - Printer access MUST be behind PrinterAdapter abstractions.
 * - Order, Payment, Cash, and KDS domain code MUST NOT depend directly on ESC/POS libraries.
 * - Every print operation is represented by a durable PrintJob before transmission.
 * - Print queues MUST survive Edge restart.
 * - Printing failures MUST NOT revert successful financial transactions.
 */

export * from './types.js';
export * from './renderer.js';
export * from './DebugPrinterAdapter.js';
export * from './TcpPrinterAdapter.js';
export * from './PrintWorker.js';
export * from './escPosRenderer.js';
export * from './testing/VirtualTcpPrinter.js';
