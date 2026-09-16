-- G5 (audit 2026-09, lot MFA) — anti-rejeu PERSISTANT des codes TOTP.
--
-- Constat : TotpService.verify est stateless (fenêtre ±1 pas, soit ~90 s) et
-- aucun état ne retenait un code déjà accepté — le même code était donc
-- réutilisable pendant toute la fenêtre, y compris contre des canaux
-- distincts. La valeur est désormais consommée une seule fois par compte :
-- totp_last_step mémorise le pas (compteur RFC 6238 = epoch / 30) du dernier
-- code accepté ; l'API refuse tout pas strictement postérieur non atteint.
--
-- Chiffrement au repos du secret : il est appliqué COUCHÉ API (clé hors base,
-- format scellé 'v1gcm.*' — voir apps/api/src/shared/auth/totp-crypto.ts) ;
-- cette migration n'est que la colonne d'état d'anti-rejeu. Les lignes
-- existantes (base32 en clair) restent lisibles et sont rescellées à l'usage.
--
-- ADR-007 : purement additif, aucune mutation de données, rejeu idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;

COMMENT ON COLUMN users.totp_last_step IS
  'G5 : pas TOTP (epoch/30) du dernier code accepté pour ce compte ; NULL = jamais consommé. Anti-rejeu persistant, tous canaux confondus.';
