-- ============================================================================
-- Seed 015 — Registre des traitements (DPO, loi 18-07 modifiée par 25-11).
-- Déclarations par organisation : le registre est vide par défaut (les
-- organisations sont créées via l'API) ; ce seed pose les traitements
-- STANDARD à créer pour chaque nouvelle organisation (job de provisionnement)
-- et documente la liste de référence (photos, santé, paie, présence/journal).
-- ============================================================================

-- Traitements standard de référence (org NULL = modèle, jamais affiché aux orgs).
INSERT INTO processing_registry
  (organization_id, processing_name, purpose_fr, purpose_ar, legal_basis,
   data_categories, data_subjects, retention_days, third_parties,
   security_measures, dpo_notes, is_active, requires_dpia)
SELECT NULL, v.processing_name, v.purpose_fr, v.purpose_ar, v.legal_basis,
       v.data_categories, v.data_subjects, v.retention_days, v.third_parties,
       v.security_measures, v.dpo_notes, true, v.requires_dpia
FROM (VALUES
  ('Photos des enfants',
   'Partage du fil du jour avec les parents (consentement photo individuel)',
   'مشاركة يوميات الطفل مع الوالدين (موافقة فردية على الصور)',
   'consent',
   ARRAY['photos', 'identité']::text[],
   ARRAY['child']::text[],
   1825,
   ARRAY['MinIO/S3 (hébergement Algérie)']::text[],
   ARRAY['urls signées', 'consentements', 'audit d''accès']::text[],
   'Traitement sensible : DPIA requise (loi 25-11, art. 38)', true),
  ('Dossier de santé de l''enfant',
   'Suivi médical : allergies, vaccinations, médicaments (double saisie)',
   'المتابعة الطبية: الحساسية والتلقيحات والأدوية (إدخال مزدوج)',
   'consent',
   ARRAY['santé']::text[],
   ARRAY['child']::text[],
   1825,
   NULL,
   ARRAY['accès journalisé', 'can_view_health']::text[],
   'Traitement sensible : accès parents verrouillé par permission', true),
  ('Présences et journal quotidien',
   'Pointage, repas, siestes, activités — service rendu aux familles',
   'الحضور واليوميات اليومية — الخدمة المقدمة للعائلات',
   'contract',
   ARRAY['présence', 'comportement']::text[],
   ARRAY['child']::text[],
   1825,
   NULL,
   ARRAY['append-only', 'corrections tracées']::text[],
   NULL, false),
  ('Paie du personnel',
   'Établissement des salaires et déclarations CNAS',
   'إعداد الرواتب والتصريحات للصندوق الوطني للتأمينات',
   'legal_obligation',
   ARRAY['paie', 'identité', 'santé']::text[],
   ARRAY['staff']::text[],
   3650,
   ARRAY['CNAS']::text[],
   ARRAY['masquage PII dans l''audit']::text[],
   'DPIA recommandée (données de santé du personnel)', true)
) AS v(processing_name, purpose_fr, purpose_ar, legal_basis, data_categories,
        data_subjects, retention_days, third_parties, security_measures, dpo_notes, requires_dpia)
WHERE NOT EXISTS (
  SELECT 1 FROM processing_registry pr
  WHERE pr.organization_id IS NULL AND pr.processing_name = v.processing_name
);
