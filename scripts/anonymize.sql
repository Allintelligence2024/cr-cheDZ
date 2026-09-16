-- ============================================================================
-- Pseudonymisation des données réelles pour l'environnement de staging
-- (Phase 11, étendue H2l — audit anonymisation 2026-09). Aucun environnement
-- non-prod ne doit contenir de données personnelles réelles.
-- À exécuter APRÈS l'import d'un dump de production, JAMAIS sur la production.
--
-- Usage : psql "$DATABASE_URL_STAGING" -v ON_ERROR_STOP=1 -f scripts/anonymize.sql
--
-- Principe : valeurs déterministes (fonction de hachage de la valeur ou de
-- l'identifiant d'origine) ou fixes ; les liens entre tables sont conservés
-- (les identités internes ne sont PAS modifiées). Tout est dans UNE seule
-- transaction : un échec de la vérification finale annule le lot entier (pas
-- d'anonymisation partielle silencieuse). La vérification n'est pas un
-- inventaire exhaustif : voir LIMITES en fin de fichier — ce script
-- pseudonymise les colonnes listées, il ne prétend aucune conformité globale.
--
-- Mot de passe staging UNIFORME après exécution : Creche#Staging2026!
-- (hash bcrypt cost 10 ci-dessous — c'est le secret PUBLIC de test du staging,
-- jamais un mot de passe réel importé). MFA TOTP désactivée en staging (secret
-- supprimé). Tokens de push remplacés par des pseudo-tokens : aucune livraison
-- réelle possible depuis staging.
--
-- Refus d'exécution si le nom de la base ne se termine pas par `staging` ou
-- `_test` : garde contre un psql distrait sur la production.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF current_database() NOT LIKE '%staging' AND current_database() NOT LIKE '%_test' THEN
    RAISE EXCEPTION 'anonymize.sql refusé : base "%" non reconnue comme staging/test', current_database();
  END IF;
END $$;

-- Helper : remplace toute valeur texte d'un JSONB par un marqueur fixe,
-- structure et types non-textes conservés (payloads de sync/outbox — miroirs
-- d'anciennes écritures métier qui peuvent porter du texte libre).
-- Fonctions créées dans la transaction du script : un échec ultérieur
-- l'annule aussi (DDL transactionnel PostgreSQL), et un succès se termine par
-- le DROP explicite — aucune fonction résiduelle en base. IF EXISTS couvre le
-- rejouage dans une même session.
DROP FUNCTION IF EXISTS public.anon_jsonb_deep(jsonb);
CREATE FUNCTION public.anon_jsonb_deep(v jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  k text;
  out_obj jsonb := '{}'::jsonb;
  out_arr jsonb := '[]'::jsonb;
  elem jsonb;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(v) = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(v) LOOP
      out_obj := out_obj || jsonb_build_object(k, anon_jsonb_deep(v -> k));
    END LOOP;
    RETURN out_obj;
  ELSIF jsonb_typeof(v) = 'array' THEN
    FOR elem IN SELECT jsonb_array_elements(v) LOOP
      out_arr := out_arr || jsonb_build_array(anon_jsonb_deep(elem));
    END LOOP;
    RETURN out_arr;
  ELSIF jsonb_typeof(v) = 'string' THEN
    RETURN to_jsonb('staging-anon'::text);
  END IF;
  RETURN v;
END $$;

-- Emails et téléphones : pseudo aléatoires mais déterministes par source.
-- Mot de passe : haché UNIFORME staging (jamais le hash réel importé, qui
-- serait cassable hors ligne). MFA : le secret TOTP réel ne survit pas.
UPDATE users SET
  email = 'user+' || substr(md5(email), 1, 12) || '@staging.creche.dz',
  phone = '+213' || (600000000 + (('x' || substr(md5(email), 1, 8))::bit(32)::int % 200000000))::text,
  first_name = CASE WHEN first_name = '' THEN first_name ELSE 'Prénom' || substr(md5(email), 1, 4) END,
  last_name  = CASE WHEN last_name = '' THEN last_name ELSE 'Nom' || substr(md5(email), 1, 4) END,
  password_hash = '$2b$10$9GU3qPihQLccTzRcSSUY.e1q8eIlhacVCwF/c0gIJk0bX/RiKm6Ti',
  totp_secret = NULL,
  last_login_ip = (CASE WHEN last_login_ip IS NULL THEN NULL
    ELSE '198.51.100.' || (17 + abs(('x' || substr(md5(email), 9, 8))::bit(32)::int) % 200)::text END)::inet;

-- Tuteurs légaux : identité complète pseudonymisée (le script historique les
-- laissait INTACTS — finding H2l).
UPDATE guardians SET
  first_name_fr = CASE WHEN first_name_fr = '' THEN first_name_fr ELSE 'Tuteur' || substr(md5(id::text), 1, 4) END,
  first_name_ar = CASE WHEN first_name_ar = '' THEN first_name_ar ELSE 'وصي' || substr(md5(id::text), 1, 4) END,
  last_name_fr  = 'Staging' || substr(md5(id::text), 5, 4),
  last_name_ar  = NULL,
  phone_primary = '+213' || (600000000 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200000000)::text,
  phone_secondary = CASE WHEN phone_secondary IS NULL THEN NULL
    ELSE '+213' || (700000000 + abs(('x' || substr(md5(id::text), 9, 8))::bit(32)::int) % 100000000)::text END,
  email = CASE WHEN email IS NULL THEN NULL
    ELSE 'guardian+' || substr(md5(email), 1, 12) || '@staging.creche.dz' END,
  national_id = CASE WHEN national_id IS NULL THEN NULL ELSE 'STAG-' || substr(md5(id::text), 1, 10) END,
  address = CASE WHEN address IS NULL THEN NULL ELSE 'Adresse staging ' || substr(md5(id::text), 1, 6) END,
  employer = NULL,
  photo_url = NULL,
  notes = NULL;

-- Enfants : prénoms/noms pseudonymisés ; notes neutralisées (les âges
-- relatifs restent testables via les dates conservées quand elles ne sont PAS
-- directement identifiantes : ici date_of_birth est CONSERVÉE — à évaluer par
-- le DPO avant tout import réel, voir LIMITES).
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
UPDATE vaccinations SET
  lot_number = 'STAGING-' || substr(md5(id::text), 1, 8),
  vaccine_name = 'Vaccin test ' || substr(md5(id::text), 1, 4);
UPDATE medication_administrations SET observations = NULL;
UPDATE medication_authorizations SET medication_name = 'Traitement test ' || substr(md5(id::text), 1, 4);

-- Notes libres (journal) : les textes libres peuvent contenir des données
-- personnelles → vidés (libellés d'activité neutralisés pareillement).
UPDATE daily_log_events SET
  meal_notes = NULL,
  activity_name = NULL,
  activity_notes = NULL,
  note_text = NULL,
  incident_description = NULL,
  health_observation = NULL;

-- Personnel : identifiants nationaux/CNAS, téléphones et contacts d'urgence
-- pseudonymisés ; montants et matricules internes conservés (tests de paie).
UPDATE staff_profiles SET
  national_id = 'STAG-' || substr(md5(id::text), 1, 10),
  cnas_number = CASE WHEN cnas_number IS NULL THEN NULL ELSE 'STAG-' || substr(md5(id::text), 11, 8) END,
  phone = '+213' || (600000000 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200000000)::text,
  emergency_contact_name = 'Contact urgence ' || substr(md5(id::text), 1, 4),
  emergency_contact_phone = '+213' || (700000000 + abs(('x' || substr(md5(id::text), 9, 8))::bit(32)::int) % 100000000)::text,
  notes = NULL;

-- Contacts d'urgence et personnes autorisées à récupérer l'enfant :
-- identité pseudonymisée, liens et relations conservés (structure de test).
UPDATE emergency_contacts SET
  first_name = 'Urgence' || substr(md5(id::text), 1, 4),
  last_name = 'Staging',
  phone_primary = '+213' || (600000000 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200000000)::text,
  phone_secondary = CASE WHEN phone_secondary IS NULL THEN NULL
    ELSE '+213' || (700000000 + abs(('x' || substr(md5(id::text), 9, 8))::bit(32)::int) % 100000000)::text END;
UPDATE authorized_pickups SET
  first_name = 'Autorise' || substr(md5(id::text), 1, 4),
  last_name = 'Staging',
  phone = '+213' || (600000000 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200000000)::text,
  national_id = CASE WHEN national_id IS NULL THEN NULL ELSE 'STAG-' || substr(md5(id::text), 1, 10) END,
  photo_url = NULL;

-- Messagerie interne : le corps des messages est du texte libre (peut contenir
-- des données personnelles) → remplaçé par un marqueur déterministe par ligne.
UPDATE conversations SET subject = 'Échange de test ' || substr(md5(id::text), 1, 6);
UPDATE messages SET body = 'Message de test (staging anonymisé) — ' || substr(md5(id::text), 1, 8);

-- Notifications en file/boîte : copies locales de textes parent/enfant.
UPDATE notification_queue SET
  title_fr = CASE WHEN title_fr IS NULL THEN NULL ELSE 'Notification test ' || substr(md5(id::text), 1, 4) END,
  title_ar = CASE WHEN title_ar IS NULL THEN NULL ELSE 'إشعار تجريبي ' || substr(md5(id::text), 1, 4) END,
  body_fr = 'Corps de notification anonymisé ' || substr(md5(id::text), 1, 6),
  body_ar = 'نص إشعار مُجهَّل ' || substr(md5(id::text), 1, 6),
  data = anon_jsonb_deep(data);
UPDATE notification_inbox SET
  title_fr = 'Notification test ' || substr(md5(id::text), 1, 4),
  title_ar = 'إشعار تجريبي ' || substr(md5(id::text), 1, 4),
  body_fr = 'Corps de notification anonymisé ' || substr(md5(id::text), 1, 6),
  body_ar = 'نص إشعار مُجهَّل ' || substr(md5(id::text), 1, 6),
  data = anon_jsonb_deep(data);

-- Sessions et appareils : les hashes de refresh RÉELS ne survivent pas
-- (une session importée ne doit pas pouvoir être rejouée en staging) ;
-- adresses IP en TEST-NET-2 (RFC 5737) ; tokens de push vendor neutralisés.
UPDATE sessions SET
  refresh_token_hash = 'staging-' || md5(id::text),
  ip_address = (CASE WHEN ip_address IS NULL THEN NULL
    ELSE '198.51.100.' || (17 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200)::text END)::inet,
  user_agent = CASE WHEN user_agent IS NULL THEN NULL ELSE 'staging-anonymize' END;
UPDATE devices SET
  name = 'Appareil ' || substr(md5(id::text), 1, 6),
  device_fingerprint = 'staging-fp-' || substr(md5(id::text), 1, 16),
  fcm_token = CASE WHEN fcm_token IS NULL THEN NULL ELSE 'staging-fcm-' || substr(md5(id::text), 1, 24) END,
  apns_token = CASE WHEN apns_token IS NULL THEN NULL ELSE 'staging-apns-' || substr(md5(id::text), 1, 24) END;
UPDATE otp_codes SET target = 'otp+' || substr(md5(target), 1, 12) || '@staging.creche.dz';
UPDATE consent_records SET
  ip_address = ('198.51.100.' || (17 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200)::text)::inet,
  signature_data = CASE WHEN signature_data IS NULL THEN NULL ELSE 'staging-signature' END;

-- Fichiers : les OCTETS en S3/minio sont HORS du périmètre SQL (cf. LIMITES) ;
-- ici seul le nom de fichier d'origine (souvent sensible) est pseudonymisé,
-- extension conservée pour les tests de type MIME.
UPDATE media_assets SET
  original_filename = CASE WHEN original_filename IS NULL THEN NULL
    ELSE 'staging-' || substr(md5(id::text), 1, 12) || COALESCE('.' || (substring(original_filename from '\.([A-Za-z0-9]+)$')), '') END;

-- Textes libres résiduels des modules métier et conformité.
UPDATE contracts SET notes = NULL WHERE notes IS NOT NULL;
UPDATE invoices SET notes = NULL WHERE notes IS NOT NULL;
UPDATE daily_cash_registers SET notes = NULL WHERE notes IS NOT NULL;
UPDATE staff_attendance SET notes = NULL WHERE notes IS NOT NULL;
UPDATE privacy_requests SET notes = NULL WHERE notes IS NOT NULL;
UPDATE privacy_violations SET
  description = 'Violation de test (anonymisée) ' || substr(md5(id::text), 1, 6),
  dpo_notes = NULL;
UPDATE processing_registry SET dpo_notes = NULL WHERE dpo_notes IS NOT NULL;
UPDATE privacy_dpias SET risk_assessment = '{"staging_anonymized": true}'::jsonb;

-- Facturation : montants conservés (données financières de test utiles),
-- références externes neutralisées.
UPDATE payments SET external_reference = NULL, gateway_response = NULL, notes = NULL;

-- Miroirs d'écritures métier (payloads de sync et outbox) : structure
-- conservée, toute valeur texte remplacée. Les clients mobiles de staging
-- doivent REPARTIR D'UN BOOTSTRAP complet après anonymisation (événements
-- neutralisés), pas rejouer un cache antérieur.
UPDATE outbox_events SET payload = anon_jsonb_deep(payload);
UPDATE sync_changelog SET payload = anon_jsonb_deep(payload);
UPDATE sync_operations SET payload = anon_jsonb_deep(payload),
  response_outcome = CASE WHEN response_outcome ? 'body'
    THEN jsonb_set(response_outcome, '{body}', anon_jsonb_deep(response_outcome -> 'body'))
    ELSE response_outcome END;

-- Organisations et sites : noms/coordonnées réels remplacés (le script
-- historique laissait les adresses, téléphones et e-mails des SITES intacts).
UPDATE sites SET
  name_fr = 'Site Staging ' || substr(md5(id::text), 1, 4),
  name_ar = NULL,
  phone = NULL,
  email = NULL,
  address_line1 = NULL;
UPDATE organizations SET
  name_fr = 'Crèche Staging ' || substr(md5(id::text), 1, 4),
  name_ar = NULL,
  legal_name = NULL,
  phone = NULL,
  email = NULL,
  address_line1 = NULL,
  address_line2 = NULL,
  commune = NULL;

-- Journal d'audit et journaux d'accès : la structure est conservée mais les
-- valeurs peuvent contenir des fragments de données — neutralisées.
UPDATE audit_logs SET old_values = NULL, new_values = '{"staging": true}'::jsonb,
  ip_address = (CASE WHEN ip_address IS NULL THEN NULL
    ELSE '198.51.100.' || (17 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200)::text END)::inet;
UPDATE data_access_logs SET justification = 'staging_anonymized',
  ip_address = (CASE WHEN ip_address IS NULL THEN NULL
    ELSE '198.51.100.' || (17 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200)::text END)::inet;
UPDATE media_access_logs SET
  ip_address = (CASE WHEN ip_address IS NULL THEN NULL
    ELSE '198.51.100.' || (17 + abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 200)::text END)::inet;

-- ── VÉRIFICATION FINALE — chaque contrôle est un refus d'anonymisation
-- partielle sur sa propre portée (le bloc est dans la transaction : tout
-- échec annule le lot). Ne pas lire ceci comme une conformité globale.
DO $verify$
DECLARE
  v_found text;
BEGIN
  SELECT string_agg(residue, ', ' ORDER BY residue) INTO v_found
  FROM (
    SELECT 'users.email pseudonymisé' AS residue WHERE EXISTS (SELECT 1 FROM users WHERE email NOT LIKE '%@staging.creche.dz')
    UNION ALL SELECT 'users.password_hash uniforme staging' AS residue WHERE EXISTS (SELECT 1 FROM users WHERE password_hash <> '$2b$10$9GU3qPihQLccTzRcSSUY.e1q8eIlhacVCwF/c0gIJk0bX/RiKm6Ti')
    UNION ALL SELECT 'users.totp_secret supprimé' AS residue WHERE EXISTS (SELECT 1 FROM users WHERE totp_secret IS NOT NULL)
    UNION ALL SELECT 'guardians.email pseudonymisé' AS residue WHERE EXISTS (SELECT 1 FROM guardians WHERE email IS NOT NULL AND email NOT LIKE '%@staging.creche.dz')
    UNION ALL SELECT 'guardians.national_id neutralisé' AS residue WHERE EXISTS (SELECT 1 FROM guardians WHERE national_id IS NOT NULL AND national_id NOT LIKE 'STAG-%')
    UNION ALL SELECT 'guardians.notes supprimées' AS residue WHERE EXISTS (SELECT 1 FROM guardians WHERE notes IS NOT NULL)
    UNION ALL SELECT 'staff_profiles.national_id neutralisé' AS residue WHERE EXISTS (SELECT 1 FROM staff_profiles WHERE national_id NOT LIKE 'STAG-%')
    UNION ALL SELECT 'staff_profiles.notes supprimées' AS residue WHERE EXISTS (SELECT 1 FROM staff_profiles WHERE notes IS NOT NULL)
    UNION ALL SELECT 'emergency_contacts neutralisés' AS residue WHERE EXISTS (SELECT 1 FROM emergency_contacts WHERE first_name NOT LIKE 'Urgence%')
    UNION ALL SELECT 'authorized_pickups neutralisés' AS residue WHERE EXISTS (SELECT 1 FROM authorized_pickups WHERE first_name NOT LIKE 'Autorise%')
    UNION ALL SELECT 'messages.body neutralisé' AS residue WHERE EXISTS (SELECT 1 FROM messages WHERE body NOT LIKE 'Message de test%')
    UNION ALL SELECT 'sessions.refresh_token_hash remplacé' AS residue WHERE EXISTS (SELECT 1 FROM sessions WHERE refresh_token_hash NOT LIKE 'staging-%')
    UNION ALL SELECT 'devices.fcm_token neutralisé' AS residue WHERE EXISTS (SELECT 1 FROM devices WHERE fcm_token IS NOT NULL AND fcm_token NOT LIKE 'staging-fcm-%')
    UNION ALL SELECT 'devices.apns_token neutralisé' AS residue WHERE EXISTS (SELECT 1 FROM devices WHERE apns_token IS NOT NULL AND apns_token NOT LIKE 'staging-apns-%')
    UNION ALL SELECT 'otp_codes.target pseudonymisé' AS residue WHERE EXISTS (SELECT 1 FROM otp_codes WHERE target NOT LIKE '%@staging.creche.dz')
    UNION ALL SELECT 'notification_inbox.body neutralisé' AS residue WHERE EXISTS (SELECT 1 FROM notification_inbox WHERE body_fr NOT LIKE 'Corps de notification anonymisé%')
    UNION ALL SELECT 'adresses IP neutres (audit)' AS residue WHERE EXISTS (SELECT 1 FROM audit_logs WHERE ip_address IS NOT NULL AND ip_address::text NOT LIKE '198.51.100.%')
    UNION ALL SELECT 'adresses IP neutres (consents)' AS residue WHERE EXISTS (SELECT 1 FROM consent_records WHERE ip_address::text NOT LIKE '198.51.100.%')
    UNION ALL SELECT 'daily_log_events.notes supprimées' AS residue WHERE EXISTS (SELECT 1 FROM daily_log_events WHERE note_text IS NOT NULL OR health_observation IS NOT NULL OR incident_description IS NOT NULL)
    UNION ALL SELECT 'sites sans coordonnées réelles' AS residue WHERE EXISTS (SELECT 1 FROM sites WHERE phone IS NOT NULL OR email IS NOT NULL OR address_line1 IS NOT NULL)
  ) t;
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'Anonymisation incomplète — résidus: %', v_found;
  END IF;
END
$verify$;

DROP FUNCTION public.anon_jsonb_deep(jsonb);

COMMIT;

-- ── LIMITES ASSUMÉES (hors périmètre SQL, à ne PAS déclarer conformes) ──────
-- * Objets binaires en stockage objet (photos, pièces jointes messages,
--   PDF d'exports/privacy_request_exports, clips vidéo) : NON modifiés par ce
--   script. Un staging importé d'un dump prod doit être re-provisionné SANS
--   bucket de production ; les URLs signées expirent seules (TTL).
-- * organizations.settings (libellés de reçus éventuels) et
--   background_jobs.payload (identifiants internes d'ordonnancement) :
--   conservés, relus lors des tests d'exploitation uniquement.
-- * children.date_of_birth : conservée (nécessaire aux tests d'âge) — date
--   potentiellement indirectement identifiante ; décision DPO documentée
--   avant tout import réel.
-- * Tokens vendor déjà expédiés hors de la base (FCM/APNs côté Google/Apple,
--   e-mails/SMS/WhatsApp envoyés) : hors de portée d'un UPDATE SQL.
-- * Les tables financières (montants, lignes de factures) conservent leurs
--   valeurs — choix d'exploitabilité staging, pas une anonymisation.
-- * Ce script n'efface AUCUNE ligne (tout est UPDATE) : les compteurs et
--   intégrités référentielles servent de tests de non-régression.
