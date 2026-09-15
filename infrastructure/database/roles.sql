-- Phase D : bootstrap administrateur, AVANT migrations (installation neuve).
-- Les secrets sont injectés par scripts/bootstrap-roles.mjs, jamais ici.
-- Ce fichier doit être exécuté dans une transaction (runner bootstrap).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_migrator') THEN
    CREATE ROLE creche_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    CREATE ROLE creche_app LOGIN;
  END IF;

  -- Une base historique demande un transfert de propriété explicite, pas une
  -- rétrogradation aveugle. Même FORCE RLS n'empêche pas un owner de faire DDL.
  IF EXISTS (SELECT 1 FROM pg_class WHERE relowner = 'creche_app'::regrole)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = 'creche_app'::regrole)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datdba = 'creche_app'::regrole)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = 'creche_app'::regrole) THEN
    RAISE EXCEPTION 'DATABASE_ROLE_OWNS_OBJECTS: transfert de propriété requis avant bootstrap';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member IN ('creche_app'::regrole, 'creche_migrator'::regrole)) THEN
    RAISE EXCEPTION 'DATABASE_ROLE_MEMBERSHIP: retirer les appartenances après revue administrateur';
  END IF;
END $$;

-- Garantir l'état FINAL, y compris si les rôles existaient déjà (C8-bis).
ALTER ROLE creche_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
-- BYPASSRLS nécessaire aux fonctions SECURITY DEFINER sur tables FORCE RLS.
-- Secret du migrateur strictement absent des environnements API/worker.
ALTER ROLE creche_migrator LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM creche_app;
ALTER SCHEMA public OWNER TO creche_migrator;
GRANT USAGE ON SCHEMA public TO creche_app;
DO $$
BEGIN
  -- CREATE autorise l'installation des extensions trusted de 001 sans superuser.
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO creche_migrator', current_database());
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM PUBLIC, creche_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO creche_app', current_database());
END $$;

-- Le créateur des tables futures est le migrateur, PAS le bootstrap postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE creche_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO creche_app;
ALTER DEFAULT PRIVILEGES FOR ROLE creche_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO creche_app;
ALTER DEFAULT PRIVILEGES FOR ROLE creche_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO creche_app;
