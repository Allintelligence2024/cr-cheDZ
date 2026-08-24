-- ============================================================================
-- 049_storage_key_safety.sql
-- Durcissement DB issu de l'audit externe (voir docs/PROMPT_FIX_AUDIT.md) :
-- les clés de stockage fichier (video_clips, media_assets, staff_documents,
-- report_exports) n'avaient AUCUN garde-fou SQL — un chemin contenant `..`
-- (path traversal) ou un chemin absolu pouvait être INSÉRÉ EN BASE par tout
-- chemin contournant la validation DTO (SQL direct, future API, restauration
-- de sauvegarde…). L'API valide désormais (DTO + politique serveur), la
-- défense en profondeur EXIGE que la base elle-même refuse.
--
-- Contrainte cohérente avec la regex DTO vidéo ^(?!.*\.\.)[\w\-./]{1,200}$ :
--   - caractères sûrs uniquement [A-Za-z0-9_\-./] (rejette backslash,
--     espaces, caractères de contrôle, %00…) ;
--   - aucun `..` nulle part dans la clé ;
--   - jamais de slash initial (chemin absolu interdit) ;
--   - longueur ≤ 500 via char_length() (le moteur regex PG limite les
--     répétitions à 255 — RE_DUP_MAX — donc le bornage se fait hors regex) ;
--     le DTO le plus large (media RegisterMediaDto) accepte 500, les clés
--     générées font < 150.
-- NULL reste autorisé là où la colonne est nullable (thumbnail_key,
-- report_exports.storage_key : CHECK inopérant sur NULL).
--
-- Migrations 001-048 immuables (ADR-007) : contraintes ajoutées ici, jamais
-- modifiées en place.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'video_clips') THEN
    ALTER TABLE video_clips DROP CONSTRAINT IF EXISTS video_clips_storage_key_safe;
    ALTER TABLE video_clips ADD CONSTRAINT video_clips_storage_key_safe CHECK (
      storage_key ~ '^[A-Za-z0-9_\-./]+$'
      AND char_length(storage_key) <= 500
      AND storage_key !~ '\.\.'
      AND left(storage_key, 1) <> '/'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'media_assets') THEN
    ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_storage_key_safe;
    ALTER TABLE media_assets ADD CONSTRAINT media_assets_storage_key_safe CHECK (
      storage_key ~ '^[A-Za-z0-9_\-./]+$'
      AND char_length(storage_key) <= 500
      AND storage_key !~ '\.\.'
      AND left(storage_key, 1) <> '/'
    );
    ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_thumbnail_key_safe;
    ALTER TABLE media_assets ADD CONSTRAINT media_assets_thumbnail_key_safe CHECK (
      thumbnail_key ~ '^[A-Za-z0-9_\-./]+$'
      AND char_length(thumbnail_key) <= 500
      AND thumbnail_key !~ '\.\.'
      AND left(thumbnail_key, 1) <> '/'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'staff_documents') THEN
    ALTER TABLE staff_documents DROP CONSTRAINT IF EXISTS staff_documents_storage_key_safe;
    ALTER TABLE staff_documents ADD CONSTRAINT staff_documents_storage_key_safe CHECK (
      storage_key ~ '^[A-Za-z0-9_\-./]+$'
      AND char_length(storage_key) <= 500
      AND storage_key !~ '\.\.'
      AND left(storage_key, 1) <> '/'
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'report_exports') THEN
    ALTER TABLE report_exports DROP CONSTRAINT IF EXISTS report_exports_storage_key_safe;
    ALTER TABLE report_exports ADD CONSTRAINT report_exports_storage_key_safe CHECK (
      storage_key ~ '^[A-Za-z0-9_\-./]+$'
      AND char_length(storage_key) <= 500
      AND storage_key !~ '\.\.'
      AND left(storage_key, 1) <> '/'
    );
  END IF;
END $$;
