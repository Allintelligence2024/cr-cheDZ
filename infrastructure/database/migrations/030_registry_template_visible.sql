-- ============================================================================
-- 030_registry_template_visible.sql
-- Le registre des traitements contient des lignes « modèle » (organization_id
-- NULL, seed 015) : chaque organisation doit pouvoir lire ces traitements
-- standards pour les compléter. La politique de la migration 004 ne laissait
-- voir que les lignes du tenant → élargissement (DROP + CREATE, jamais
-- d'édition d'une migration appliquée — ADR-007). L'écriture reste réservée
-- aux lignes du tenant (WITH CHECK inchangé).
-- ============================================================================

DROP POLICY IF EXISTS processing_registry_tenant ON processing_registry;
CREATE POLICY processing_registry_tenant ON processing_registry
  USING (
    organization_id IS NULL
    OR organization_id = app_tenant_id()
  )
  WITH CHECK (
    organization_id = app_tenant_id()
  );
