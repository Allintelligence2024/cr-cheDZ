-- 062_principal_token_epoch.sql — G4 (audit 2026-09) : révocation globale des
-- principaux. Un access JWT en vol restait utilisable jusqu'à son expiration
-- (15 min) après changement de mot de passe, révocation de rôle/membership ou
-- changement d'état de compte. Ajout d'un compteur d'époque par utilisateur,
-- porté comme claim 'epoch' à la signature et revérifié par les gardes
-- d'entrée ; ce fichier le rend inévitable même pour les écritures SQL
-- d'exploitation (déclencheurs sur users, memberships et role_assignments),
-- sans élargir les droits de creche_app.
--
-- Additif et transactionnel : aucune ligne effacée, aucune table recréée.
-- Rollback : DROP des triggers/fonction + ALTER TABLE users DROP COLUMN
-- token_epoch ; les tokens émis avec un claim epoch restent valides pour le
-- garde d'avant (le champ est simplement ignoré).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_epoch bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.token_epoch IS
  'G4 : compteur de révocation globale. Incrémenté par déclencheur à chaque '
  'changement d''état révocatoire (statut, super-adminité, mot de passe, '
  'suppression, membership, rôles). Tout access token dont le claim epoch '
  'diffère (absent = 0) est refusé par les gardes.';

-- Bump unique, en SECURITY DEFINER : la table users n'a pas de RLS mais le
-- droit d'écriture sur la colonne d'époque ne doit pas dépendre des droits
-- accordés au rôle appelant (le trigger memberships s'exécute au nom du
-- directeur/parent connecté).
CREATE OR REPLACE FUNCTION g4_bump_principal_epoch(target_user uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE users
     SET token_epoch = COALESCE(token_epoch, 0) + 1
   WHERE id = target_user;
$$;

REVOKE ALL ON FUNCTION g4_bump_principal_epoch(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION g4_bump_principal_epoch(uuid) TO creche_app;
  END IF;
END
$$;

-- 1) État du compte lui-même : uniquement quand une valeur révocatoire change
--    réellement (IS DISTINCT FROM), pour ne pas tuer les sessions sur un
--    no-op (ex. acceptation d'invitation rejouée).
CREATE OR REPLACE FUNCTION trg_g4_users_epoch_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.token_epoch := COALESCE(OLD.token_epoch, 0) + 1;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_g4_users_epoch ON users;
CREATE TRIGGER trg_g4_users_epoch
  BEFORE UPDATE OF status, is_super_admin, password_hash, deleted_at ON users
  FOR EACH ROW
  WHEN (
    OLD.status           IS DISTINCT FROM NEW.status        OR
    OLD.is_super_admin   IS DISTINCT FROM NEW.is_super_admin OR
    OLD.password_hash    IS DISTINCT FROM NEW.password_hash OR
    OLD.deleted_at       IS DISTINCT FROM NEW.deleted_at
  )
  EXECUTE FUNCTION trg_g4_users_epoch_fn();

-- 2) Memberships (rôle principal, périmètre, activation) : révocation comme
--    rétablissement déconnectent les access tokens en vol du concerné.
--    Comparaison de valeurs DANS la fonction : un UPDATE sans changement réel
--    (réécriture idempotente d'exploitation) ne doit JAMAIS invalider de
--    sessions, sinon tout restore inconditionnel devient un déconnecteur.
CREATE OR REPLACE FUNCTION trg_g4_memberships_epoch_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM g4_bump_principal_epoch(NEW.user_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.site_id IS DISTINCT FROM OLD.site_id
       OR NEW.room_ids IS DISTINCT FROM OLD.room_ids
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      PERFORM g4_bump_principal_epoch(OLD.user_id);
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        PERFORM g4_bump_principal_epoch(NEW.user_id);
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM g4_bump_principal_epoch(OLD.user_id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_g4_memberships_epoch ON memberships;
CREATE TRIGGER trg_g4_memberships_epoch
  AFTER INSERT OR UPDATE OF user_id, role_id, site_id, room_ids, is_active
  OR DELETE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION trg_g4_memberships_epoch_fn();

-- 3) Rôles additionnels (multi-rôles, migration 040).
CREATE OR REPLACE FUNCTION trg_g4_role_assignments_epoch_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM g4_bump_principal_epoch(OLD.user_id);
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM g4_bump_principal_epoch(NEW.user_id);
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      PERFORM g4_bump_principal_epoch(NEW.user_id);
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        PERFORM g4_bump_principal_epoch(OLD.user_id);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_g4_role_assignments_epoch ON role_assignments;
CREATE TRIGGER trg_g4_role_assignments_epoch
  AFTER INSERT OR UPDATE OF user_id, role_id OR DELETE ON role_assignments
  FOR EACH ROW
  EXECUTE FUNCTION trg_g4_role_assignments_epoch_fn();

-- Lecture de l'époque pour les gardes d'entrée : même autorité que les
-- fonctions d'auth bootstrap (015) — les routes protégées tournent sans
-- contexte tenant établi, la colonne est lisible par l'app (users n'a pas de
-- RLS) mais cette fonction borne l'exposition au seul entier opaque.
CREATE OR REPLACE FUNCTION auth_principal_epoch(target_user uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT token_epoch FROM users WHERE id = target_user AND deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION auth_principal_epoch(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_principal_epoch(uuid) TO creche_app;
  END IF;
END
$$;
