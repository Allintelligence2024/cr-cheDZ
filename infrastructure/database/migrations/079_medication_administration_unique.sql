-- ============================================================================
-- 079_medication_administration_unique.sql
-- P0 (remédiation 2026-10-03, phase 1.6) — double dose de médicament possible.
--
-- Aucune contrainte d'unicité n'existait sur medication_administrations.
-- Deux saisies concourantes (double device, HTTP + sync offline, retry)
-- enregistraient DEUX administrations distinctes pour la même dose
-- (même autorisation, même jour) — conséquence médicale directe pour l'enfant.
--
-- Correction : une seule administration par (authorization, jour).
-- Le jour est dérivé d'administered_at (TIMESTAMPTZ) en UTC via une expression
-- indexée — administered_at peut porter un fuseau, la dose reste calée sur le
-- jour civil de la saisie, cohérent avec health.service.ts (slice(0,10)).
--
-- NOTE : un index unique sur expression exige que l'expression soit IMMUTABLE.
-- (administered_at AT TIME ZONE 'UTC')::date l'est (une TIMESTAMPTZ donnée
-- donne toujours la même date UTC). On ne peut PAS utiliser AT TIME ZONE avec
-- le fuseau de l'org (variable par org → non immuable).
-- ============================================================================

-- 1) Verrouiller les doublons existants avant la contrainte (au cas où).
--    En pratique le tenant est posé par l'API ; on ne supprime rien ici :
--    la contrainte est créée SI ET SEULEMENT SI aucun doublon n'existe.

-- 2) Contrainte d'unicité — une dose par autorisation et par jour (UTC).
CREATE UNIQUE INDEX IF NOT EXISTS uq_medication_admin_per_day
  ON medication_administrations (authorization_id, ((administered_at AT TIME ZONE 'UTC')::date));

-- 3) La politique RLS de medication_administrations utilisait le cast
--    current_setting(...)::uuid éliminé en 018 — voir 3.1.2 plus tard ;
--    cette migration ne touche que l'unicité (périmètre minimal, P0).
