import pg from 'pg';

// Partagé par migrate et seed : les secrets applicatifs ne servent jamais au DDL.
export async function connectMigrationClient() {
  const strict = ['production', 'staging'].includes(process.env.NODE_ENV) || !!process.env.MIGRATION_DATABASE_URL;
  if (strict && !process.env.MIGRATION_DATABASE_URL) {
    throw new Error('MIGRATION_ROLE_UNSAFE: MIGRATION_DATABASE_URL dédié requis');
  }
  const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: [role] } = await client.query(`
      SELECT current_user AS name, session_user AS login_name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS memberships
      FROM pg_roles r WHERE rolname = current_user
    `);
    if (role.name === 'creche_app' || (strict && (
      role.name !== 'creche_migrator' || role.login_name !== 'creche_migrator' || role.rolsuper || !role.rolbypassrls ||
      role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.memberships
    ))) {
      throw new Error('MIGRATION_ROLE_UNSAFE: utiliser creche_migrator NOSUPERUSER BYPASSRLS, jamais le rôle applicatif');
    }
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}
