-- Edge-authoritative read model. No authoring or operational tables.
CREATE TABLE cloud_catalog_checkpoint (
 projection_version integer NOT NULL, edge_id uuid NOT NULL REFERENCES edges(edge_id),
 tenant_id uuid NOT NULL, location_id uuid NOT NULL, recovery_epoch bigint NOT NULL,
 generation bigint, baseline_id text, source_sequence bigint NOT NULL,
 PRIMARY KEY(projection_version,edge_id)
);
CREATE TABLE cloud_catalog_entities (
 projection_version integer NOT NULL, edge_id uuid NOT NULL REFERENCES edges(edge_id),
 entity_type text NOT NULL CHECK(entity_type IN ('PRODUCT','CATEGORY')),entity_id uuid NOT NULL,
 recovery_epoch bigint NOT NULL,entity_version bigint NOT NULL,public_state jsonb NOT NULL,
 PRIMARY KEY(projection_version,edge_id,entity_type,entity_id)
);
CREATE TABLE cloud_catalog_baselines (
 projection_version integer NOT NULL,edge_id uuid NOT NULL REFERENCES edges(edge_id),
 recovery_epoch bigint NOT NULL,baseline_id text NOT NULL,manifest jsonb NOT NULL,
 started boolean NOT NULL DEFAULT false,completed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(projection_version,edge_id,recovery_epoch,baseline_id)
);
CREATE TABLE cloud_catalog_chunks (
 projection_version integer NOT NULL,edge_id uuid NOT NULL,recovery_epoch bigint NOT NULL,
 baseline_id text NOT NULL,chunk_index integer NOT NULL,entities jsonb NOT NULL,
 PRIMARY KEY(projection_version,edge_id,recovery_epoch,baseline_id,chunk_index),
 FOREIGN KEY(projection_version,edge_id,recovery_epoch,baseline_id) REFERENCES cloud_catalog_baselines ON DELETE CASCADE
);
CREATE TABLE cloud_catalog_deltas (
 projection_version integer NOT NULL,edge_id uuid NOT NULL REFERENCES edges(edge_id),
 recovery_epoch bigint NOT NULL,generation bigint NOT NULL,source_sequence bigint NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(projection_version,edge_id,recovery_epoch,generation)
);
