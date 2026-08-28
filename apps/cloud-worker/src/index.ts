import { randomUUID } from 'node:crypto';
import { loadCloudWorkerConfig } from '@comanview/config';
import { CloudProjectionRepository, createCloudDatabase } from '@comanview/database';
import { CloudProjectionWorker } from './projections/CloudProjectionWorker.js';

const logger = {
  info: (object: object, message: string) => console.info(message, object),
  warn: (object: object, message: string) => console.warn(message, object),
  error: (object: object, message: string) => console.error(message, object),
};

export async function startCloudWorker(environment: NodeJS.ProcessEnv = process.env) {
  const config = loadCloudWorkerConfig(environment);
  const database = createCloudDatabase(config.databaseUrl);
  const repository = new CloudProjectionRepository(database.pool);
  const worker = new CloudProjectionWorker(repository, config, randomUUID(), logger);
  return { config, database, repository, worker };
}

async function main(): Promise<void> {
  const runtime = await startCloudWorker();
  const replay = process.argv.includes('--replay');
  const once = process.argv.includes('--once');
  if (replay) {
    await runtime.repository.resetProjectionVersion(runtime.config.projectionVersion);
    const processed = await runtime.worker.drain();
    logger.info(
      { projectionVersion: runtime.config.projectionVersion, processed },
      'Cloud projection replay completed',
    );
    await runtime.database.close();
    return;
  }
  if (once) {
    await runtime.worker.runOnce();
    await runtime.database.close();
    return;
  }
  runtime.worker.start();
  logger.info(
    { projectionVersion: runtime.config.projectionVersion },
    'ComanView Cloud Worker started',
  );
  const shutdown = async () => {
    runtime.worker.stop();
    await runtime.database.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

const invokedPath = process.argv[1]?.replace(/\\/g, '/');
if (
  invokedPath?.endsWith('/apps/cloud-worker/src/index.ts') ||
  invokedPath?.endsWith('/apps/cloud-worker/dist/index.js')
) {
  await main();
}
