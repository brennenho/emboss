-- Addresses belong to one resource for their lifetime. When earlier releases
-- reused an address, preserve the current owner, then the most recent tombstone.
CREATE TABLE resource_addresses (
  kind TEXT NOT NULL CHECK(kind IN ('link','paste','file')),
  slug TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','retired')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(kind,slug)
);
--> statement-breakpoint
CREATE INDEX address_owner ON resource_addresses(resource_id,state);
--> statement-breakpoint
INSERT INTO resource_addresses(kind,slug,resource_id,state,created_at)
SELECT kind,slug,id,'active',created_at FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY kind,slug
    ORDER BY (deleted_at IS NULL) DESC,updated_at DESC,id DESC
  ) AS rank FROM resources
) WHERE rank=1;
--> statement-breakpoint
CREATE TRIGGER reserve_resource_address AFTER INSERT ON resources BEGIN
  INSERT INTO resource_addresses(kind,slug,resource_id,created_at)
  VALUES(NEW.kind,NEW.slug,NEW.id,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER check_resource_address BEFORE UPDATE OF slug ON resources
WHEN NEW.slug != OLD.slug AND EXISTS(
  SELECT 1 FROM resource_addresses
  WHERE kind=NEW.kind AND slug=NEW.slug AND resource_id!=NEW.id
) BEGIN
  SELECT RAISE(ABORT,'ADDRESS_RESERVED');
END;
--> statement-breakpoint
CREATE TRIGGER rename_resource_address AFTER UPDATE OF slug ON resources
WHEN NEW.slug != OLD.slug BEGIN
  INSERT INTO resource_addresses(kind,slug,resource_id,created_at)
  VALUES(NEW.kind,NEW.slug,NEW.id,NEW.updated_at)
  ON CONFLICT(kind,slug) DO UPDATE SET state='active'
  WHERE resource_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER immutable_address_owner BEFORE UPDATE OF kind,slug,resource_id ON resource_addresses
WHEN NEW.kind!=OLD.kind OR NEW.slug!=OLD.slug OR NEW.resource_id!=OLD.resource_id BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ADDRESS_OWNER');
END;
--> statement-breakpoint
CREATE TRIGGER retain_resource_address BEFORE DELETE ON resource_addresses BEGIN
  SELECT RAISE(ABORT,'ADDRESS_RESERVED');
END;
--> statement-breakpoint
ALTER TABLE resources ADD COLUMN purge_after INTEGER;
--> statement-breakpoint
ALTER TABLE resources ADD COLUMN purged_at INTEGER;
--> statement-breakpoint
ALTER TABLE blobs ADD COLUMN purge_started_at INTEGER;
--> statement-breakpoint
UPDATE resources SET purge_after=COALESCE(
  (SELECT b.purge_after FROM files f JOIN blobs b ON b.id=f.blob_id WHERE f.resource_id=resources.id),
  deleted_at+2592000000
) WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
UPDATE resources SET purged_at=deleted_at WHERE deleted_at IS NOT NULL AND (
  (kind='link' AND NOT EXISTS(SELECT 1 FROM links WHERE resource_id=resources.id)) OR
  (kind='paste' AND NOT EXISTS(SELECT 1 FROM pastes WHERE resource_id=resources.id)) OR
  (kind='file' AND EXISTS(SELECT 1 FROM files f JOIN blobs b ON b.id=f.blob_id WHERE f.resource_id=resources.id AND b.state='purged'))
);
--> statement-breakpoint
CREATE INDEX resource_trash ON resources(deleted_at,purged_at,purge_after);
