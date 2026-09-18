import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import {
  CatalogBaselinePayloadSchema,
  CatalogMutationPayloadSchema,
  canonicalCatalogJson,
  type CatalogProjectedEntity,
} from '@comanview/contracts';
import type { ClaimedCloudEvent } from './CloudProjectionRepository.js';

/** Runs under the Inbox lease transaction. Catalog buffers missing generations independently
 * of operational projections; never changes the shared Sync epoch/ordering protocol. */
export async function applyCatalogProjection(
  client: PoolClient,
  event: ClaimedCloudEvent,
  version: number,
) {
  const baseline = event.eventType.startsWith('CATALOG_BASELINE_');
  const payload = baseline
    ? CatalogBaselinePayloadSchema.parse(event.payload)
    : CatalogMutationPayloadSchema.parse(event.payload);
  if (
    payload.edgeId !== event.edgeId ||
    payload.tenantId !== event.tenantId ||
    payload.locationId !== event.locationId
  )
    throw new Error('CATALOG_BINDING_MISMATCH');
  // Restore may re-envelope pending legacy events. They are historical evidence, not a new capture.
  const key = [version, event.edgeId, event.recoveryEpoch];
  await client.query(
    `INSERT INTO cloud_catalog_checkpoint(projection_version,edge_id,tenant_id,location_id,recovery_epoch,source_sequence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [
      version,
      event.edgeId,
      event.tenantId,
      event.locationId,
      event.recoveryEpoch,
      event.localSequence,
    ],
  );
  const locked = await client.query<{
    recovery_epoch: string;
    generation: string | null;
    baseline_id: string | null;
    tenant_id: string;
    location_id: string;
  }>(
    'SELECT * FROM cloud_catalog_checkpoint WHERE projection_version=$1 AND edge_id=$2 FOR UPDATE',
    key.slice(0, 2),
  );
  const cp = locked.rows[0]!;
  if (cp.tenant_id !== event.tenantId || cp.location_id !== event.locationId)
    throw new Error('CATALOG_BINDING_MISMATCH');
  if (Number(cp.recovery_epoch) > event.recoveryEpoch) return;
  if (Number(cp.recovery_epoch) < event.recoveryEpoch) {
    // Old read model is not current once a new epoch is observed; history/inbox remain intact.
    await client.query(
      'UPDATE cloud_catalog_checkpoint SET recovery_epoch=$3,generation=NULL,baseline_id=NULL,source_sequence=$4 WHERE projection_version=$1 AND edge_id=$2',
      [...key, event.localSequence],
    );
    cp.generation = null;
    cp.baseline_id = null;
  }
  if ('sourceEpoch' in payload && payload.sourceEpoch !== event.recoveryEpoch) return;
  if ('phase' in payload) {
    if (event.aggregateId !== event.edgeId) throw new Error('CATALOG_BASELINE_ENVELOPE_INVALID');
    if (event.eventType !== `CATALOG_BASELINE_${payload.phase}`)
      throw new Error('CATALOG_BASELINE_PHASE_INVALID');
    const { phase, ...rest } = payload;
    const manifest = {
      payloadVersion: rest.payloadVersion,
      tenantId: rest.tenantId,
      locationId: rest.locationId,
      edgeId: rest.edgeId,
      sourceEpoch: rest.sourceEpoch,
      baselineId: rest.baselineId,
      catalogGeneration: rest.catalogGeneration,
      chunkCount: rest.chunkCount,
      entityCount: rest.entityCount,
      digest: rest.digest,
    };
    const sessionKey = [...key, payload.baselineId];
    await client.query(
      'INSERT INTO cloud_catalog_baselines(projection_version,edge_id,recovery_epoch,baseline_id,manifest) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING',
      [...sessionKey, JSON.stringify(manifest)],
    );
    const session = (
      await client.query<{ manifest: unknown; started: boolean; completed: boolean }>(
        'SELECT * FROM cloud_catalog_baselines WHERE projection_version=$1 AND edge_id=$2 AND recovery_epoch=$3 AND baseline_id=$4',
        sessionKey,
      )
    ).rows[0]!;
    if (canonicalCatalogJson(session.manifest) !== canonicalCatalogJson(manifest))
      throw new Error('CATALOG_BASELINE_MANIFEST_CONFLICT');
    if (phase === 'STARTED' || phase === 'COMPLETED') {
      await client.query(
        `UPDATE cloud_catalog_baselines SET ${phase === 'STARTED' ? 'started' : 'completed'}=true WHERE projection_version=$1 AND edge_id=$2 AND recovery_epoch=$3 AND baseline_id=$4`,
        sessionKey,
      );
      if (phase === 'STARTED') session.started = true;
      else session.completed = true;
    } else if (payload.phase === 'CHUNK') {
      if (payload.chunkIndex >= payload.chunkCount)
        throw new Error('CATALOG_BASELINE_CHUNK_INVALID');
      await client.query(
        'INSERT INTO cloud_catalog_chunks VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING',
        [...sessionKey, payload.chunkIndex, JSON.stringify(payload.entities)],
      );
      const existing = (
        await client.query<{ entities: unknown }>(
          'SELECT entities FROM cloud_catalog_chunks WHERE projection_version=$1 AND edge_id=$2 AND recovery_epoch=$3 AND baseline_id=$4 AND chunk_index=$5',
          [...sessionKey, payload.chunkIndex],
        )
      ).rows[0]!;
      if (canonicalCatalogJson(existing.entities) !== canonicalCatalogJson(payload.entities))
        throw new Error('CATALOG_BASELINE_CHUNK_CONFLICT');
    }
    if (session.started && session.completed) {
      const chunks = (
        await client.query<{ chunk_index: number; entities: CatalogProjectedEntity[] }>(
          'SELECT chunk_index,entities FROM cloud_catalog_chunks WHERE projection_version=$1 AND edge_id=$2 AND recovery_epoch=$3 AND baseline_id=$4 ORDER BY chunk_index',
          sessionKey,
        )
      ).rows;
      if (chunks.length === payload.chunkCount) {
        const entities = chunks.flatMap((c) => c.entities);
        if (
          chunks.some((c, i) => c.chunk_index !== i) ||
          entities.length !== payload.entityCount ||
          new Set(entities.map((e) => e.entityType + e.state.id)).size !== entities.length ||
          createHash('sha256').update(canonicalCatalogJson(entities)).digest('hex') !==
            payload.digest
        )
          throw new Error('CATALOG_BASELINE_DIGEST_INVALID');
        const identity = createHash('sha256')
          .update(
            canonicalCatalogJson({
              tenantId: event.tenantId,
              locationId: event.locationId,
              edgeId: event.edgeId,
              recoveryEpoch: event.recoveryEpoch,
              catalogGeneration: payload.catalogGeneration,
              capabilityVersion: 1,
              digest: payload.digest,
            }),
          )
          .digest('hex');
        if (identity !== payload.baselineId) throw new Error('CATALOG_BASELINE_ID_INVALID');
        if (cp.generation === null || payload.catalogGeneration > Number(cp.generation)) {
          await client.query(
            'DELETE FROM cloud_catalog_entities WHERE projection_version=$1 AND edge_id=$2',
            key.slice(0, 2),
          );
          for (const entity of entities) await upsert(client, key, entity);
          cp.generation = String(payload.catalogGeneration);
          cp.baseline_id = payload.baselineId;
        }
      }
    }
  } else {
    if (payload.entityId !== event.aggregateId || payload.entityVersion !== event.aggregateVersion)
      throw new Error('CATALOG_EVENT_ENVELOPE_MISMATCH');
    if (
      !payload.entities.some(
        (e) => e.state.id === payload.entityId && e.state.version === payload.entityVersion,
      )
    )
      throw new Error('CATALOG_ENTITY_VERSION_INVALID');
    await client.query(
      'INSERT INTO cloud_catalog_deltas VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING',
      [...key, payload.catalogGeneration, event.localSequence, JSON.stringify(payload)],
    );
    const stored = (
      await client.query<{ payload: unknown }>(
        'SELECT payload FROM cloud_catalog_deltas WHERE projection_version=$1 AND edge_id=$2 AND recovery_epoch=$3 AND generation=$4',
        [...key, payload.catalogGeneration],
      )
    ).rows[0]!;
    if (canonicalCatalogJson(stored.payload) !== canonicalCatalogJson(payload))
      throw new Error('CATALOG_GENERATION_CONFLICT');
  }
  if (cp.generation !== null) {
    const deltas = (
      await client.query<{ generation: string; payload: unknown }>(
        'SELECT generation,payload FROM cloud_catalog_deltas WHERE projection_version=$1 AND edge_id=$2 AND recovery_epoch=$3 AND generation>$4 ORDER BY generation',
        [...key, cp.generation],
      )
    ).rows;
    for (const delta of deltas) {
      if (Number(delta.generation) !== Number(cp.generation) + 1) break;
      const mutation = CatalogMutationPayloadSchema.parse(delta.payload);
      for (const entity of mutation.entities) {
        const old = (
          await client.query<{ entity_version: string }>(
            'SELECT entity_version FROM cloud_catalog_entities WHERE projection_version=$1 AND edge_id=$2 AND entity_type=$3 AND entity_id=$4',
            [version, event.edgeId, entity.entityType, entity.state.id],
          )
        ).rows[0];
        if (old && Number(old.entity_version) > entity.state.version)
          throw new Error('CATALOG_ENTITY_ROLLBACK');
        await upsert(client, key, entity);
      }
      cp.generation = delta.generation;
    }
  }
  await client.query(
    'UPDATE cloud_catalog_checkpoint SET generation=$3,baseline_id=$4,source_sequence=GREATEST(source_sequence,$5) WHERE projection_version=$1 AND edge_id=$2',
    [version, event.edgeId, cp.generation, cp.baseline_id, event.localSequence],
  );
}
async function upsert(
  client: PoolClient,
  key: (string | number)[],
  entity: CatalogProjectedEntity,
) {
  await client.query(
    `INSERT INTO cloud_catalog_entities(projection_version,edge_id,recovery_epoch,entity_type,entity_id,entity_version,public_state) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(projection_version,edge_id,entity_type,entity_id) DO UPDATE SET recovery_epoch=EXCLUDED.recovery_epoch,entity_version=EXCLUDED.entity_version,public_state=EXCLUDED.public_state`,
    [
      ...key,
      entity.entityType,
      entity.state.id,
      entity.state.version,
      JSON.stringify(entity.state),
    ],
  );
}
