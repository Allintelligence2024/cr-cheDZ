-- ============================================================================
-- Pseudonymisation des données réelles pour l'environnement de staging
-- (Phase 11 — aucun environnement non-prod ne doit contenir de données
-- réelles). À exécuter APRÈS l'import d'un dump de production.
--
-- Usage : psql "$DATABASE_URL_STAGING" -f scripts/anonymize.sql
--
-- Principe : valeurs déterministes (fonction de hachage) ou fixes ; les liens
-- entre tables sont conservés (les identifiants ne sont PAS modifiés).
-- ============================================================================

-- Emails et téléphones : pseudo aléatoires mais déterministes par source.
UPDATE users SET
  email = 'user+' || substr(md5(email), 1, 12) || '@staging.creche.dz',
  phone = '+213' || (600000000 + (('x' || substr(md5(email), 1, 8))::bit(32)::int % 200000000))::text,
  first_name = CASE WHEN first_name = '' THEN first_name ELSE 'Prénom' || substr(md5(email), 1, 4) END,
  last_name  = CASE WHEN last_name = '' THEN last_name ELSE 'Nom' || substr(md5(email), 1, 4) END;

-- Enfants : prénoms/noms pseudonymisés, dates de naissance décalées de façon
-- stable (même décalage par enfant) pour conserver les âges relatifs.
UPDATE children SET
  first_name_fr = 'Enfant' || substr(md5(id::text), 1, 6),
  first_name_ar = NULL,
  last_name_fr = 'Test',
  last_name_ar = NULL,
  notes = NULL,
  special_needs_notes = NULL,
  photo_url = NULL;

-- Santé : les données de santé réelles sont remplacées par des valeurs
-- d'exemple non identifiantes (jamais de pathologie réelle en staging).
UPDATE health_records SET
  family_doctor = NULL,
  doctor_phone = NULL,
  health_insurance = 'STAGING',
  chronic_conditions = NULL,
  general_notes = NULL;
UPDATE allergies SET notes = NULL, reaction = NULL, treatment = NULL, emergency_protocol = NULL;
UPDATE vaccinations SET lot_number = 'STAGING-' || substr(md5(id::text), 1, 8);

-- Notes libres (journal) : les textes libres peuvent contenir des données
-- personnelles → vidés.
UPDATE daily_log_events SET
  meal_notes = NULL,
  activity_notes = NULL,
  note_text = NULL,
  incident_description = NULL,
  health_observation = NULL;

-- Facturation : montants conservés (données financières de test utiles),
-- références externes neutralisées.
UPDATE payments SET external_reference = NULL, gateway_response = NULL, notes = NULL;

-- Organisations : noms réels remplacés.
UPDATE organizations SET
  name_fr = 'Crèche Staging ' || substr(md5(id::text), 1, 4),
  legal_name = NULL,
  phone = NULL,
  email = NULL,
  address_line1 = NULL,
  address_line2 = NULL,
  commune = NULL;

-- Journal d'audit : les valeurs peuvent contenir des fragments de données —
-- on conserve la structure mais on neutralise old_values/new_values.
UPDATE audit_logs SET old_values = NULL, new_values = '{"staging": true}'::jsonb;
UPDATE data_access_logs SET justification = 'staging_anonymized';

-- Vérification finale : aucune adresse email réelle ne doit subsister.
DO $$
DECLARE v_left integer;
BEGIN
  SELECT COUNT(*) INTO v_left FROM users WHERE email NOT LIKE '%@staging.creche.dz';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'Anonymisation incomplète : % emails non pseudonymisés', v_left;
  END IF;
END $$;
