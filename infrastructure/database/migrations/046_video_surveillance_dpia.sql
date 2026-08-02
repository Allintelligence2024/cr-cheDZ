-- ============================================================================
-- 046_video_surveillance_dpia.sql
-- Roadmap v2 — Vidéosurveillance : blocage DPIA (loi 25-11) avant tout module.
--
-- 1) processing_registry.requires_dpia : marque les traitements sensibles
--    (photos des enfants, santé, paie, vidéosurveillance).
-- 2) Modèle « Vidéosurveillance des locaux » (organization_id NULL) :
--    is_active = FALSE tant que la DPIA de l'organisation n'est pas approuvée
--    (le module logiciel reste hors périmètre — docs/regulatory/
--    DPIA-VIDEOSURVEILLANCE.md).
-- 3) privacy_approved_dpia_exists() : fonction SECURITY DEFINER (même pattern
--    que 015/024/029) utilisée par la console support AVANT d'activer le flag
--    video_surveillance pour une organisation.
-- ============================================================================

-- ── 1) Marqueur DPIA sur le registre ────────────────────────────────────────
ALTER TABLE processing_registry ADD COLUMN requires_dpia BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN processing_registry.requires_dpia IS
  'Traitement soumis à DPIA/AIPD (loi 25-11, traitements sensibles) : la DPIA doit être approuvée avant activation effective.';

UPDATE processing_registry SET requires_dpia = true
WHERE organization_id IS NULL
  AND processing_name IN (
    'Photos des enfants',
    'Dossier de santé de l''enfant',
    'Paie du personnel'
  );

-- ── 2) Modèle de traitement « Vidéosurveillance » (global, inactif) ─────────
INSERT INTO processing_registry
  (organization_id, processing_name, purpose_fr, purpose_ar, legal_basis,
   data_categories, data_subjects, retention_days, third_parties,
   security_measures, dpo_notes, is_active, requires_dpia)
SELECT NULL,
  'Vidéosurveillance des locaux',
  'Protection des enfants, du personnel et des locaux (enregistrement d''images, conservation 30 jours maximum)',
  'حماية الأطفال والموظفين والمرافق (تسجيل الصور، الاحتفاظ بها 30 يوماً كحد أقصى)',
  'legitimate_interest',
  ARRAY['images vidéo']::text[],
  ARRAY['child', 'staff', 'visitor']::text[],
  30,
  NULL,
  ARRAY[
    'accès restreint (DPO + directeur)',
    'chiffrement au repos',
    'conservation 30 jours maximum',
    'journalisation des accès aux images',
    'affichage d''information des personnes'
  ]::text[],
  'DPIA obligatoire AVANT tout déploiement (loi 25-11) : le flag video_surveillance ne peut être activé qu''après approbation de la DPIA de l''organisation. Module logiciel NON déployé.',
  false,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM processing_registry
  WHERE organization_id IS NULL AND processing_name = 'Vidéosurveillance des locaux'
);

-- ── 3) Garde-fou console : DPIA approuvée sur un modèle donné ? ─────────────
CREATE OR REPLACE FUNCTION privacy_approved_dpia_exists(
  p_organization_id uuid,
  p_processing_name text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM privacy_dpias d
    JOIN processing_registry p ON p.id = d.processing_registry_id
    WHERE d.organization_id = p_organization_id
      AND d.status = 'approved'
      AND p.organization_id IS NULL
      AND p.processing_name = p_processing_name
  );
END $$;

REVOKE ALL ON FUNCTION privacy_approved_dpia_exists(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION privacy_approved_dpia_exists(uuid, text) TO creche_app;
  END IF;
END $$;
