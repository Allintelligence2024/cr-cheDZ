import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { isUUID } from 'class-validator';
import { isSyncCursor } from '../../apps/api/dist/modules/sync/generated/sync-contract.js';
const schema = JSON.parse(readFileSync(new URL('../../packages/sync-contract/sync.schema.json', import.meta.url)));
// AJV is already locked through the build toolchain; not a runtime dependency.
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addFormat('sync-cursor', { type: 'string', validate: isSyncCursor });
ajv.addFormat('uuid', { type: 'string', validate: s => isUUID(s) });
ajv.addSchema(schema);
export function validateSchema(name, data) {
  const validate = ajv.getSchema(`${schema.$id}#/definitions/${name}`);
  if (!validate) throw new Error(`Unknown definition ${name}`);
  return { valid: validate(data), errors: validate.errors };
}
export function assertSchema(name, data) {
  const result = validateSchema(name, data);
  if (!result.valid) throw new Error(`${name}: ${JSON.stringify(result.errors)}`);
}
