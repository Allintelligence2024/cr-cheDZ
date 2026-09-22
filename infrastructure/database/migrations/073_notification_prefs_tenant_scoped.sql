-- ============================================================================
-- 073_notification_prefs_tenant_scoped.sql
-- Remédiation R19 / P3 (2026-09-21) — portée tenant sur notification_preferences.
--
-- Constat : `notification_preferences` (migration 009) référence bien
-- `organization_id` mais la contrainte d'unicité est `(user_id, channel,
-- event_type)` — sans organisation. Un user multi-tenant (directeur de
-- 2 crèches par exemple) ne peut donc avoir qu'UNE préférence par couple
-- (channel, event_type), partagée entre ses tenants — collision silencieuse
-- quand un tenant désactive un canal et l'autre l'active. Risque : un
-- directeur désactive les SMS pour la crèche A dans `quiet_hours_start`,
-- et la crèche B hérite de ce réglage involontairement.
--
-- Correction : on remplace la contrainte UNIQUE par une portée tenant.
-- Avant : `UNIQUE(user_id, channel, event_type)`.
-- Après  : `UNIQUE(organization_id, user_id, channel, event_type)`.
-- Les doublons existants (même user, même (channel, event), 2 orgs) sont
-- possibles : on les dédoublonne en gardant la préférence la plus récente
-- (ORDER BY created_at DESC NULLS LAST, id DESC) avant d'ajouter la
-- nouvelle contrainte. Aucun comportement métier n'est perdu — c'est une
-- déduplication strictement nécessaire.
--
-- C'est aussi l'occasion d'ajouter un index sur (organization_id) seul
-- (pour les requêtes « préférences par tenant »), absent jusque-là.
-- ============================================================================

-- 1. Dédoublonnage des éventuels doublons (un user avec 2 prefs sur le
--    même couple channel/event dans 2 tenants différents) : on garde
--    la ligne la plus récente. La table 009 n'a pas de created_at, on
--    utilise l'ordre d'insertion via id (uuid v4 = timestamp monotone à
--    l'insertion pour les clients du monorepo).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, user_id, channel, event_type
           ORDER BY id DESC
         ) AS rn
  FROM notification_preferences
)
DELETE FROM notification_preferences np
USING ranked r
WHERE np.id = r.id AND r.rn > 1;

-- 2. Suppression de l'ancienne contrainte.
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_user_id_channel_event_type_key;

-- 3. Nouvelle contrainte tenant-scoped.
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_org_user_channel_event_key
  UNIQUE (organization_id, user_id, channel, event_type);

-- 4. Index sur organization_id seul (déjà couvert partiellement par la
--    contrainte unique composite, mais un index explicite sert pour les
--    scans type « WHERE organization_id = $1 AND is_enabled = true »).
CREATE INDEX IF NOT EXISTS idx_notification_preferences_org_enabled
  ON notification_preferences (organization_id, is_enabled)
  WHERE is_enabled = false; -- partiel : ne concerne que les désactivations (rare)

COMMENT ON TABLE notification_preferences IS
  'Préférences de notification par utilisateur × canal × événement × tenant (R19, 2026-09-21). La contrainte UNIQUE inclut organization_id pour qu''un user multi-tenant puisse gérer ses préférences indépendamment par crèche.';
