import { acceptsDto } from './dto-validator.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSchema } from './schema-validator.mjs';

const cases = JSON.parse(readFileSync(new URL('../../packages/sync-contract/conformance.json', import.meta.url)));
for (const entry of cases) {
  test(`schema / DTO : ${entry.name}`, async () => {
    const result = validateSchema(entry.definition, entry.value);
    assert.equal(result.valid, entry.valid, JSON.stringify(result.errors));
    const dto = await acceptsDto(entry.definition, entry.value);
    if (dto !== undefined) assert.equal(dto, entry.valid, 'DTO diverges from schema');
  });
}
