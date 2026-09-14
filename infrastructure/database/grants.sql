-- Exécuté par le migrateur après CHAQUE migration, dans sa transaction,
-- et lors d'un run sans migration en attente (réparation idempotente).
GRANT USAGE ON SCHEMA public TO creche_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO creche_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO creche_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO creche_app;
-- Le registre de migrations est lisible pour schema-check, pas modifiable.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations FROM creche_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO creche_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO creche_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO creche_app;
