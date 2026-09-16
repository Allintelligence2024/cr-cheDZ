import { isSealedTotpSecret, openTotpSecret, parseTotpKeyRing, sealTotpSecret } from './totp-crypto';

/**
 * G5 (audit 2026-09) : chiffrement au repos des secrets TOTP. La sémantique
 * HTTP/PG complète (login, canaux parent, rotation au redémarrage) est prouvée
 * par la suite phase54 ; ce fichier verrouille les cas limites purs du
 * format scellé, sans base de données.
 */
describe('totp-crypto (G5)', () => {
  const KEY_HEX = '0'.repeat(64);
  const KEY_HEX_B = 'a'.repeat(64);

  it('accepte hex 64 et base64 de 32 octets ; la liste garde la courante en tête', () => {
    const ring = parseTotpKeyRing(`${KEY_HEX_B},${KEY_HEX}`);
    expect(ring).not.toBeNull();
    expect(ring!.encryptKey.toString('hex')).toBe(KEY_HEX_B);
    expect(ring!.keys).toHaveLength(2);
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(parseTotpKeyRing(b64)!.encryptKey).toHaveLength(32);
  });

  it('refuse le vide (null) et toute clé mal formée (boot refusé)', () => {
    expect(parseTotpKeyRing(undefined)).toBeNull();
    expect(parseTotpKeyRing('   ')).toBeNull();
    expect(() => parseTotpKeyRing('trop-court')).toThrow(/TOTP_ENCRYPTION_KEY/);
    expect(() => parseTotpKeyRing(`${KEY_HEX},${'x'.repeat(20)}`)).toThrow(/32 octets/);
  });

  it('round-trip avec AAD utilisateur ; le clair legacy est rescellable, jamais inventé', () => {
    const ring = parseTotpKeyRing(KEY_HEX)!;
    const sealed = sealTotpSecret(ring, 'user-1', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(isSealedTotpSecret(sealed)).toBe(true);
    expect(sealed).not.toContain('GEZDGNBVGY3TQOJQ');
    expect(openTotpSecret(ring, 'user-1', sealed)!.secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(openTotpSecret(ring, 'user-1', sealed)!.needsReseal).toBe(false);
    // clair legacy : accepté, rescellage demandé si une clé est active
    const legacy = openTotpSecret(ring, 'user-1', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(legacy!.secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(legacy!.needsReseal).toBe(true);
    // sans clé active : clair conservé tel quel, pas de faux rescellage
    expect(openTotpSecret(null, 'user-1', 'GEZDGNBVGY3TQOJQ')).toEqual({
      secret: 'GEZDGNBVGY3TQOJQ',
      needsReseal: false,
    });
  });

  it('AAD croisé, tag falsifié, troncature ou scellé sans clé → null (fail-closed)', () => {
    const ring = parseTotpKeyRing(KEY_HEX)!;
    const sealed = sealTotpSecret(ring, 'user-1', 'SECRET');
    expect(openTotpSecret(ring, 'user-2', sealed)).toBeNull();
    const [v, iv, tag, ct] = sealed.split('.');
    const flipped = `${v}.${iv}.${tag.slice(0, -2)}AA.${ct}`;
    expect(openTotpSecret(ring, 'user-1', flipped)).toBeNull();
    expect(openTotpSecret(ring, 'user-1', `${v}.${iv}.${tag}`)).toBeNull();
    expect(openTotpSecret(ring, 'user-1', 'v1gcm.pas.le.bon.format')).toBeNull();
    expect(openTotpSecret(null, 'user-1', sealed)).toBeNull();
    expect(openTotpSecret(ring, 'user-1', null)).toBeNull();
  });

  it('rotation : décryptable par l’ancienne clé, marquée à resceller; clé retirée = refus', () => {
    const oldRing = parseTotpKeyRing(KEY_HEX)!;
    const sealedOld = sealTotpSecret(oldRing, 'user-1', 'SECRET');
    const rotated = parseTotpKeyRing(`${KEY_HEX_B},${KEY_HEX}`)!;
    const opened = openTotpSecret(rotated, 'user-1', sealedOld);
    expect(opened!.secret).toBe('SECRET');
    expect(opened!.needsReseal).toBe(true);
    expect(openTotpSecret(parseTotpKeyRing(KEY_HEX_B)!, 'user-1', sealedOld)).toBeNull();
  });
});
