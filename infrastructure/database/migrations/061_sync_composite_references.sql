-- F closure: protect direct SQL writes, not only the HTTP device guard.
-- Additive, transactional, fully validated: legacy inconsistencies abort this
-- migration rather than silently moving/deleting another user's sync history.
-- Maintenance window required; stop API/worker writers before upgrading.
ALTER TABLE devices
  ADD CONSTRAINT devices_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT devices_org_id_owner_unique UNIQUE (organization_id, id, registered_by),
  ADD CONSTRAINT devices_owner_membership_fk FOREIGN KEY (organization_id, registered_by)
    REFERENCES memberships (organization_id, user_id);

ALTER TABLE sync_operations
  ADD CONSTRAINT sync_operations_device_owner_fk FOREIGN KEY (organization_id, device_id, user_id)
    REFERENCES devices (organization_id, id, registered_by);
ALTER TABLE sync_cursors
  ADD CONSTRAINT sync_cursors_device_tenant_fk FOREIGN KEY (organization_id, device_id)
    REFERENCES devices (organization_id, id);
ALTER TABLE sync_changelog
  ADD CONSTRAINT sync_changelog_origin_tenant_fk FOREIGN KEY (organization_id, origin_device_id)
    REFERENCES devices (organization_id, id);

-- Null origin is intentional for HTTP/server-generated events. Registered-by
-- may be null on a pre-registration device, but such a device cannot own an
-- operation (all three referencing columns on sync_operations are NOT NULL).
-- No cascades: changing/removing a device or membership must not erase history.
