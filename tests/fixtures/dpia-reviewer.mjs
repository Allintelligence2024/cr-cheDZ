// Administrative fixture only: a distinct director, then an ordinary HTTP login.
// The caller's prefix preserves each legacy suite's scoped cleanup conventions.
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';

export async function createDpiaReviewer(db, organizationId, emailPrefix, api) {
  const password = 'Synthetic-DPIA-reviewer!', email = `${emailPrefix}-reviewer-${randomUUID()}@test.invalid`;
  const user = (await db.query(
    "INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'Independent','Reviewer',$2,'active') RETURNING id",
    [email, await bcrypt.hash(password, 4)],
  )).rows[0];
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='director'", [organizationId, user.id]);
  const login = await api('POST', '/auth/login', null, { email, password });
  assert.equal(login.status, 200); assert.ok(login.body.access_token);
  return login.body.access_token;
}
