import { assertApplicationDatabaseRole } from '@creche/prod-config';

const safeRole = {
  name: 'creche_app', login_name: 'creche_app', rolsuper: false,
  rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
  rolreplication: false, memberships: false, owns_objects: false, can_create: false,
};

describe('Garde du rôle PostgreSQL de production', () => {
  it.each(['production', 'staging'])('accepte le rôle sain en %s', async (NODE_ENV) => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [safeRole] }) };
    await expect(assertApplicationDatabaseRole(db, { NODE_ENV })).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    'rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication',
    'memberships', 'owns_objects', 'can_create',
  ])('refuse %s même si les autres attributs sont sains', async (attribute) => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ ...safeRole, [attribute]: true }] }) };
    await expect(assertApplicationDatabaseRole(db, { NODE_ENV: 'production' })).rejects.toThrow('DATABASE_ROLE_UNSAFE');
  });

  it.each(['name', 'login_name'])('vérifie %s, pas seulement les flags', async (attribute) => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ ...safeRole, [attribute]: 'postgres' }] }) };
    await expect(assertApplicationDatabaseRole(db, { NODE_ENV: 'production' })).rejects.toThrow('DATABASE_ROLE_UNSAFE');
  });

  it('échoue fermé si le catalogue ne renvoie pas de rôle', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(assertApplicationDatabaseRole(db, { NODE_ENV: 'production' })).rejects.toThrow('DATABASE_ROLE_UNSAFE');
  });

  it('propage une erreur de connexion, sans prétendre que le rôle est sain', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('Connexion indisponible')) };
    await expect(assertApplicationDatabaseRole(db, { NODE_ENV: 'production' })).rejects.toThrow('Connexion indisponible');
  });

  it('préserve le mode test historique sans interrogation du catalogue', async () => {
    const db = { query: jest.fn() };
    await assertApplicationDatabaseRole(db, { NODE_ENV: 'test' });
    expect(db.query).not.toHaveBeenCalled();
  });
});
