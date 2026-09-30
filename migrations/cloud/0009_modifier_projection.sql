BEGIN;
ALTER TABLE cloud_catalog_entities DROP CONSTRAINT cloud_catalog_entities_entity_type_check;
ALTER TABLE cloud_catalog_entities ADD CONSTRAINT cloud_catalog_entities_entity_type_check
  CHECK(entity_type IN ('PRODUCT','CATEGORY','MODIFIER_GROUP','MODIFIER_OPTION'));
COMMIT;
