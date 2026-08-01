-- ============================================================================
-- Seed 013 — Jeu de règles du décret exécutif 19-253 du 16/09/2019
-- (conditions de création, organisation, fonctionnement et contrôle des
-- établissements d'accueil de la petite enfance).
-- Idempotent.
-- ============================================================================

INSERT INTO compliance_rule_sets
  (name, jurisdiction, establishment_type, effective_from, version, status)
VALUES
  ('Décret 19-253 version 2025', 'DZ', 'creche', '2019-09-16', '2025.1', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO compliance_rules
  (rule_set_id, code, category, parameters, severity, message_fr, message_ar, reference, is_active)
SELECT rs.id, v.code, v.category, v.parameters, v.severity, v.message_fr, v.message_ar, v.reference, true
FROM compliance_rule_sets rs
CROSS JOIN (VALUES
  ('CAP_150', 'capacity',
   '{"max_children": 150}'::jsonb, 'critical',
   'Capacité maximale dépassée : 150 enfants par établissement.',
   'تم تجاوز السعة القصوى: 150 طفلاً لكل مؤسسة.',
   'Décret 19-253, art. 4'),
  ('RATIO_EDUC', 'ratio',
   '{"min_educators_per_group": 2, "max_children_per_educator": 10}'::jsonb, 'warning',
   'Ratio éducateurs/enfants non conforme à la tranche d''âge.',
   'نسبة المربين/الأطفال غير مطابقة للفئة العمرية.',
   'Décret 19-253, art. 8'),
  ('AGE_CRECHE', 'registration',
   '{"min_age_months": 3, "max_age_months": 36}'::jsonb, 'warning',
   'Enfant hors tranche d''âge de la crèche (3 mois à 3 ans).',
   'الطفل خارج الفئة العمرية للحضانة (3 أشهر إلى 3 سنوات).',
   'Décret 19-253, art. 3'),
  ('DOC_BIRTH', 'document',
   '{"document": "birth_certificate"}'::jsonb, 'warning',
   'Acte de naissance manquant ou expiré pour un enfant actif.',
   'شهادة الميلاد مفقودة أو منتهية لطفل نشط.',
   'Décret 19-253, art. 14'),
  ('DOC_STAFF', 'document',
   '{"document": "staff_qualification"}'::jsonb, 'critical',
   'Personnel encadrant sans qualification requise.',
   'طاقم التأطير بدون المؤهل المطلوب.',
   'Décret 19-253, art. 7'),
  ('PRICE_DISPLAY', 'registration',
   '{"require_price_display": true}'::jsonb, 'info',
   'Liste des prestations et tarifs non affichée dans l''établissement.',
   'قائمة الخدمات والأسعار غير معروضة في المؤسسة.',
   'Décret 19-253, art. 16')
) AS v(code, category, parameters, severity, message_fr, message_ar, reference)
WHERE rs.name = 'Décret 19-253 version 2025'
  AND NOT EXISTS (
    SELECT 1 FROM compliance_rules cr
    WHERE cr.rule_set_id = rs.id AND cr.code = v.code
  );
