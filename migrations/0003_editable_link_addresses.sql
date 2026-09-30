DROP TRIGGER immutable_resource_address;--> statement-breakpoint
CREATE TRIGGER immutable_resource_address
BEFORE UPDATE OF kind,slug ON resources
WHEN NEW.kind != OLD.kind OR (OLD.kind != 'link' AND NEW.slug != OLD.slug)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ADDRESS');
END;
