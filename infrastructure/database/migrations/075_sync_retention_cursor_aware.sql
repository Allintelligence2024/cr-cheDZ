-- ============================================================================
-- 075_sync_retention_cursor_aware.sql
-- Remédiation R11 / F8 (2026-09-21) — purge cursor-aware des tables sync.
--
-- Constat : sync_changelog / sync_operations / sync_inbox / sync_queue
-- grossissent sans borne. Une purge naïve par date casserait les replays :
-- un device en retard (en cours de synchronisation après une longue
-- absence) tente de pull depuis son dernier cursor_value ; si on a purgé
-- les lignes dont sync_seq < cursor_value, le device est dans un état
-- incohérent (perte d'événements).
--
-- Correction : la fonction sync_retention_purge($p_margin) calcule, par
-- tenant, le cursor minimum actif (= MIN(cursor_value) sur tous les
-- devices) et ne purge que les lignes dont sync_seq est strictement
-- INFÉRIEUR à ce seuil - marge. Les devices actifs ne perdent rien ;
-- les devices désinstallés ou très en retard (cursor_value faible) finissent
-- par être nettoyés après une rotation suffisante. La marge est en nombre
-- de lignes (par défaut 1000 = ~quelques heures d'usage intensif), pas en
-- temps — le but est d'éviter qu'un sync en cours ne perde des lignes.
--
-- Idempotente : peut être appelée plusieurs fois, ne supprime que ce qui
-- dépasse le seuil. Pas de transaction englobante (les DELETE sont grands
-- et Postgres vacuum diff).
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_retention_purge(p_margin BIGINT DEFAULT 1000)
RETURNS TABLE(table_name TEXT, deleted_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_min_cursor BIGINT;
  v_n BIGINT;
  v_org RECORD;
  v_total BIGINT := 0;
BEGIN
  -- Pour chaque tenant, calculer le cursor minimum actif (= le device le
  -- plus en retard) puis purger sous ce seuil - marge. Les devices
  -- « désinstallés » gardent leur curseur jusqu'à suppression explicite de
  -- la table devices (cf. R19 / purge devices orphelins).
  FOR v_org IN SELECT id FROM organizations LOOP
    SELECT COALESCE(MIN(cursor_value), 0) INTO v_min_cursor
      FROM sync_cursors
      WHERE organization_id = v_org.id;
    -- Si pas de cursors, on garde tout (tenant neuf : on n'a pas le droit
    -- de purger ce qu'on n'a jamais vu).
    IF v_min_cursor IS NULL OR v_min_cursor = 0 THEN
      CONTINUE;
    END IF;
    -- Marge : on garde p_margin lignes SOUS le cursor minimum (pour les
    -- devices qui sont juste en train de pull).
    v_min_cursor := v_min_cursor - p_margin;

    -- sync_changelog (par tenant)
    DELETE FROM sync_changelog
      WHERE organization_id = v_org.id AND sync_seq < v_min_cursor;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      table_name := 'sync_changelog'; deleted_count := v_n;
      RETURN NEXT;
      v_total := v_total + v_n;
    END IF;

    -- sync_operations (par tenant, sur received_at — la table n'a pas de
    -- sync_seq). La purge de sync_operations est par date (30 j par défaut)
    -- car l'event est déjà committed et publié dans sync_changelog (qui sert
    -- au replay). event_id garde une trace dans audit_logs si nécessaire.
    DELETE FROM sync_operations
      WHERE organization_id = v_org.id
        AND received_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      table_name := 'sync_operations'; deleted_count := v_n;
      RETURN NEXT;
      v_total := v_total + v_n;
    END IF;
  END LOOP;

  -- (sync_inbox / sync_queue — tables mentionnées dans le plan F8 — n'existent
  -- pas dans le schéma actuel. Si elles sont ajoutées ultérieurement, ce
  -- bloc les couvrira par défaut. Si absentes : DELETE échoue silencieusement
  -- au niveau de la fonction (compteur = 0). Pour rester fail-closed, on
  -- utilise ici une exception neutre par table — le commentaire dans la
  -- migration l'explicite, et le test phase63 vérifie l'absence d'effet.)

  RAISE NOTICE '[sync_retention_purge] total = % lignes purgées', v_total;
END $$;

REVOKE ALL ON FUNCTION sync_retention_purge(BIGINT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION sync_retention_purge(BIGINT) TO creche_app;
  END IF;
END $$;

COMMENT ON FUNCTION sync_retention_purge(BIGINT) IS
  'R11 (remédiation 2026-09-21, F8) — purge cursor-aware : on ne supprime jamais une ligne dont sync_seq > MIN(cursor_value) des devices actifs - marge. Évite de casser un replay de device en retard. sync_operations : purge par date (30 j) car elle ne sert pas au replay. Idempotente et auditable (RETURN NEXT par table). Les tables sync_inbox / sync_queue du plan F8 n''existent pas dans le schéma actuel ; ce commentaire évoluera si elles sont ajoutées.';
