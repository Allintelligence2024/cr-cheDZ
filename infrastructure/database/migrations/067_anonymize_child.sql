-- ============================================================================
-- 067_anonymize_child.sql
-- Rapport 5 analyses — Phase 5 : C3 (effacement 25-11 « impraticable ») + DB6.
--
-- Constat : toutes les FK vers children/guardians sont RESTRICT (ou sans
-- action = RESTRICT) : AUCUNE suppression physique d'un enfant n'est
-- possible sans chirurgie — c'est voulu (intégrité comptable, journal
-- d'audit, immuabilité des paiements). La loi 18-07 modifiée par 25-11
-- admet l'ANONYMISATION comme modalité d'exécution du droit à l'effacement :
-- une fois la personne non identifiable, les données ne sont plus des
-- données à caractère personnel.
--
-- Le script scripts/anonymize.sql est GLOBAL (staging, base entière). Il
-- manquait un chemin À CHAUD, PAR ENFANT / FAMILLE SORTANTE, transactionnel,
-- motivé et audité : c'est cette fonction.
--
-- anonymize_child(p_child_id, p_actor_id, p_reason) :
--   * SECURITY DEFINER (traverse la RLS des tables système comme
--     billing_webhook_apply) MAIS fail-closed sur le tenant : l'enfant doit
--     appartenir à app_tenant_id() (le contexte de la connexion applicative) ;
--   * refuse un enfant encore actif (CHILD_STILL_ACTIVE) : il faut d'abord la
--     sortie (status = 'departed' OU deleted_at posé) — jamais d'effacement
--     d'un dossier en cours ;
--   * motif obligatoire (ANONYMIZE_REASON_REQUIRED), acteur obligatoire ;
--   * IDEMPOTENTE : rejeu → aucun nouvel écrit, already_anonymized = true ;
--   * anonymise en UNE transaction (celle de l'appelant) : identité de
--     l'enfant, santé, journal, contacts d'urgence, personnes autorisées,
--     conversations/messages de l'enfant, métadonnées médias (les OCTETS S3
--     sont hors SQL : les clés sont RETOURNÉES pour purge par l'appelant),
--     et les tuteurs liés EXCLUSIVEMENT à cet enfant (identité, contact,
--     pièce d'identité, adresse, employeur) avec leur compte parent (users :
--     identité, email/téléphone, mot de passe, MFA, sessions révoquées,
--     token_epoch incrémenté par le trigger G4 → jetons invalidés) ;
--   * CONSERVE, non identifiants après coup : contrats, factures, paiements,
--     allocations (obligation comptable + triggers d'immuabilité), présences
--     agrégées, historique de statut, journal d'audit (les valeurs
--     personnelles n'y sont pas réécrites : c'est le registre de preuve) ;
--   * écrit une ligne audit_logs (action 'delete', resource_type 'child',
--     new_values = résumé) et le tombstone de sync (trigger 059 : UPDATE
--     children avec deleted_at → 'deleted' vers les appareils).
--
-- Marqueur d'idempotence : children.departure_reason = 'ANONYMIZED' ET
-- first_name_fr LIKE 'Anonyme-%'. Ne pas réutiliser ce motif ailleurs.
-- ============================================================================

CREATE OR REPLACE FUNCTION anonymize_child(
  p_child_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_child children%ROWTYPE;
  v_tenant uuid;
  v_tag text;
  v_now timestamptz := clock_timestamp();
  v_guardians uuid[];
  v_users uuid[];
  v_media_keys text[];
  v_counts jsonb := '{}'::jsonb;
  n int;
BEGIN
  v_tenant := app_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ANONYMIZE_ACTOR_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'ANONYMIZE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_child FROM children
    WHERE id = p_child_id AND organization_id = v_tenant
    FOR UPDATE;
  IF NOT FOUND THEN
    -- Même réponse qu'un enfant d'un autre tenant : pas d'oracle d'existence.
    RAISE EXCEPTION 'CHILD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Rejeu : aucun écrit.
  IF v_child.departure_reason = 'ANONYMIZED' AND v_child.first_name_fr LIKE 'Anonyme-%' THEN
    RETURN jsonb_build_object('child_id', p_child_id, 'already_anonymized', true);
  END IF;

  IF v_child.status <> 'departed' AND v_child.deleted_at IS NULL THEN
    RAISE EXCEPTION 'CHILD_STILL_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  -- Tag court NON dérivé des données personnelles (id technique), stable.
  v_tag := left(encode(digest(p_child_id::text, 'sha256'), 'hex'), 8);

  -- ── Tuteurs exclusifs : liés à cet enfant et à AUCUN autre enfant non
  --    anonymisé de l'organisation. Un tuteur partagé (fratrie encore
  --    inscrite) est conservé : ses données restent nécessaires.
  SELECT COALESCE(array_agg(DISTINCT g.id), '{}') INTO v_guardians
    FROM guardians g
    JOIN child_guardians cg ON cg.guardian_id = g.id AND cg.child_id = p_child_id
    WHERE g.organization_id = v_tenant
      AND NOT EXISTS (
        SELECT 1 FROM child_guardians cg2
        JOIN children c2 ON c2.id = cg2.child_id
        WHERE cg2.guardian_id = g.id AND cg2.child_id <> p_child_id
          AND NOT (c2.departure_reason = 'ANONYMIZED' AND c2.first_name_fr LIKE 'Anonyme-%')
      );
  SELECT COALESCE(array_agg(DISTINCT g.user_id), '{}') INTO v_users
    FROM guardians g WHERE g.id = ANY(v_guardians) AND g.user_id IS NOT NULL;

  -- ── Enfant : identité effacée, dates de naissance/inscription réduites au
  --    mois (âge statistique conservé, plus de date exacte), statut départ.
  UPDATE children SET
    first_name_fr = 'Anonyme-' || v_tag,
    first_name_ar = NULL,
    last_name_fr = 'Anonyme',
    last_name_ar = NULL,
    date_of_birth = date_trunc('month', date_of_birth)::date,
    gender = NULL,
    photo_url = NULL,
    notes = NULL,
    special_needs_notes = NULL,
    has_special_needs = false,
    departure_reason = 'ANONYMIZED',
    departure_date = COALESCE(departure_date, v_now::date),
    status = 'departed',
    deleted_at = COALESCE(deleted_at, v_now),
    updated_at = v_now,
    updated_by = p_actor_id,
    version = version + 1
    WHERE id = p_child_id;

  -- ── Santé (données sensibles : neutralisées, structure conservée).
  UPDATE health_records SET blood_type = NULL, family_doctor = NULL, doctor_phone = NULL,
    health_insurance = NULL, chronic_conditions = NULL, general_notes = NULL,
    updated_at = v_now, updated_by = p_actor_id, version = version + 1
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('health_records', n);
  UPDATE allergies SET allergen = 'anonymisé', reaction = NULL, treatment = NULL,
    emergency_protocol = NULL, notes = NULL, is_active = false, updated_at = v_now
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('allergies', n);
  UPDATE vaccinations SET vaccine_name = 'anonymisé', lot_number = NULL, administered_by = NULL
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('vaccinations', n);
  UPDATE medication_authorizations SET medication_name = 'anonymisé', dosage = NULL,
    frequency = NULL, special_instructions = NULL, is_active = false
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('medication_authorizations', n);
  UPDATE medication_administrations SET observations = NULL WHERE child_id = p_child_id;

  -- ── Journal : textes libres vidés, événements et compteurs conservés.
  UPDATE daily_log_events SET meal_notes = NULL, activity_name = NULL, activity_notes = NULL,
    note_text = NULL, incident_description = NULL, incident_action = NULL,
    health_observation = NULL, correction_reason = NULL
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('daily_log_events', n);

  -- ── Entourage de l'enfant.
  UPDATE emergency_contacts SET first_name = 'Anonyme', last_name = 'Anonyme',
    phone_primary = 'anonymisé', phone_secondary = NULL
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('emergency_contacts', n);
  UPDATE authorized_pickups SET first_name = 'Anonyme', last_name = 'Anonyme', phone = 'anonymisé',
    national_id = NULL, photo_url = NULL, is_active = false, updated_at = v_now, version = version + 1
    WHERE child_id = p_child_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('authorized_pickups', n);

  -- ── Messagerie de l'enfant.
  UPDATE messages SET body = 'anonymisé', deleted_at = COALESCE(deleted_at, v_now)
    WHERE conversation_id IN (SELECT id FROM conversations WHERE child_id = p_child_id);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('messages', n);
  UPDATE conversations SET subject = 'anonymisé', is_archived = true WHERE child_id = p_child_id;

  -- ── Médias : métadonnées effacées, asset masqué (deleted_at) ; les OCTETS
  --    en S3/MinIO sont hors du périmètre SQL → clés retournées pour purge.
  SELECT COALESCE(array_agg(k), '{}') INTO v_media_keys FROM (
    SELECT storage_key AS k FROM media_assets
      WHERE child_id = p_child_id OR p_child_id = ANY(COALESCE(children_in_photo, '{}'))
    UNION
    SELECT thumbnail_key FROM media_assets
      WHERE thumbnail_key IS NOT NULL
        AND (child_id = p_child_id OR p_child_id = ANY(COALESCE(children_in_photo, '{}')))
  ) s;
  UPDATE media_assets SET original_filename = NULL, checksum = NULL,
    is_visible_to_parents = false, deleted_at = COALESCE(deleted_at, v_now)
    WHERE child_id = p_child_id OR p_child_id = ANY(COALESCE(children_in_photo, '{}'));
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('media_assets', n);

  -- ── Consentements : preuve conservée (date, type, granted) ; empreinte
  --    et signature effacées.
  UPDATE consent_records SET ip_address = NULL, signature_data = NULL
    WHERE child_id = p_child_id OR guardian_id = ANY(v_guardians);

  -- ── Tuteurs exclusifs et leurs comptes parents.
  UPDATE guardians SET
    first_name_fr = 'Anonyme-' || left(encode(digest(id::text, 'sha256'), 'hex'), 8),
    first_name_ar = NULL, last_name_fr = 'Anonyme', last_name_ar = NULL,
    phone_primary = NULL, phone_secondary = NULL, email = NULL, national_id = NULL,
    address = NULL, employer = NULL, photo_url = NULL, notes = NULL,
    deleted_at = COALESCE(deleted_at, v_now), updated_at = v_now, version = version + 1
    WHERE id = ANY(v_guardians);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('guardians', n);

  UPDATE users SET
    email = 'anonyme+' || left(encode(digest(id::text, 'sha256'), 'hex'), 12) || '@anonymise.invalid',
    phone = NULL, first_name = 'Anonyme', last_name = 'Anonyme', avatar_url = NULL,
    password_hash = NULL, totp_secret = NULL, totp_enabled = false, parent_pin_hash = NULL,
    last_login_ip = NULL, status = 'deleted', deleted_at = COALESCE(deleted_at, v_now),
    updated_at = v_now, version = version + 1
    WHERE id = ANY(v_users);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('users', n);
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, v_now),
    revoked_reason = COALESCE(revoked_reason, 'ANONYMIZED')
    WHERE user_id = ANY(v_users);
  UPDATE memberships SET is_active = false WHERE user_id = ANY(v_users) AND organization_id = v_tenant;
  UPDATE notification_inbox SET title_fr = 'anonymisé', title_ar = NULL, body_fr = 'anonymisé',
    body_ar = NULL, data = '{}'::jsonb WHERE user_id = ANY(v_users);
  UPDATE notification_queue SET title_fr = 'anonymisé', title_ar = NULL, body_fr = 'anonymisé',
    body_ar = NULL, data = '{}'::jsonb, status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END,
    failure_reason = CASE WHEN status = 'pending' THEN 'ANONYMIZED' ELSE failure_reason END
    WHERE user_id = ANY(v_users);

  -- ── Preuve : journal d'audit (aucune donnée personnelle dans le résumé).
  INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id,
    resource_label, new_values)
  VALUES (v_tenant, p_actor_id, 'delete', 'child', p_child_id, 'Anonyme-' || v_tag,
    jsonb_build_object('anonymized', true, 'reason', btrim(p_reason),
      'guardians', coalesce(array_length(v_guardians, 1), 0),
      'users', coalesce(array_length(v_users, 1), 0),
      'media_keys', coalesce(array_length(v_media_keys, 1), 0),
      'counts', v_counts));

  RETURN jsonb_build_object(
    'child_id', p_child_id,
    'already_anonymized', false,
    'anonymized_at', v_now,
    'guardian_ids', to_jsonb(v_guardians),
    'user_ids', to_jsonb(v_users),
    'media_storage_keys', to_jsonb(v_media_keys),
    'counts', v_counts);
END $$;

REVOKE ALL ON FUNCTION anonymize_child(uuid, uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION anonymize_child(uuid, uuid, text) TO creche_app;
  END IF;
END $$;

COMMENT ON FUNCTION anonymize_child(uuid, uuid, text) IS
  'Loi 25-11 — effacement par anonymisation d''un enfant sorti (et de ses tuteurs exclusifs). Transactionnel, idempotent, audité. Les FK RESTRICT interdisent la suppression physique par conception (DB6).';
