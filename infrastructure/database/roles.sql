-- ============================================================================
-- roles.sql — Rôles PostgreSQL (C06).
-- À exécuter par le superutilisateur PostgreSQL (pas par le runner de
-- migrations). En dev local, le rôle creche_app peut rester propriétaire ;
-- en staging/prod, l'application utilise creche_app (NOBYPASSRLS) et les
-- migrations un rôle dédié creche_migrator.
--
--   sudo -u postgres psql -f infrastructure/database/roles.sql
-- ============================================================================

-- Rôle de migration (DDL uniquement)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_migrator') THEN
    CREATE ROLE creche_migrator LOGIN;
  END IF;
END $$;

-- Rôle applicatif : peut lire/écrire les données mais PAS contourner la RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    CREATE ROLE creche_app LOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Octrois (à rejouer après toute nouvelle migration ajoutant des tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO creche_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO creche_app;
GRANT USAGE ON SCHEMA public TO creche_app;
GRANT USAGE ON SCHEMA public TO creche_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO creche_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO creche_app;

-- Fonctions SECURITY DEFINER (bootstrap auth) : exécution réservée à creche_app
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO creche_app;

-- Comportement safe-by-default :
-- si app.tenant_id n'est pas posé, current_setting(..., true) = NULL
-- => toute politique RLS est fausse => 0 ligne (jamais une fuite).
-- L'application n'utilise que SET LOCAL dans withTenantConnection().
