import { isAbsolute } from 'node:path';
import { prepareDevelopmentDatabase, createEdgeDatabase, SyncOutboxRepository } from '@comanview/database';
import { EdgeProvisioningClient } from './modules/provisioning/EdgeProvisioningClient.js';
import { createEdgeSecretStore } from './modules/provisioning/EdgeSecretStore.js';

const code = process.env['COMANVIEW_PROVISIONING_CODE'];
const cloudUrl = process.env['COMANVIEW_CLOUD_URL'];
const databasePath = process.env['COMANVIEW_EDGE_DB_PATH'];
const rotate = process.argv.includes('rotate');
if ((!code && !rotate) || !cloudUrl || !databasePath) {
  throw new Error('COMANVIEW_CLOUD_URL, absolute COMANVIEW_EDGE_DB_PATH, and a provisioning code (unless rotating) are required.');
}
if (!isAbsolute(databasePath)) {
  throw new Error('COMANVIEW_EDGE_DB_PATH must be absolute.');
}
if (process.env['NODE_ENV'] !== 'production') {
  prepareDevelopmentDatabase(databasePath);
}
const database = createEdgeDatabase(databasePath);
try {
  const repository = new SyncOutboxRepository(database.db);
  const client = new EdgeProvisioningClient(repository, createEdgeSecretStore(), cloudUrl);
  if (rotate) {
    const identity = repository.getIdentity();
    const result = await client.rotate(identity.edgeId);
    process.stdout.write(`Edge credential rotation ${result.rotationId} completed.\n`);
  } else {
    const edge = await client.provision(code!);
    process.stdout.write(`Edge ${edge.edgeId} activated for Location ${edge.locationId}.\n`);
  }
} finally { database.close(); }
