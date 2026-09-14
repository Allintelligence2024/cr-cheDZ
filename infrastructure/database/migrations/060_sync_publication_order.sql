-- F3c: allocate a sequence ONLY AFTER the tenant's publication lock is held.
-- BIGSERIAL's default runs before a BEFORE-row trigger, so it must be removed.
-- No edit to 006/059. Publication order is per tenant, not a global writer lock.
LOCK TABLE sync_changelog IN ACCESS EXCLUSIVE MODE;
ALTER TABLE sync_changelog ALTER COLUMN sync_seq DROP DEFAULT;
-- Upgrade under lock: catch up with any historical explicit sequence allocation.
SELECT setval('sync_changelog_sync_seq_seq', GREATEST(
  (SELECT last_value FROM sync_changelog_sync_seq_seq),
  COALESCE((SELECT MAX(sync_seq) FROM sync_changelog),1)
), true);

CREATE FUNCTION sync_changelog_publish() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp
AS $$
DECLARE
  privileged boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_roles WHERE rolname=current_user;
  IF TG_OP <> 'INSERT' THEN
    IF NOT privileged THEN
      RAISE EXCEPTION 'SYNC_LOG_APPEND_ONLY' USING ERRCODE='42501';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF NOT privileged THEN
    -- Check before taking another tenant's lock, not only in the later RLS check.
    IF NEW.organization_id IS DISTINCT FROM app_tenant_id() THEN
      RAISE EXCEPTION 'SYNC_PUBLICATION_TENANT_MISMATCH' USING ERRCODE='42501';
    END IF;
    IF NEW.sync_seq IS NOT NULL THEN
      RAISE EXCEPTION 'SYNC_SEQUENCE_SERVER_ASSIGNED' USING ERRCODE='42501';
    END IF;
  END IF;
  -- Held to COMMIT/ROLLBACK. Each tenant's committed rows form a visible prefix.
  -- Other tenants can continue; rollbacks consume harmless sequence gaps.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,48273));
  IF NEW.sync_seq IS NULL THEN
    NEW.sync_seq := nextval('sync_changelog_sync_seq_seq');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_changelog_publish
BEFORE INSERT OR UPDATE OR DELETE ON sync_changelog
FOR EACH ROW EXECUTE FUNCTION sync_changelog_publish();

COMMENT ON FUNCTION sync_changelog_publish() IS
  'App writers: tenant-serialized allocation, append-only. Explicit IDs/edits by BYPASSRLS operators require maintenance; never a normal publication path.';
