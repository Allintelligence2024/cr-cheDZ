-- ============================================================================
-- 074_children_org_site_idx.sql
-- Remédiation R19 / P3 (2026-09-21) — index manquant (organization_id, site_id)
-- sur children.
--
-- Constat : la table children (migration 005) a déjà idx_children_org,
-- idx_children_room (org, room), idx_children_status (org, status), mais
-- aucun index (organization_id, site_id). Or, plusieurs requêtes métier
-- filtrent par site : enrollment.service.capacityWith() fait
--   SELECT COUNT(*) FROM children WHERE organization_id=$1 AND site_id=$2 ...
-- sans index composite, c'est un seq scan dès que la crèche grossit.
-- Pire : le filtre sur room_id (idx_children_room) ne suffit pas car la
-- capacité est agrégée AU NIVEAU DU SITE, pas de la salle.
--
-- Migration additive : CREATE INDEX IF NOT EXISTS, aucun impact sur les
-- migrations existantes (ADR-007). Index PARTIEL sur deleted_at IS NULL
-- pour exclure les enfants anonymisés/soft-deleted du balayage.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_children_org_site
  ON children (organization_id, site_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_children_org_site IS
  'R19 (P3, 2026-09-21) — index composite pour les requêtes « enfants d''un site »
  (capacity, liste staff, dashboard). Partiel sur deleted_at IS NULL pour
  exclure les soft-deleted du balayage. Manquant dans 005 alors que les
  requêtes enrollment.capacity, attendance et dashboard l''utilisent.';
