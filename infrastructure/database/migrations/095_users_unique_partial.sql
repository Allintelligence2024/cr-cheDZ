-- 095_users_unique_partial.sql
-- 3.1.4 : users.email / users.phone étaient des contraintes UNIQUE absolues.
-- Un utilisateur soft-supprimé (deleted_at NOT NULL) gardait son email/phone
-- verrouillé → la réinvitation échouait en 500 (violations UNIQUE) au lieu de
-- créer un nouveau compte. La colonne est aussi utilisée pour la recherche
-- (SELECT ... WHERE email = $1 AND deleted_at IS NULL) qui filtre déjà les
-- supprimés : l'unicité réelle ne porte que sur les comptes vivants.
--
-- Remplace les contraintes colonnes par des index uniques PARTIELS
-- (deleted_at IS NULL) : la réinscription d'un email supprimé devient possible,
-- et deux comptes vivants ne peuvent toujours pas partager un email.

ALTER TABLE users DROP CONSTRAINT users_email_key;
ALTER TABLE users DROP CONSTRAINT users_phone_key;

CREATE UNIQUE INDEX users_email_unique_active ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_unique_active ON users (phone) WHERE deleted_at IS NULL;
