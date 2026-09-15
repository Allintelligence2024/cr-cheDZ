// Structural reproductions: not a substitute for the actual dev stack gate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const directory = resolve(process.env.COMPOSE_TEST_DIR ?? 'infrastructure/docker');
const config = yaml.load(readFileSync(resolve(directory, 'docker-compose.dev.yml'), 'utf8'));
const services = config.services;
for (const name of ['api', 'worker', 'admin-web']) {
  test(`${name}: build context contains the locked monorepo and the Dockerfile exists`, () => {
    const build = services[name].build;
    const context = resolve(directory, build.context);
    assert.ok(existsSync(resolve(context, build.dockerfile)), 'Dockerfile missing');
    assert.ok(existsSync(resolve(context, 'package-lock.json')), 'root lockfile absent from build context');
    assert.ok(existsSync(resolve(context, 'packages/prod-config/package.json')), 'workspace dependency absent');
    const dockerfile = readFileSync(resolve(context, build.dockerfile), 'utf8');
    assert.match(dockerfile, /RUN npm ci/);
    assert.doesNotMatch(dockerfile, /npm install/);
    assert.match(dockerfile, /WORKDIR \/app/);
    assert.ok(!(services[name].volumes ?? []).some(v => /:\/app(?::|$)/.test(v)), 'source mount hides the monorepo/dependencies');
  });
}
test('dev separates administrator, migrator and app roles, including worker', () => {
  assert.equal(services.postgres.environment.POSTGRES_USER, 'postgres');
  assert.ok(services['bootstrap-roles']);
  assert.match(services.migrate.environment.MIGRATION_DATABASE_URL, /creche_migrator/);
  for (const name of ['api', 'worker']) {
    assert.match(services[name].environment.DATABASE_URL, /creche_app/);
    for (const key of ['MIGRATION_DATABASE_URL', 'BOOTSTRAP_DATABASE_URL']) assert.equal(services[name].environment[key], undefined);
    assert.equal(services[name].depends_on.migrate.condition, 'service_completed_successfully');
  }
});
test('dev migrates with installed locked dependencies and actually runs schema-check', () => {
  const migrate = services.migrate;
  assert.doesNotMatch(String(migrate.command), /npm install/);
  assert.match(String(migrate.command), /node scripts\/migrate.mjs/);
  assert.match(String(migrate.command), /node tests\/tenant-isolation\/schema-check.mjs/);
  assert.equal(migrate.depends_on['bootstrap-roles'].condition, 'service_completed_successfully');
});
test('web keeps browser requests relative and proxies to the Docker API service', () => {
  assert.equal(services['admin-web'].environment.API_PROXY_TARGET, 'http://api:3000');
  assert.equal(services['admin-web'].environment.VITE_API_URL, undefined);
});
test('source hot reload does not overlay or replace installed dependencies', () => {
  for (const name of ['api', 'worker', 'admin-web']) {
    assert.ok(services[name].volumes.some(v => v.endsWith(`/app/apps/${name}/src:ro`)));
    assert.ok(!services[name].volumes.some(v => /node_modules/.test(v)));
  }
});
