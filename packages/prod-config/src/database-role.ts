/** Contrôle réel du rôle connecté, avant ouverture HTTP ou claim worker. */
interface RoleRow {
  name: string;
  login_name: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  memberships: boolean;
  owns_objects: boolean;
  can_create: boolean;
}
interface DatabaseConnection {
  query(sql: string): Promise<{ rows: RoleRow[] }>;
}

export async function assertApplicationDatabaseRole(
  db: DatabaseConnection,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!['production', 'staging'].includes(env.NODE_ENV ?? '')) return;
  const { rows: [role] } = await db.query(`
    SELECT current_user AS name, session_user AS login_name, rolsuper, rolbypassrls, rolcreatedb,
      rolcreaterole, rolreplication,
      EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS memberships,
      (EXISTS (SELECT 1 FROM pg_class WHERE relowner = r.oid)
       OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = r.oid)
       OR EXISTS (SELECT 1 FROM pg_database WHERE datdba = r.oid)
       OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = r.oid)) AS owns_objects,
      (has_schema_privilege(current_user, 'public', 'CREATE')
       OR has_database_privilege(current_user, current_database(), 'CREATE')) AS can_create
    FROM pg_roles r WHERE rolname = current_user
  `);
  if (!role || role.name !== 'creche_app' || role.login_name !== 'creche_app' || role.rolsuper || role.rolbypassrls ||
      role.rolcreatedb || role.rolcreaterole || role.rolreplication ||
      role.memberships || role.owns_objects || role.can_create) {
    throw new Error('DATABASE_ROLE_UNSAFE: démarrage REFUSÉ ; creche_app NOSUPERUSER NOBYPASSRLS requis, sans propriété, DDL ni appartenance de rôle. Exécuter le bootstrap administrateur puis les migrations dédiées.');
  }
}
