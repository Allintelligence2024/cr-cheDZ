-- ============================================================================
-- Seed 003 — Rôles système, permissions et matrice rôle → permissions.
-- Idempotent (ON CONFLICT DO NOTHING). Aucune donnée d'organisation ici.
-- ============================================================================

INSERT INTO roles (name, slug, is_system) VALUES
  ('Super Admin Plateforme', 'super_admin', true),
  ('Directrice',             'director',    true),
  ('Éducatrice',             'educator',    true),
  ('Comptable',              'accountant',  true),
  ('Réception',              'receptionist', true),
  ('Parent Principal',       'parent_primary',   true),
  ('Parent Secondaire',      'parent_secondary', true)
ON CONFLICT (organization_id, slug) DO NOTHING;

INSERT INTO permissions (resource, action, description) VALUES
  -- Enfants et familles
  ('children', 'read',    'Consulter les enfants'),
  ('children', 'create',  'Créer un enfant'),
  ('children', 'update',  'Modifier un enfant'),
  ('children', 'delete',  'Supprimer un enfant (soft)'),
  ('children', 'export',  'Exporter la liste des enfants'),
  ('guardians', 'read',   'Consulter les responsables'),
  ('guardians', 'create', 'Créer un responsable'),
  ('guardians', 'update', 'Modifier un responsable'),
  -- Présences
  ('attendance', 'read',     'Consulter les présences'),
  ('attendance', 'check_in', 'Pointer une arrivée'),
  ('attendance', 'check_out','Pointer un départ'),
  ('attendance', 'correct',  'Corriger une présence (tracé)'),
  -- Journal
  ('journal', 'read',   'Consulter le journal quotidien'),
  ('journal', 'write',  'Écrire des événements de journal'),
  ('journal', 'moderate', 'Modérer la visibilité parent'),
  ('journal', 'incident', 'Déclarer un incident'),
  -- Médias
  ('media', 'upload',   'Uploader des photos/documents'),
  ('media', 'publish',  'Rendre une photo visible aux parents'),
  -- Santé
  ('health', 'read',    'Consulter le dossier de santé'),
  ('health', 'update',  'Modifier le dossier de santé'),
  ('health', 'medicate','Administrer un médicament'),
  -- Facturation
  ('billing', 'read',    'Consulter factures et paiements'),
  ('billing', 'create_invoice',  'Générer une facture'),
  ('billing', 'record_payment',  'Enregistrer un paiement'),
  ('billing', 'close_cash',      'Clôturer la caisse'),
  ('billing', 'refund',          'Rembourser'),
  -- Personnel
  ('staff', 'read',   'Consulter le personnel'),
  ('staff', 'manage', 'Gérer le personnel'),
  -- Organisation
  ('organization', 'manage', 'Gérer organisation, sites, salles'),
  ('organization', 'invite', 'Inviter des membres'),
  -- Conformité et vie privée
  ('compliance', 'read', 'Consulter les vérifications de conformité'),
  ('privacy', 'manage',  'Gérer consentements et demandes de droits'),
  ('audit', 'read',      'Consulter les journaux d’audit'),
  ('users', 'manage',    'Gérer les utilisateurs de l’organisation')
ON CONFLICT (resource, action) DO NOTHING;

-- Matrice rôle → permissions (idempotente)

-- Directrice : tout sauf vie privée/audit (réservés DPO)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.slug = 'director'
  AND p.resource NOT IN ('privacy', 'audit') -- audit/privacy : DPO uniquement
ON CONFLICT DO NOTHING;

-- Éducatrice
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.slug = 'educator'
  AND p.resource IN ('children', 'guardians', 'attendance', 'journal', 'media', 'health')
  AND p.action IN ('read', 'check_in', 'check_out', 'write', 'upload', 'incident', 'medicate', 'create', 'update')
ON CONFLICT DO NOTHING;

-- Comptable
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.slug = 'accountant'
  AND p.resource IN ('billing', 'children')
  AND p.action IN ('read', 'create_invoice', 'record_payment', 'close_cash', 'refund', 'export')
ON CONFLICT DO NOTHING;

-- Réception
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.slug = 'receptionist'
  AND p.resource IN ('children', 'guardians', 'attendance', 'journal')
  AND p.action IN ('read', 'check_in', 'check_out', 'create', 'update', 'write')
ON CONFLICT DO NOTHING;

-- Parents : permissions déléguées via child_guardians (pas via rôles)
-- → aucune permission de rôle parent, l'accès passe par child_guardians.
