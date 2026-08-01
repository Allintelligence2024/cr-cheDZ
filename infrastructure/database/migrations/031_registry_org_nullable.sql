-- ============================================================================
-- 031_registry_org_nullable.sql
-- Le registre des traitements porte des lignes « modèle » globales
-- (organization_id NULL, seed 015) : la colonne devient nullable (la FK vers
-- organizations reste). Les lignes NULL sont en lecture seule pour tous les
-- tenants (WITH CHECK de la politique 030 exige organization_id = tenant).
-- ============================================================================

ALTER TABLE processing_registry ALTER COLUMN organization_id DROP NOT NULL;
