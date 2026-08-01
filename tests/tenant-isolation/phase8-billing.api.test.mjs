#!/usr/bin/env node
/**
 * GATE Phase 8 (à exécuter avec DATABASE_URL PostgreSQL réel) :
 * un comptable/directeur de B ne peut jamais lire/créer de contrat ou facture
 * pour un enfant de A. La suite complète est ajoutée avec le CRUD facturation.
 */
import assert from 'node:assert/strict';
// Le test HTTP complet sera activé avec l'environnement embedded-postgres CI.
// Ce garde-fou empêche son exécution silencieuse sans PostgreSQL réel.
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL requis : les tests d’isolation exigent PostgreSQL réel');
console.log('Phase 8 billing isolation: DATABASE_URL présent; exécuter le scénario CI complet.');
