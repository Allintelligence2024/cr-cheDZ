-- F3b: minimal child projections for ALL table writers, plus a one-time bootstrap.
-- Apply with the migrator, in its transaction. Existing migrations are immutable.
-- The locks cover the bootstrap publication only, NOT general sync commit order.
LOCK TABLE children, sync_changelog IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION sync_child_projection(c children) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', (c).id, 'organization_id', (c).organization_id,
    'site_id', (c).site_id, 'room_id', (c).room_id,
    'first_name_fr', (c).first_name_fr, 'first_name_ar', (c).first_name_ar,
    'last_name_fr', (c).last_name_fr, 'last_name_ar', (c).last_name_ar,
    'date_of_birth', to_char((c).date_of_birth, 'YYYY-MM-DD'),
    'photo_url', (c).photo_url, 'status', (c).status,
    'is_walking', (c).is_walking, 'version', (c).version
  );
$$;

CREATE FUNCTION sync_child_tombstone(c children, removed_at timestamptz, revision bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object('id', (c).id, 'organization_id', (c).organization_id,
    'version', revision, 'deleted_at', removed_at);
$$;

CREATE FUNCTION sync_child_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp
AS $$
DECLARE
  body jsonb;
  kind text;
BEGIN
  -- Physical deletion (where FK permit it) and privileged identity reassignment
  -- invalidate the old scope. Never send its full personal record as a tombstone.
  IF TG_OP = 'DELETE' THEN
    INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload)
    VALUES(OLD.organization_id,'child',OLD.id,'deleted',
      sync_child_tombstone(OLD,clock_timestamp(),OLD.version::bigint+1));
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.id,OLD.organization_id) IS DISTINCT FROM (NEW.id,NEW.organization_id) THEN
      INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload)
      VALUES(OLD.organization_id,'child',OLD.id,'deleted',
        sync_child_tombstone(OLD,clock_timestamp(),OLD.version::bigint+1));
    ELSIF sync_child_projection(OLD) = sync_child_projection(NEW)
       AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    kind := 'deleted';
    body := sync_child_tombstone(NEW,NEW.deleted_at,NEW.version);
  ELSE
    kind := CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END;
    body := sync_child_projection(NEW);
  END IF;
  INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES(NEW.organization_id,'child',NEW.id,kind,body);
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_child_changed
AFTER INSERT OR UPDATE OR DELETE ON children
FOR EACH ROW EXECUTE FUNCTION sync_child_changed();

-- Existing records must not depend on a future edit to become visible offline.
-- Include identity-only tombstones for already deleted records; no c.* or to_jsonb(c).
-- Executed once by the migration registry. The writer locks remain until COMMIT.
INSERT INTO sync_changelog(organization_id,aggregate_type,aggregate_id,event_type,payload)
SELECT c.organization_id,'child',c.id,
  CASE WHEN c.deleted_at IS NULL THEN 'snapshot' ELSE 'deleted' END,
  CASE WHEN c.deleted_at IS NULL THEN sync_child_projection(c)
       ELSE sync_child_tombstone(c,c.deleted_at,c.version) END
FROM children c
ORDER BY c.organization_id,c.id;
