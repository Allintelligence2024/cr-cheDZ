-- ============================================================================
-- 018_rls_robust.sql
-- Défense en profondeur — bug GUC découvert en Phase 5 :
--
--   Après `SELECT set_config('app.tenant_id', $1, true)` (local à la
--   transaction) + COMMIT, la GUC `app.tenant_id` RESTE CRÉÉE avec la valeur
--   '' (chaîne vide) sur la connexion poolée. La politique RLS
--   `current_setting('app.tenant_id', true)::uuid` évalue alors `''::uuid`
--   → erreur "invalid input syntax for type uuid" sur toute requête directe
--   sur une table tenant (ex. currentMaxSeq du sync).
--
--   RESET et set_config(NULL) ne réinitialisent pas la GUC (vérifié).
--   → Toutes les politiques utilisent désormais le helper app_tenant_id(),
--     robuste à NULL ET à '' (safe-by-default : 0 ligne, jamais d'erreur).
-- ============================================================================

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(btrim(current_setting('app.tenant_id', true)), '')::uuid
$$;

REVOKE ALL ON FUNCTION app_tenant_id() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION app_tenant_id() TO creche_app;
  END IF;
END $$;

-- Régénération de toutes les politiques qui référencent app.tenant_id.
-- La migration échoue (RAISE EXCEPTION) si une expression est inattendue,
-- afin de ne jamais laisser une politique non migrée.
DO $$
DECLARE
  pol RECORD;
  v_using text;
  v_check text;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%app.tenant_id%' OR with_check ILIKE '%app.tenant_id%')
  LOOP
    -- La forme déparsée stockée peut varier (parenthèses englobantes, ::text) :
    --   (organization_id = (current_setting('app.tenant_id'::text, true))::uuid)
    --   (organization_id = current_setting('app.tenant_id', true)::uuid)
    -- Deux passes : avec puis sans parenthèses englobantes.
    v_using := regexp_replace(
      regexp_replace(
        pol.qual,
        '\(current_setting\(''app\.tenant_id''(::text)?, true\)\)::uuid',
        'app_tenant_id()', 'g'),
      'current_setting\(''app\.tenant_id''(::text)?, true\)::uuid',
      'app_tenant_id()', 'g');
    v_check := regexp_replace(
      regexp_replace(
        COALESCE(pol.with_check, ''),
        '\(current_setting\(''app\.tenant_id''(::text)?, true\)\)::uuid',
        'app_tenant_id()', 'g'),
      'current_setting\(''app\.tenant_id''(::text)?, true\)::uuid',
      'app_tenant_id()', 'g');

    IF v_using = pol.qual THEN
      RAISE EXCEPTION 'Politique % sur % : expression inattendue: %',
        pol.policyname, pol.tablename, pol.qual;
    END IF;

    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    IF pol.with_check IS NOT NULL THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename, v_using, v_check);
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I.%I USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename, v_using);
    END IF;
  END LOOP;
END $$;
